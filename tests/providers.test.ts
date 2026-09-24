import { it, expect, vi, afterEach } from "vitest";
import { GraphService } from "../backend/src/modules/email/graph.service.js";
import { ImapWorker } from "../backend/src/modules/email/imap.worker.js";
import { TicketsRepository } from "../backend/src/modules/tickets/tickets.repository.js";
import { MailboxesRepository } from "../backend/src/modules/mailboxes/mailboxes.repository.js";
import { createTestDb } from "./test-db.js";
const config = {
  tenantId: "tenant",
  clientId: "client",
  clientSecret: " secret ",
  mailboxEmail: "box@example.com",
};
afterEach(() => vi.restoreAllMocks());
it("uses Graph delta checkpoints, immutable identifiers, and bounded MIME reads", async () => {
  const calls: Array<[string, RequestInit | undefined]> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, options?: RequestInit) => {
      calls.push([String(url), options]);
      if (String(url).includes("/token"))
        return Response.json({ access_token: "fake-token", expires_in: 3600 });
      if (String(url).endsWith("$value"))
        return new Response("From: customer@example.com\r\n\r\nhello");
      return Response.json({
        value: [{ id: "one" }, { id: "deleted", "@removed": {} }],
        "@odata.deltaLink": "https://graph.microsoft.com/v1.0/checkpoint",
      });
    }),
  );
  try {
    const graph = new GraphService(),
      page = await graph.fetchPage(config);
    expect(page.ids).toEqual(["one"]);
    expect(page.cursor).toContain("checkpoint");
    expect((await graph.getMime(config, "one")).toString()).toContain("hello");
    expect(calls[1][0]).toContain("/messages/delta?$select=id");
    expect(calls[1][1]?.headers).toMatchObject({
      Prefer: 'IdType="ImmutableId", odata.maxpagesize=10',
    });
    await expect(
      graph.fetchPage(config, "https://evil.invalid/steal"),
    ).rejects.toThrow("Invalid Graph cursor");
  } finally {
    vi.unstubAllGlobals();
  }
});
it("uses a provider reply draft and stores the actual internet message ID", async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any) => {
      const value = String(url);
      calls.push(value);
      if (value.includes("/token"))
        return Response.json({ access_token: "fake-token", expires_in: 3600 });
      if (value.endsWith("/createReply"))
        return Response.json({ id: "immutable-draft" });
      if (value.endsWith("/send")) return new Response(null, { status: 202 });
      return Response.json({ internetMessageId: "<real@provider>" });
    }),
  );
  try {
    const sent = await new GraphService().sendMail(config, {
      to: "customer@example.com",
      subject: "Question",
      text: "Answer",
      providerMessageId: "original",
    });
    expect(
      calls.some((c) => c.includes("/messages/original/createReply")),
    ).toBe(true);
    expect(sent).toEqual({
      messageId: "<real@provider>",
      providerMessageId: "immutable-draft",
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
it("ingests old IMAP UIDs in order and flags/checkpoints in UID mode", async () => {
  const db = await createTestDb();
  try {
    const mailboxes = new MailboxesRepository(db.db),
      repo = new TicketsRepository(db.db);
    const mailbox = await mailboxes.create({
      name: "IMAP",
      email: "box@test",
      provider: "imap",
      imapHost: "imap.test",
      imapUser: "box",
      imapPassword: " secret ",
    });
    const worker = new ImapWorker(repo, undefined, mailboxes);
    const mock = {
      mailbox: { uidValidity: 123n, uidNext: 503 },
      connect: vi.fn(),
      getMailboxLock: async () => ({ release: vi.fn() }),
      search: vi.fn(async () => [502, 500]),
      fetchOne: vi.fn(async (uid: string, query: any) =>
        query.size
          ? { size: 100 }
          : {
              source: Buffer.from(
                "From: customer@example.com\r\nMessage-ID: <uid" +
                  uid +
                  "@test>\r\nSubject: old\r\nDate: 1 Jan 2020 00:00:00 +0000\r\n\r\nbody",
              ),
            },
      ),
      messageFlagsAdd: vi.fn(),
      logout: vi.fn(),
      close: vi.fn(),
    };
    (worker as any).createClientForConfig = () => mock;
    expect(await worker.fetchAndProcessMailbox(mailbox)).toBe(2);
    expect(mock.search).toHaveBeenCalledWith({ uid: "1:502" }, { uid: true });
    expect(mock.messageFlagsAdd.mock.calls).toEqual([
      [[500], ["\\Seen"], { uid: true }],
      [[502], ["\\Seen"], { uid: true }],
    ]);
    expect((await mailboxes.findById(mailbox.id))?.syncCursor).toBe("502");
    await mailboxes.update(mailbox.id, { isActive: false });
    expect(await worker.fetchAndProcess()).toBe(0);
  } finally {
    await db.cleanup();
  }
});
