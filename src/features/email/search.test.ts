import { describe, expect, it } from "vitest";

import type { EmailEnvelope } from "./model/email-types";
import { hitKey, mergeHits, searchEnvelopes, searchTokens } from "./search";

function env(over: Partial<EmailEnvelope>): EmailEnvelope {
  return {
    id: "id",
    messageKey: "mk",
    accountId: "gmail:a@x.com",
    folder: "inbox",
    uid: 1,
    sender: "Alice Nguyen",
    senderEmail: "alice@acme.com",
    to: "me@x.com",
    subject: "Q3 planning",
    preview: "let's sync on the roadmap",
    date: "2026-07-01T10:00:00Z",
    read: true,
    starred: false,
    messageId: "<m1@acme.com>",
    threadId: "thread:1",
    hasCachedBody: false,
    ...over,
  };
}

describe("searchEnvelopes", () => {
  const corpus = [
    env({ uid: 1, sender: "Alice Nguyen", senderEmail: "alice@acme.com", subject: "Q3 planning" }),
    env({
      uid: 2,
      sender: "Bob Ito",
      senderEmail: "bob@globex.com",
      subject: "Invoice #42",
      preview: "attached",
    }),
    env({
      uid: 3,
      sender: "Carol",
      senderEmail: "carol@acme.com",
      subject: "Lunch?",
      preview: "free friday?",
      to: "me@x.com, alice@acme.com",
    }),
  ];

  it("matches over sender, address, recipients, subject and preview", () => {
    expect(searchEnvelopes(corpus, "nguyen").map((e) => e.uid)).toEqual([1]);
    expect(searchEnvelopes(corpus, "globex").map((e) => e.uid)).toEqual([2]);
    expect(searchEnvelopes(corpus, "roadmap").map((e) => e.uid)).toEqual([1]);
    // A recipient address hit (Carol's To line carries alice@).
    expect(
      searchEnvelopes(corpus, "alice@acme.com")
        .map((e) => e.uid)
        .sort(),
    ).toEqual([1, 3]);
  });

  it("requires every token to match (AND), case-insensitively", () => {
    expect(searchEnvelopes(corpus, "q3 planning").map((e) => e.uid)).toEqual([1]);
    expect(searchEnvelopes(corpus, "Q3 lunch")).toHaveLength(0);
  });

  it("returns nothing for an empty/whitespace query", () => {
    expect(searchEnvelopes(corpus, "")).toHaveLength(0);
    expect(searchEnvelopes(corpus, "   ")).toHaveLength(0);
    expect(searchTokens("  a  b ")).toEqual(["a", "b"]);
  });
});

describe("mergeHits", () => {
  it("dedupes a per-account duplicate by Message-ID (Gmail INBOX + All Mail)", () => {
    const inboxHit = env({ folder: "inbox", uid: 5, messageId: "<same@acme.com>" });
    const allMailHit = env({ folder: "[Gmail]/All Mail", uid: 900, messageId: "<same@acme.com>" });
    const merged = mergeHits([inboxHit], [allMailHit]);
    expect(merged).toHaveLength(1);
    // First source (the local inbox hit) wins the kept row.
    expect(merged[0]!.folder).toBe("inbox");
  });

  it("keeps the same Message-ID across two accounts as two rows (attribution)", () => {
    const a = env({ accountId: "gmail:a@x.com", messageId: "<shared@x.com>" });
    const b = env({ accountId: "icloud:b@me.com", messageId: "<shared@x.com>" });
    const merged = mergeHits([a], [b]);
    expect(merged).toHaveLength(2);
    expect(merged.map((e) => e.accountId).sort()).toEqual(["gmail:a@x.com", "icloud:b@me.com"]);
  });

  it("falls back to the message key when a Message-ID is absent", () => {
    const noId = env({ messageId: null, messageKey: "gmail:a@x.com::inbox::7" });
    expect(hitKey(noId)).toBe("gmail:a@x.com::gmail:a@x.com::inbox::7");
    // Two id-less envelopes with distinct keys don't collapse.
    const other = env({ messageId: null, messageKey: "gmail:a@x.com::inbox::8" });
    expect(mergeHits([noId], [other])).toHaveLength(2);
  });

  it("merges server hits after local, deduping the overlap", () => {
    const local = env({ uid: 1, messageId: "<a@x>" });
    const serverDup = env({ uid: 1, messageId: "<a@x>", folder: "[Gmail]/All Mail" });
    const serverNew = env({ uid: 2, messageId: "<b@x>", subject: "older thread" });
    const merged = mergeHits([local], [serverDup, serverNew]);
    expect(merged.map((e) => e.messageId).sort()).toEqual(["<a@x>", "<b@x>"]);
    // The local row (not the server duplicate) is retained.
    expect(merged.find((e) => e.messageId === "<a@x>")!.folder).toBe("inbox");
  });
});
