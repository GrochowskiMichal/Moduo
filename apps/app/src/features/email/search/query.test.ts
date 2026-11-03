import { describe, expect, it } from "@rstest/core";

import {
  emptyMailQuery,
  isMailQueryEmpty,
  mailQuerySuggestions,
  parseMailQuery,
} from "./query";

const MAILBOXES = [
  { id: "mb-1", name: "Receipts", role: "custom" as const },
  { id: "mb-2", name: "Inbox", role: "inbox" as const },
];

describe("parseMailQuery", () => {
  it("keeps plain words, quoted phrases as one word", () => {
    const q = parseMailQuery('budget "q3 plan"');
    expect(q.words).toEqual(["budget", "q3 plan"]);
    expect(q.from).toEqual([]);
  });

  it("parses every operator", () => {
    const q = parseMailQuery(
      'from:alice to:bob subject:"weekly sync" has:attachment is:unread is:pinned in:sent before:2026-03-02 after:2026-01-01 report',
    );
    expect(q.from).toEqual(["alice"]);
    expect(q.to).toEqual(["bob"]);
    expect(q.subject).toEqual(["weekly sync"]);
    expect(q.hasAttachment).toBe(true);
    expect(q.isUnread).toBe(true);
    expect(q.isPinned).toBe(true);
    expect(q.inRole).toBe("sent");
    expect(q.beforeMs).toBe(new Date(2026, 2, 2).getTime());
    expect(q.afterMs).toBe(new Date(2026, 0, 1).getTime());
    expect(q.words).toEqual(["report"]);
  });

  it("is case-insensitive on operator names", () => {
    const q = parseMailQuery("FROM:Alice Has:Attachment");
    expect(q.from).toEqual(["Alice"]);
    expect(q.hasAttachment).toBe(true);
  });

  it("resolves in: to a named mailbox, else a role alias", () => {
    expect(parseMailQuery("in:receipts", { mailboxes: MAILBOXES }).inMailboxId).toBe("mb-1");
    expect(parseMailQuery("in:done").inRole).toBe("archive");
    expect(parseMailQuery("in:junk").inRole).toBe("spam");
  });

  it("treats unknown operators, bad dates and empty values as words", () => {
    const q = parseMailQuery("http://x.com before:soon from: in:nowhere");
    expect(q.words).toEqual(["http://x.com", "before:soon", "from:", "in:nowhere"]);
    expect(q.beforeMs).toBeNull();
  });

  it("knows an empty query", () => {
    expect(isMailQueryEmpty(parseMailQuery("   "))).toBe(true);
    expect(isMailQueryEmpty(emptyMailQuery())).toBe(true);
    expect(isMailQueryEmpty(parseMailQuery("is:unread"))).toBe(false);
  });
});

describe("mailQuerySuggestions", () => {
  it("completes an operator name", () => {
    const s = mailQuerySuggestions("budget fr");
    expect(s.map((x) => x.text)).toEqual(["budget from:"]);
  });

  it("offers values after is:, has: and in:", () => {
    expect(mailQuerySuggestions("is:").map((x) => x.text)).toEqual(["is:unread ", "is:pinned "]);
    expect(mailQuerySuggestions("has:").map((x) => x.text)).toEqual(["has:attachment "]);
    const inS = mailQuerySuggestions("in:re", { mailboxes: MAILBOXES }).map((x) => x.text);
    expect(inS).toContain("in:receipts ");
  });

  it("suggests known senders after from:", () => {
    const s = mailQuerySuggestions("from:al", { people: ["alice@acme.com", "bob@x.com"] });
    expect(s.map((x) => x.text)).toEqual(["from:alice@acme.com "]);
  });

  it("offers nothing for a finished word", () => {
    expect(mailQuerySuggestions("budget ")).toEqual([]);
    expect(mailQuerySuggestions("")).toEqual([]);
  });
});
