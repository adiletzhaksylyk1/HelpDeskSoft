import nodemailer from "nodemailer";
import type { Transporter, SendMailOptions } from "nodemailer";
import { getEnvConfig } from "../../config/env.js";
import { logger } from "../../shared/logger.js";
import type { MailboxesRepository } from "../mailboxes/mailboxes.repository.js";
import type { Mailbox } from "../../db/schema.js";

import { graphService } from "./graph.service.js";

export interface SendReplyOptions {
  to: string;
  subject: string;
  text: string;
  messageId?: string;
  providerMessageId?: string;
  inReplyToMessageId?: string;
  references?: string[];
  mailboxId?: string | null;
  from?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
}

export interface SendResult {
  providerMessageId?: string;
  messageId: string;
  accepted: string[];
}

export class SmtpService {
  private defaultTransporter: Transporter | null = null;

  constructor(private readonly mailboxesRepo?: MailboxesRepository) {
    this.initDefaultTransporter();
  }

  private initDefaultTransporter(): void {
    const env = getEnvConfig();
    if (!env.SMTP_HOST || !env.SMTP_USER) {
      logger.info(
        "No default SMTP sender configured; outgoing replies require a linked mailbox.",
      );
      return;
    }

    this.defaultTransporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 60000,
      requireTLS: true,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASSWORD || "",
      },
    });
  }

  private getTransporterForMailbox(mailbox: Mailbox): Transporter {
    const transporter = nodemailer.createTransport({
      host: mailbox.smtpHost,
      port: mailbox.smtpPort,
      secure: mailbox.smtpSecure,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 60000,
      requireTLS: true,
      auth: {
        user: mailbox.smtpUser,
        pass: mailbox.smtpPassword || "",
      },
    });

    return transporter;
  }

  async validateMailbox(mailboxId?: string | null): Promise<void> {
    if (mailboxId) {
      const mb = await this.mailboxesRepo?.findById(mailboxId);
      if (!mb?.isActive) throw new Error("Mailbox unavailable");
      if (
        mb.provider === "graph"
          ? !(mb.msTenantId && mb.msClientId && mb.msClientSecret)
          : !(mb.smtpHost && mb.smtpUser && mb.smtpPassword)
      )
        throw new Error("Mailbox credentials incomplete");
    } else {
      const env = getEnvConfig();
      if (!env.SMTP_HOST || !env.SMTP_USER)
        throw new Error("Default SMTP unavailable");
    }
  }
  async sendReply(options: SendReplyOptions): Promise<SendResult> {
    if (options.mailboxId && !this.mailboxesRepo)
      throw new Error("Mailbox repository unavailable");
    const env = getEnvConfig();
    let transporter = this.defaultTransporter;
    let senderAddress = options.from || env.SMTP_FROM;

    // Check if reply belongs to a specific mailbox
    if (options.mailboxId && this.mailboxesRepo) {
      const mailbox = await this.mailboxesRepo.findById(options.mailboxId);
      if (!mailbox?.isActive) throw new Error("Mailbox is missing or disabled");
      if (mailbox) {
        if (mailbox.provider === "graph") {
          if (
            !mailbox.msTenantId ||
            !mailbox.msClientId ||
            !mailbox.msClientSecret
          ) {
            throw new Error(
              `Mailbox ${mailbox.email} is configured for Microsoft Graph, but is missing Entra ID credentials.`,
            );
          }
          const result = await graphService.sendMail(
            {
              tenantId: mailbox.msTenantId,
              clientId: mailbox.msClientId,
              clientSecret: mailbox.msClientSecret,
              mailboxEmail: mailbox.email,
            },
            {
              providerMessageId: options.providerMessageId,
              to: options.to,
              subject: options.subject,
              text: options.text,
              inReplyToMessageId: options.inReplyToMessageId,
              references: options.references,
              attachments: options.attachments,
            },
          );
          return {
            messageId: result.messageId,
            providerMessageId: result.providerMessageId,
            accepted: [options.to],
          };
        } else if (mailbox.smtpHost && mailbox.smtpUser) {
          transporter = this.getTransporterForMailbox(mailbox);
          senderAddress = `${mailbox.name} <${mailbox.email}>`;
        } else {
          throw new Error("Mailbox SMTP configuration incomplete");
        }
      }
    }

    if (!transporter) {
      this.initDefaultTransporter();
      transporter = this.defaultTransporter;
    }

    if (!transporter) {
      throw new Error("SMTP transporter is not configured");
    }

    const mailOptions: SendMailOptions = {
      messageId: options.messageId,
      from: senderAddress,
      to: options.to,
      subject: options.subject.startsWith("Re:")
        ? options.subject
        : `Re: ${options.subject}`,
      text: options.text,
      inReplyTo: options.inReplyToMessageId,
      references:
        options.references && options.references.length > 0
          ? options.references.join(" ")
          : options.inReplyToMessageId,
      attachments: options.attachments,
    };

    logger.info(
      { messageId: options.messageId, mailboxId: options.mailboxId },
      "Sending email reply via SMTP",
    );

    try {
      const info = await transporter.sendMail(mailOptions);
      logger.info(
        { messageId: info.messageId, to: options.to, from: senderAddress },
        "Email reply sent successfully",
      );
      return {
        messageId: info.messageId,
        accepted: (info.accepted as string[]) || [options.to],
      };
    } catch (error) {
      logger.error(
        { error, to: options.to, from: senderAddress },
        "Failed to send email reply via SMTP",
      );
      throw error;
    }
  }
}
