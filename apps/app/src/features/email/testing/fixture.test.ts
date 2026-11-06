import { describe, expect, it } from "@rstest/core";

import { FIXTURE_ACCOUNTS, generateFixture } from "./fixture";

describe("mail fixture", () => {
  it("is deterministic for a seed", () => {
    const a = generateFixture({ messages: 2000 });
    const b = generateFixture({ messages: 2000 });
    expect(a.messages).toEqual(b.messages);
    expect(generateFixture({ messages: 2000, seed: 7 }).messages).not.toEqual(a.messages);
  });

  it("is the 100k, 6-account reference mailbox by default", () => {
    const f = generateFixture();
    expect(f.messages).toHaveLength(100_000);
    expect(f.accounts).toHaveLength(6);
    expect(new Set(f.messages.map((m) => m.accountId))).toEqual(
      new Set(FIXTURE_ACCOUNTS.map((a) => a.id)),
    );
    expect(new Set(f.messages.map((m) => m.id)).size).toBe(100_000);
    const threads = new Set(f.messages.map((m) => m.threadId));
    expect(threads.size).toBeGreaterThan(30_000);
    expect(f.messages.some((m) => m.listUnsubscribe)).toBe(true);
    expect(f.messages.some((m) => m.mailboxRole === "sent")).toBe(true);
  });

  it("threads link by In-Reply-To", () => {
    const { messages } = generateFixture({ messages: 500 });
    const replies = messages.filter((m) => m.inReplyTo);
    expect(replies.length).toBeGreaterThan(0);
    const ids = new Map(messages.map((m) => [m.messageId, m.threadId]));
    for (const r of replies) expect(ids.get(r.inReplyTo!)).toBe(r.threadId);
  });
});
