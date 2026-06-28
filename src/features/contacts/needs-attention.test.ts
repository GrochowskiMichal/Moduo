// AC11 proof: the needs-attention selector flags overdue follow-ups, no-touch
// (active > 14d), and stale leads (> 30d) at the threshold boundaries, with
// overdue winning the priority.

import { describe, expect, it } from "vitest";

import { selectNeedsAttention, type OverdueFollowup } from "./needs-attention";
import type { Contact } from "./model";

const NOW = new Date("2026-06-27T12:00:00Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

function contact(over: Partial<Contact>): Contact {
  return {
    id: "c0",
    workspaceId: "w",
    ownerId: "u",
    name: "Someone",
    email: null,
    emails: [],
    phone: null,
    phones: [],
    addresses: [],
    urls: [],
    dates: [],
    title: null,
    companyId: null,
    status: "active",
    custom: {},
    isFavorite: false,
    notesInline: "",
    avatarUrl: null,
    createdAt: daysAgo(100),
    updatedAt: daysAgo(0),
    deletedAt: null,
    ...over,
  };
}

describe("selectNeedsAttention", () => {
  it("flags an active contact untouched > 14 days, but not at/under the threshold", () => {
    const flagged = contact({ id: "a", name: "Idle", status: "active", updatedAt: daysAgo(15) });
    const ok = contact({ id: "b", name: "Fresh", status: "active", updatedAt: daysAgo(14) });
    const items = selectNeedsAttention({ contacts: [flagged, ok], overdue: [], now: NOW });
    expect(items.map((i) => i.contactId)).toEqual(["a"]);
    expect(items[0]).toMatchObject({ reason: "no-touch", detail: "No touch in 15 days" });
  });

  it("flags a stale lead > 30 days, but not at/under the threshold", () => {
    const stale = contact({ id: "a", name: "Cold", status: "lead", updatedAt: daysAgo(31) });
    const ok = contact({ id: "b", name: "Warm", status: "lead", updatedAt: daysAgo(30) });
    const items = selectNeedsAttention({ contacts: [stale, ok], overdue: [], now: NOW });
    expect(items.map((i) => i.contactId)).toEqual(["a"]);
    expect(items[0].reason).toBe("stale-lead");
  });

  it("does not flag dormant/archived contacts for idleness", () => {
    const dormant = contact({ id: "a", status: "dormant", updatedAt: daysAgo(90) });
    const archived = contact({ id: "b", status: "archived", updatedAt: daysAgo(90) });
    expect(selectNeedsAttention({ contacts: [dormant, archived], overdue: [], now: NOW })).toEqual([]);
  });

  it("flags an overdue follow-up regardless of status, and it wins over idleness", () => {
    const c = contact({ id: "a", name: "Owes", status: "active", updatedAt: daysAgo(40) });
    const overdue: OverdueFollowup[] = [{ contactId: "a", dueDate: "2026-06-24" }];
    const items = selectNeedsAttention({ contacts: [c], overdue, now: NOW });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ reason: "overdue-followup", detail: "Follow-up due 3 days ago" });
  });

  it("orders most-urgent first (overdue → no-touch → stale-lead), then by name", () => {
    const lead = contact({ id: "l", name: "Zed", status: "lead", updatedAt: daysAgo(40) });
    const idle = contact({ id: "i", name: "Mara", status: "active", updatedAt: daysAgo(20) });
    const owes = contact({ id: "o", name: "Ann", status: "active", updatedAt: daysAgo(1) });
    const items = selectNeedsAttention({
      contacts: [lead, idle, owes],
      overdue: [{ contactId: "o", dueDate: "2026-06-20" }],
      now: NOW,
    });
    expect(items.map((i) => i.reason)).toEqual(["overdue-followup", "no-touch", "stale-lead"]);
  });
});
