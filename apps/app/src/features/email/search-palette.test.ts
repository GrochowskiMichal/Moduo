// GS-9 — Email in the ⌘K palette (specs/global-search.md AC12, Assumption 15,
// Q17, Q17b). Desktop: this device's own mail search joins the Email group,
// newest first, inbox-only and only for accounts connected here. Web: only the
// `email_refs` threads `search_all` already returned, untouched.

import type { SearchAllRow } from "@contracts/search";
import { SEARCH_SNIPPET_END, SEARCH_SNIPPET_START } from "@contracts/search";
import { describe, expect, it } from "@rstest/core";

import { buildPaletteView } from "../../lib/palette-search";
import type { EmailEnvelope, SavedAccount } from "./model/email-types";
import { localMailRows, mailBodyQuery, mergeMailRows } from "./search-palette";

const ACCOUNTS: SavedAccount[] = [
  {
    id: "acc-1",
    provider: "custom",
    email: "me@example.com",
    lastSyncAt: null,
    status: "active",
    lastError: null,
  },
  {
    id: "acc-2",
    provider: "custom",
    email: "work@example.com",
    lastSyncAt: null,
    status: "active",
    lastError: null,
  },
];

let uid = 0;
function env(extra: Partial<EmailEnvelope> & { threadId: string; date: string }): EmailEnvelope {
  uid += 1;
  return {
    id: `env-${uid}`,
    messageKey: `key-${uid}`,
    accountId: "acc-1",
    folder: "inbox",
    uid,
    sender: "Ada Lovelace",
    senderEmail: "ada@example.com",
    to: "me@example.com",
    subject: "Hello",
    preview: "",
    read: true,
    starred: false,
    messageId: `<m-${uid}@example.com>`,
    hasCachedBody: false,
    ...extra,
  };
}

function serverRow(id: string, extra: Partial<SearchAllRow> = {}): SearchAllRow {
  return {
    entity_type: "email_thread",
    entity_id: id,
    title: id,
    context: null,
    snippet: null,
    icon: null,
    match: "title",
    rank: 0.5,
    updated_at: "2026-10-01T00:00:00Z",
    archived: false,
    score: 0.5,
    type_total: 1,
    top: false,
    ...extra,
  };
}

