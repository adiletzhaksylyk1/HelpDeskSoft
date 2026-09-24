import crypto from "node:crypto";
import { getEnvConfig } from "../../config/env.js";
export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailboxEmail: string;
}
export class GraphHttpError extends Error {
  constructor(readonly status: number) {
    super("Microsoft Graph request failed (" + status + ")");
  }
}
export interface GraphSendReplyOptions {
  to: string;
  subject: string;
  text: string;
  providerMessageId?: string;
  inReplyToMessageId?: string;
  references?: string[];
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
}
export class GraphService {
  private tokenCache = new Map<string, { token: string; expiresAt: number }>();
  async getAccessToken(config: GraphConfig): Promise<string> {
    const key = crypto
      .createHash("sha256")
      .update(config.tenantId + config.clientId + config.clientSecret)
      .digest("hex");
    const cached = this.tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 180000) return cached.token;
    const response = await fetch(
      "https://login.microsoftonline.com/" +
        encodeURIComponent(config.tenantId) +
        "/oauth2/v2.0/token",
      {
        method: "POST",
        signal: AbortSignal.timeout(20000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
        }),
      },
    );
    const data: any = await response.json();
    if (!response.ok || !data.access_token)
      throw new Error("Microsoft authentication failed");
    if (this.tokenCache.size > 100) this.tokenCache.clear();
    this.tokenCache.set(key, {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    });
    return data.access_token;
  }
  private base(config: GraphConfig): string {
    return (
      "https://graph.microsoft.com/v1.0/users/" +
      encodeURIComponent(config.mailboxEmail)
    );
  }
  private async request(
    config: GraphConfig,
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const parsed = new URL(url);
    if (parsed.origin !== "https://graph.microsoft.com")
      throw new Error("Invalid Graph cursor");
    const token = await this.getAccessToken(config);
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, {
        ...init,
        signal: init.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000),
        headers: {
          Authorization: "Bearer " + token,
          Prefer: 'IdType="ImmutableId", odata.maxpagesize=10',
          ...init.headers,
        },
      });
      if (
        (!init.method || init.method === "GET") &&
        [429, 502, 503, 504].includes(response.status) &&
        attempt < 2
      ) {
        const delay = Math.min(
          10000,
          Math.max(
            1000,
            Number(response.headers.get("retry-after") || attempt + 1) * 1000,
          ),
        );
        await response.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new GraphHttpError(response.status);
      }
      return response;
    }
  }
  async testConnection(
    config: GraphConfig,
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.fetchPage(config);
      return { success: true, message: "Connected to Microsoft 365 inbox" };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }
  async fetchPage(
    config: GraphConfig,
    cursor?: string | null,
  ): Promise<{ ids: string[]; cursor: string }> {
    const url =
      cursor ||
      this.base(config) + "/mailFolders/inbox/messages/delta?$select=id";
    const response = await this.request(config, url);
    const data: any = await response.json();
    const next = data["@odata.nextLink"] || data["@odata.deltaLink"];
    if (!next) throw new Error("Graph did not return a sync checkpoint");
    return {
      ids: (data.value || [])
        .filter((m: any) => !m["@removed"])
        .map((m: any) => m.id),
      cursor: next,
    };
  }
  async getMime(config: GraphConfig, id: string): Promise<Buffer> {
    const response = await this.request(
      config,
      this.base(config) + "/messages/" + encodeURIComponent(id) + "/$value",
    );
    const max = getEnvConfig().MAX_MESSAGE_BYTES;
    const chunks: Buffer[] = [];
    let size = 0;
    if (Number(response.headers.get("content-length") || 0) > max) {
      await response.body?.cancel();
      throw new Error("Message exceeds configured size limit");
    }
    if (!response.body) throw new Error("Empty Graph response");
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > max) {
        throw new Error("Message exceeds configured size limit");
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  async sendMail(
    config: GraphConfig,
    options: GraphSendReplyOptions,
  ): Promise<{ messageId: string; providerMessageId: string }> {
    const signal = AbortSignal.timeout(180000);
    const base = this.base(config);
    const content = {
      subject: options.subject.startsWith("Re:")
        ? options.subject
        : "Re: " + options.subject,
      body: { contentType: "Text", content: options.text },
      toRecipients: [{ emailAddress: { address: options.to } }],
    };
    const draftResponse = await this.request(
      config,
      options.providerMessageId
        ? base +
            "/messages/" +
            encodeURIComponent(options.providerMessageId) +
            "/createReply"
        : base + "/messages",
      {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          options.providerMessageId ? { message: content } : content,
        ),
      },
    );
    const draft: any = await draftResponse.json();
    if (!draft.id) throw new Error("Missing Graph draft id");
    for (const attachment of options.attachments || []) {
      if (attachment.content.length < 3 * 1024 * 1024) {
        await this.request(
          config,
          base + "/messages/" + encodeURIComponent(draft.id) + "/attachments",
          {
            method: "POST",
            signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: attachment.filename,
              contentType: attachment.contentType,
              contentBytes: attachment.content.toString("base64"),
            }),
          },
        );
      } else {
        const session = await this.request(
          config,
          base +
            "/messages/" +
            encodeURIComponent(draft.id) +
            "/attachments/createUploadSession",
          {
            method: "POST",
            signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              AttachmentItem: {
                attachmentType: "file",
                name: attachment.filename,
                size: attachment.content.length,
                contentType: attachment.contentType,
              },
            }),
          },
        );
        const data: any = await session.json();
        const upload = new URL(data.uploadUrl);
        if (
          upload.protocol !== "https:" ||
          !(
            upload.hostname.endsWith(".outlook.com") ||
            upload.hostname.endsWith(".office.com") ||
            upload.hostname === "graph.microsoft.com"
          )
        )
          throw new Error("Invalid upload session");
        for (
          let offset = 0;
          offset < attachment.content.length;
          offset += 320 * 1024
        ) {
          const chunk = attachment.content.subarray(
            offset,
            Math.min(offset + 320 * 1024, attachment.content.length),
          );
          const response = await fetch(upload, {
            method: "PUT",
            signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Range":
                "bytes " +
                offset +
                "-" +
                (offset + chunk.length - 1) +
                "/" +
                attachment.content.length,
            },
            body: new Uint8Array(chunk),
          });
          if (!response.ok) throw new Error("Graph attachment upload failed");
          await response.body?.cancel();
        }
      }
    }
    await this.request(
      config,
      base + "/messages/" + encodeURIComponent(draft.id) + "/send",
      { method: "POST", signal },
    );
    let sent: any;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        sent = await (
          await this.request(
            config,
            base +
              "/messages/" +
              encodeURIComponent(draft.id) +
              "?$select=internetMessageId",
            { signal },
          )
        ).json();
        if (sent.internetMessageId) break;
      } catch (error) {
        if (!(error instanceof GraphHttpError) || error.status !== 404)
          throw error;
      }
      if (attempt < 3)
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * 2 ** attempt),
        );
    }
    if (!sent?.internetMessageId)
      throw new Error(
        "Sent message id unavailable; delivery needs reconciliation",
      );
    return { messageId: sent.internetMessageId, providerMessageId: draft.id };
  }
}
export const graphService = new GraphService();
