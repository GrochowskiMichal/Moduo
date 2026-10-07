import { describe, expect, it } from "@rstest/core";

import { resolveAccountHues } from "./accounts";
import type { EmailEnvelope, SavedAccount } from "./model/email-types";
import { shapeInboxThreads, threadsForAccount, unreadCount } from "./threads";

function env(over: Partial<EmailEnvelope>): EmailEnvelope {
  return {
    id: "id",
    messageKey: "mk",
    accountId: "gmail:a@x.com",
    folder: "inbox",
    uid: 1,
    sender: "Alice",
    senderEmail: "alice@x.com",
    to: "a@x.com",
    subject: "Hello",
    preview: "hi there",
    date: "2026-07-01T10:00:00Z",
    read: true,
    starred: false,
    threadId: "thread:1",
    hasCachedBody: false,
    ...over,
  };
}

const accounts: SavedAccount[] = [
  {
    id: "gmail:a@x.com",
    provider: "gmail",
    email: "a@x.com",
    lastSyncAt: null,
    status: "active",
    lastError: null,
  },
  {
    id: "icloud:b@me.com",
    provider: "icloud",
    email: "b@me.com",
    lastSyncAt: null,
    status: "active",
    lastError: null,
  },
];

describe("shapeInboxThreads", () => {
  it("groups messages per (account, thread) and rolls up unread/pin/count", () => {
    const threads = shapeInboxThreads(
      [
        env({ uid: 1, threadId: "t1", read: true, date: "2026-07-01T10:00:00Z", sender: "Alice" }),
        env({
          uid: 2,
          threadId: "t1",
          read: false,
          date: "2026-07-01T12:00:00Z",
          sender: "Bob",
          subject: "Re: Hello",
          preview: "reply",
        }),
        env({
          uid: 3,
          threadId: "t2",
          read: true,
          starred: true,
          date: "2026-07-01T09:00:00Z",
          subject: "Pinned",
        }),
      ],
      accounts,
    );
    expect(threads).toHaveLength(2);
    const t1 = threads.find((t) => t.threadId === "t1")!;
    expect(t1.messageCount).toBe(2);
    expect(t1.unread).toBe(true);
    expect(t1.unreadCount).toBe(1);
    expect(t1.fromName).toBe("Bob"); // newest sender drives the row
    expect(t1.snippet).toBe("reply");
    expect(t1.participants).toEqual(["Alice", "Bob"]); // chronological, deduped
    expect(t1.accountEmail).toBe("a@x.com");
  });

  it("pins starred threads to the top, then sorts newest-first", () => {
    const threads = shapeInboxThreads(
      [
        env({ uid: 1, threadId: "old", date: "2026-07-01T08:00:00Z" }),
        env({ uid: 2, threadId: "new", date: "2026-07-03T08:00:00Z" }),
        env({ uid: 3, threadId: "pinned", date: "2026-06-01T08:00:00Z", starred: true }),
      ],
      accounts,
    );
    expect(threads.map((t) => t.threadId)).toEqual(["pinned", "new", "old"]);
  });

  it("inherits the subject from the newest non-empty message for a bare Re:", () => {
    const threads = shapeInboxThreads(
      [
        env({ uid: 1, threadId: "t", subject: "Project kickoff", date: "2026-07-01T08:00:00Z" }),
        env({ uid: 2, threadId: "t", subject: "(No subject)", date: "2026-07-02T08:00:00Z" }),
      ],
      accounts,
    );
    expect(threads[0].subject).toBe("Project kickoff");
  });

  it("keeps threads of the same thread id on different accounts separate", () => {
    const threads = shapeInboxThreads(
      [
        env({ accountId: "gmail:a@x.com", threadId: "shared" }),
        env({ accountId: "icloud:b@me.com", threadId: "shared" }),
      ],
      accounts,
    );
    expect(threads).toHaveLength(2);
    expect(threadsForAccount(threads, "icloud:b@me.com")).toHaveLength(1);
  });

  it("unreadCount totals across threads", () => {
    const threads = shapeInboxThreads(
      [
        env({ uid: 1, threadId: "a", read: false }),
        env({ uid: 2, threadId: "b", read: false }),
        env({ uid: 3, threadId: "b", read: false }),
      ],
      accounts,
    );
    expect(unreadCount(threads)).toBe(3);
  });
});

describe("resolveAccountHues", () => {
  it("assigns a stable colored hue per account and honors valid overrides", () => {
    const hues = resolveAccountHues(accounts);
    expect(hues["gmail:a@x.com"]).toBeTruthy();
    expect(hues["gmail:a@x.com"]).not.toBe("gray");
    expect(hues["gmail:a@x.com"]).not.toBe(hues["icloud:b@me.com"]);
    // Stable across calls.
    expect(resolveAccountHues(accounts)).toEqual(hues);
    // A valid override wins.
    expect(resolveAccountHues(accounts, { "gmail:a@x.com": "pink" })["gmail:a@x.com"]).toBe("pink");
    // An invalid override is ignored (falls back to the deterministic hue).
    expect(
      resolveAccountHues(accounts, { "gmail:a@x.com": "chartreuse" })["gmail:a@x.com"],
    ).not.toBe("chartreuse");
  });
});
