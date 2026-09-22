import { logger } from '../../shared/logger.js';

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailboxEmail: string;
}

export interface GraphAttachment {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
}

export interface GraphIncomingMessage {
  id: string;
  internetMessageId: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  senderEmail: string;
  senderName: string;
  receivedDateTime: string;
  attachments: GraphAttachment[];
}

export interface GraphSendReplyOptions {
  to: string;
  subject: string;
  text: string;
  inReplyToMessageId?: string;
  references?: string[];
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
}

export class GraphService {
  private tokenCache: Map<string, { token: string; expiresAt: number }> = new Map();

  private getCacheKey(config: GraphConfig): string {
    return `${config.tenantId}:${config.clientId}`;
  }

  async getAccessToken(config: GraphConfig): Promise<string> {
    const key = this.getCacheKey(config);
    const cached = this.tokenCache.get(key);
    // Return cached token if valid for at least 3 more minutes
    if (cached && cached.expiresAt > Date.now() + 180000) {
      return cached.token;
    }

    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
    const params = new URLSearchParams();
    params.append('client_id', config.clientId);
    params.append('client_secret', config.clientSecret);
    params.append('scope', 'https://graph.microsoft.com/.default');
    params.append('grant_type', 'client_credentials');

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data: any = await res.json();
    if (!res.ok) {
      const errMsg = data.error_description || data.error || 'Failed to obtain access token from Microsoft Entra ID';
      logger.error({ err: errMsg, tenantId: config.tenantId, clientId: config.clientId }, 'Entra ID OAuth2 token error');
      throw new Error(`Entra ID Auth Error: ${errMsg}`);
    }

    const token = data.access_token;
    const expiresInSec = typeof data.expires_in === 'number' ? data.expires_in : 3600;
    this.tokenCache.set(key, {
      token,
      expiresAt: Date.now() + expiresInSec * 1000,
    });

    return token;
  }

  async testConnection(config: GraphConfig): Promise<{ success: boolean; message: string; displayName?: string }> {
    try {
      const token = await this.getAccessToken(config);
      const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mailboxEmail)}/mailFolders/inbox/messages?$top=1&$select=id,subject`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data: any = await res.json();
      if (!res.ok) {
        const msg = data.error?.message || `Microsoft Graph API error (${res.status} ${res.statusText})`;
        return { success: false, message: msg };
      }

      return {
        success: true,
        message: `Successfully connected to Microsoft 365 inbox (${config.mailboxEmail})`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Failed to connect to Microsoft Graph API',
      };
    }
  }

  async fetchUnreadMessages(config: GraphConfig, top = 20): Promise<GraphIncomingMessage[]> {
    const token = await this.getAccessToken(config);
    const email = config.mailboxEmail.trim();

    // Query unread messages from Inbox folder, expanding attachments
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/mailFolders/inbox/messages` +
      `?$filter=isRead eq false` +
      `&$top=${top}` +
      `&$select=id,conversationId,internetMessageId,subject,body,from,receivedDateTime,hasAttachments` +
      `&$expand=attachments` +
      `&$orderby=receivedDateTime asc`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.body-content-type="text"',
      },
    });

    const data: any = await res.json();
    if (!res.ok) {
      const errMsg = data.error?.message || `Graph API error fetching mail (${res.status})`;
      logger.error({ err: errMsg, email }, 'Error fetching messages from Graph API');
      throw new Error(errMsg);
    }

    const messages: GraphIncomingMessage[] = [];
    const items = data.value || [];

    for (const item of items) {
      const internetMessageId = item.internetMessageId || `<graph-${item.id}@${email}>`;
      const senderEmail = item.from?.emailAddress?.address || 'unknown@example.com';
      const senderName = item.from?.emailAddress?.name || senderEmail;
      const subject = item.subject || '(No Subject)';
      const bodyText = item.body?.content || '';

      const attachments: GraphAttachment[] = [];
      let rawAttachments: any[] = Array.isArray(item.attachments) ? item.attachments : [];

      if (rawAttachments.length === 0 && item.hasAttachments) {
        try {
          const attUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/messages/${encodeURIComponent(item.id)}/attachments`;
          const attRes = await fetch(attUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (attRes.ok) {
            const attData: any = await attRes.json();
            if (Array.isArray(attData.value)) {
              rawAttachments = attData.value;
            }
          }
        } catch (attFetchErr) {
          logger.warn({ err: attFetchErr, messageId: item.id }, 'Could not fetch message attachments fallback from Graph');
        }
      }

      for (const att of rawAttachments) {
        if (att['@odata.type'] === '#microsoft.graph.fileAttachment' && att.contentBytes) {
          const contentBuf = Buffer.from(att.contentBytes, 'base64');
          attachments.push({
            filename: att.name || 'attachment',
            contentType: att.contentType || 'application/octet-stream',
            size: att.size || contentBuf.length,
            content: contentBuf,
          });
        }
      }

      messages.push({
        id: item.id,
        internetMessageId,
        subject,
        bodyText,
        senderEmail,
        senderName,
        receivedDateTime: item.receivedDateTime,
        attachments,
      });
    }

    return messages;
  }

  async markAsRead(config: GraphConfig, messageId: string): Promise<void> {
    const token = await this.getAccessToken(config);
    const email = config.mailboxEmail.trim();

    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/messages/${encodeURIComponent(messageId)}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ isRead: true }),
    });

    if (!res.ok) {
      const data: any = await res.json().catch(() => ({}));
      logger.warn({ err: data.error?.message, messageId, email }, 'Failed to mark Graph message as read');
    }
  }

  async sendMail(config: GraphConfig, options: GraphSendReplyOptions): Promise<{ messageId: string }> {
    const token = await this.getAccessToken(config);
    const email = config.mailboxEmail.trim();

    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/sendMail`;

    const headers: Array<{ name: string; value: string }> = [];
    if (options.inReplyToMessageId) {
      headers.push({ name: 'X-In-Reply-To', value: options.inReplyToMessageId });
    }
    if (options.references && options.references.length > 0) {
      headers.push({ name: 'X-References', value: options.references.join(' ') });
    }

    const attachmentsPayload: any[] = [];
    if (options.attachments && options.attachments.length > 0) {
      for (const att of options.attachments) {
        attachmentsPayload.push({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: att.filename,
          contentType: att.contentType || 'application/octet-stream',
          contentBytes: att.content.toString('base64'),
        });
      }
    }

    const payload = {
      message: {
        subject: options.subject.startsWith('Re:') ? options.subject : `Re: ${options.subject}`,
        body: {
          contentType: 'Text',
          content: options.text,
        },
        toRecipients: [
          {
            emailAddress: {
              address: options.to,
            },
          },
        ],
        internetMessageHeaders: headers.length > 0 ? headers : undefined,
        attachments: attachmentsPayload.length > 0 ? attachmentsPayload : undefined,
      },
      saveToSentItems: true,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data: any = await res.json().catch(() => ({}));
      const msg = data.error?.message || `Graph sendMail failed (${res.status} ${res.statusText})`;
      logger.error({ err: msg, to: options.to, email }, 'Error sending email via Graph API');
      throw new Error(msg);
    }

    const syntheticId = `<graph-sent-${Date.now()}@${email}>`;
    logger.info({ to: options.to, mailbox: email }, 'Outbound email sent via Microsoft Graph API');
    return { messageId: syntheticId };
  }
}

export const graphService = new GraphService();
