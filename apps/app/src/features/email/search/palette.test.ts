import { describe, expect, it } from "@rstest/core";

import type { EmailSettingsItem } from "../../../lib/runtime.types.email";
import type { MailThreadRow } from "../../../lib/runtime.types.mail-engine";
import { createFakeMailEngine } from "../testing/fake-engine";
import {
  engineMailRows,
  isSavedSearch,
  readSavedSearches,
  savedSearchValue,
  serverMailRows,
} from "./palette";
import { parseMailQuery } from "./query";

function row(over: Partial<MailThreadRow>): MailThreadRow {
  return {
    threadId: "t1",
    accountId: "a",
    subject: "Hello",
    snippet: "",
    senders: [{ name: "Alice", email: "alice@x.com" }],
    lastDateMs: 1000,
    messageCount: 1,
    unread: false,
    pinned: false,
    hasAttachments: false,
    hasInvite: false,
    tab: "personal",
    priority: false,
    muted: false,
    snoozedUntilMs: null,
    ...over,
  } as MailThreadRow;
}

function item(over: Partial<EmailSettingsItem>): EmailSettingsItem {
  return {
    id: "s1",
    kind: "saved_search",
    position: 0,
    value: { name: "Receipts", query: "has:attachment receipt" },
    updatedAt: "",
    deletedAt: null,
    ...over,
  };
}

describe("engineMailRows", () => {
  it("shapes threads newest first, a pulled-in thread by its ref id", () => {
    const rows = engineMailRows(
      [row({ threadId: "old", lastDateMs: 1 }), row({ threadId: "new", lastDateMs: 9 })],
      new Map([["old", "ref-1"]]),
    );
    expect(rows.map((r) => r.entity_id)).toEqual(["new", "ref-1"]);
    expect(rows[0]?.entity_type).toBe("email_thread");
    expect(rows[0]?.context).toBe("Alice");
  });
});

describe("serverMailRows", () => {
  it("dedupes per thread and names a subjectless hit", () => {
    const rows = serverMailRows([
      { threadId: "x", subject: "", sender: "Bob", timestampMs: 5 },
      { threadId: "x", subject: "dup" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("(no subject)");
  });
});

describe("saved searches", () => {
  it("reads live items in order and skips tombstones and other kinds", () => {
    const saved = readSavedSearches([
      item({ id: "b", position: 2 }),
      item({ id: "a", position: 1, value: savedSearchValue("from:bob") }),
      item({ id: "c", deletedAt: "x" }),
      item({ id: "d", kind: "snippet" as EmailSettingsItem["kind"] }),
    ]);
    expect(saved.map((s) => s.id)).toEqual(["a", "b"]);
    expect(saved[0]?.name).toBe("from:bob");
    expect(isSavedSearch(saved, "  FROM:bob ")).toBe(true);
  });
});

describe("the engine runs the parsed query", () => {
  it("filters by operator over the fixture", async () => {
    const engine = createFakeMailEngine();
    const all = await engine.search({ query: parseMailQuery("is:unread"), limit: 20 });
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((r) => r.unread)).toBe(true);
    const none = await engine.search({ query: parseMailQuery(""), limit: 20 });
    expect(none).toEqual([]);
  });
});