describe("desktop mail group, web pulled-in only", () => {
  it("desktop: local subject matches become Email rows, newest first", () => {
    const envelopes = [
      env({ threadId: "t-old", date: "2026-09-01T10:00:00Z", subject: "Budget review" }),
      env({ threadId: "t-new", date: "2026-10-20T10:00:00Z", subject: "Budget for Q4" }),
      env({ threadId: "t-mid", date: "2026-10-05T10:00:00Z", subject: "Re: budget" }),
      env({ threadId: "t-miss", date: "2026-10-25T10:00:00Z", subject: "Lunch" }),
    ];
    const rows = localMailRows({
      envelopes,
      bodyHits: [],
      accounts: ACCOUNTS,
      refs: [],
      query: "budget",
    });
    expect(rows.map((r) => r.entity_id)).toEqual(["t-new", "t-mid", "t-old"]);
    for (const r of rows) {
      expect(r.entity_type).toBe("email_thread");
      expect(r.match).toBe("title");
      expect(r.snippet).toBeNull();
      expect(r.context).toBe("Ada Lovelace");
      expect(r.top).toBe(false);
      expect(r.rank).toBeGreaterThanOrEqual(0);
      expect(r.rank).toBeLessThanOrEqual(1);
    }
    expect(rows[0]?.title).toBe("Budget for Q4");
    expect(rows[0]?.updated_at).toBe(new Date("2026-10-20T10:00:00Z").toISOString());
  });

  it("desktop: every word must match, in any order; an excluded word drops the thread", () => {
    const envelopes = [
      env({ threadId: "t-a", date: "2026-10-01T00:00:00Z", subject: "Invoice from Acme" }),
      env({ threadId: "t-b", date: "2026-10-02T00:00:00Z", subject: "Acme invoice draft" }),
      env({ threadId: "t-c", date: "2026-10-03T00:00:00Z", subject: "Invoice only" }),
    ];
    const ids = (query: string) =>
      localMailRows({ envelopes, bodyHits: [], accounts: ACCOUNTS, refs: [], query }).map(
        (r) => r.entity_id,
      );
    expect(ids("acme invoice")).toEqual(["t-b", "t-a"]);
    expect(ids("invoice -draft")).toEqual(["t-c", "t-a"]);
    expect(ids('"invoice"')).toEqual(["t-c", "t-b", "t-a"]);
  });

  it("desktop: a body-only hit from the Rust scan joins as a body match with a marked snippet", () => {
    const body = env({
      threadId: "t-body",
      date: "2026-10-10T00:00:00Z",
      subject: "Weekly sync",
      preview: "Notes from today: the quarterly roadmap is final.",
    });
    const rows = localMailRows({
      envelopes: [],
      bodyHits: [body],
      accounts: ACCOUNTS,
      refs: [],
      query: "roadmap",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.match).toBe("body");
    expect(rows[0]?.snippet).toContain(`${SEARCH_SNIPPET_START}roadmap${SEARCH_SNIPPET_END}`);
  });

  it("desktop: the same message found twice is one row", () => {
    const a = env({ threadId: "t-1", date: "2026-10-10T00:00:00Z", subject: "Contract" });
    const rows = localMailRows({
      envelopes: [a],
      bodyHits: [{ ...a }],
      accounts: ACCOUNTS,
      refs: [],
      query: "contract",
    });
    expect(rows).toHaveLength(1);
  });

  it("desktop: inbox only, and only accounts connected on this device", () => {
    const envelopes = [
      env({ threadId: "t-in", date: "2026-10-01T00:00:00Z", subject: "Offer" }),
      env({ threadId: "t-sent", date: "2026-10-02T00:00:00Z", subject: "Offer", folder: "sent" }),
      env({
        threadId: "t-trash",
        date: "2026-10-03T00:00:00Z",
        subject: "Offer",
        folder: "trash",
      }),
      env({
        threadId: "t-gone",
        date: "2026-10-04T00:00:00Z",
        subject: "Offer",
        accountId: "acc-removed",
      }),
      env({
        threadId: "t-work",
        date: "2026-10-05T00:00:00Z",
        subject: "Offer",
        accountId: "acc-2",
      }),
    ];
    const rows = localMailRows({
      envelopes,
      bodyHits: [],
      accounts: ACCOUNTS,
      refs: [],
      query: "offer",
    });
    expect(rows.map((r) => r.entity_id)).toEqual(["t-work", "t-in"]);
  });

  it("desktop: a thread already pulled into Moduo carries its email_refs id", () => {
    const rows = localMailRows({
      envelopes: [env({ threadId: "t-ref", date: "2026-10-01T00:00:00Z", subject: "Proposal" })],
      bodyHits: [],
      accounts: ACCOUNTS,
      refs: [{ id: "ref-uuid-1", threadKey: "t-ref" }],
      query: "proposal",
    });
    expect(rows[0]?.entity_id).toBe("ref-uuid-1");
  });

  it("desktop: an empty, one-letter or only-negative query searches nothing", () => {
    const envelopes = [env({ threadId: "t", date: "2026-10-01T00:00:00Z", subject: "a b" })];
    for (const query of ["", " ", "a", "-a", "-foo -bar"]) {
      expect(
        localMailRows({ envelopes, bodyHits: [], accounts: ACCOUNTS, refs: [], query }),
      ).toEqual([]);
      expect(mailBodyQuery(query)).toBeNull();
    }
    expect(mailBodyQuery('"quarterly roadmap" -draft')).toBe("quarterly roadmap");
  });

  it("desktop: merged into the server's answer, the Email group is newest first, 3 rows and Show all", () => {
    const local = localMailRows({
      envelopes: [1, 2, 3, 4, 5].map((d) =>
        env({ threadId: `t-${d}`, date: `2026-10-0${d}T00:00:00Z`, subject: "Plan" }),
      ),
      bodyHits: [],
      accounts: ACCOUNTS,
      refs: [{ id: "ref-3", threadKey: "t-3" }],
      query: "plan",
    });
    const task: SearchAllRow = {
      ...serverRow("task-1", { entity_type: "task", top: true, score: 0.9 }),
    };
    // The server already knows t-3 (pulled in) and one thread this device lacks.
    const server = [
      task,
      serverRow("ref-3", { updated_at: "2026-09-01T00:00:00Z", type_total: 2 }),
      serverRow("ref-elsewhere", { updated_at: "2026-10-04T12:00:00Z", type_total: 2 }),
    ];
    const merged = mergeMailRows(server, local);
    const mail = merged.filter((r) => r.entity_type === "email_thread");
    expect(mail.map((r) => r.entity_id)).toEqual([
      "t-5",
      "ref-elsewhere",
      "t-4",
      "ref-3",
      "t-2",
      "t-1",
    ]);
    // A thread both sources found is one row.
    expect(mail.filter((r) => r.entity_id === "ref-3")).toHaveLength(1);
    // The other groups pass through untouched.
    expect(merged.filter((r) => r.entity_type === "task")).toEqual([task]);

    const view = buildPaletteView(merged, { chip: "all" });
    const email = view.groups.find((g) => g.key === "email");
    expect(email?.rows.map((r) => r.entity_id)).toEqual(["t-5", "ref-elsewhere", "t-4"]);
    expect(email?.total).toBe(6);
    expect(email?.more).toBe(true);
    expect(view.top?.entity_id).toBe("task-1");
  });

  it("desktop: the server still counts mail it didn't send in Show all", () => {
    const local = localMailRows({
      envelopes: [env({ threadId: "t-1", date: "2026-10-01T00:00:00Z", subject: "Plan" })],
      bodyHits: [],
      accounts: ACCOUNTS,
      refs: [],
      query: "plan",
    });
    const server = [serverRow("ref-a", { type_total: 12 }), serverRow("ref-b", { type_total: 12 })];
    const merged = mergeMailRows(server, local);
    const view = buildPaletteView(merged, { chip: "all" });
    expect(view.groups.find((g) => g.key === "email")?.total).toBe(13);
  });

  it("desktop: a pulled-in thread the server ranked Top stays Top", () => {
    const local = localMailRows({
      envelopes: [env({ threadId: "t-ref", date: "2026-10-01T00:00:00Z", subject: "Plan" })],
      bodyHits: [],
      accounts: ACCOUNTS,
      refs: [{ id: "ref-1", threadKey: "t-ref" }],
      query: "plan",
    });
    const merged = mergeMailRows([serverRow("ref-1", { top: true })], local);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.top).toBe(true);
    expect(buildPaletteView(merged, { chip: "all" }).top?.entity_id).toBe("ref-1");
  });

  it("desktop: offline, the device's mail still answers on its own", () => {
    const local = localMailRows({
      envelopes: [env({ threadId: "t-1", date: "2026-10-01T00:00:00Z", subject: "Plan" })],
      bodyHits: [],
      accounts: ACCOUNTS,
      refs: [],
      query: "plan",
    });
    const view = buildPaletteView(mergeMailRows([], local), { chip: "email" });
    expect(view.groups.map((g) => g.key)).toEqual(["email"]);
    expect(view.groups[0]?.rows.map((r) => r.entity_id)).toEqual(["t-1"]);
  });

  it("web: no local mail, only the email_refs threads search_all returned, untouched", () => {
    const server = [
      serverRow("task-1", { entity_type: "task", top: true }),
      serverRow("ref-b", { updated_at: "2026-09-01T00:00:00Z", rank: 0.9 }),
      serverRow("ref-a", { updated_at: "2026-10-01T00:00:00Z", rank: 0.4 }),
    ];
    expect(mergeMailRows(server, null)).toEqual(server);
    const view = buildPaletteView(mergeMailRows(server, null), { chip: "all" });
    expect(view.groups.find((g) => g.key === "email")?.rows.map((r) => r.entity_id)).toEqual([
      "ref-b",
      "ref-a",
    ]);
  });
});
