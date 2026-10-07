// Proves AC2 — the auto-rollup hub derives last-touch + open-items + grouped
// history from links + activity, with zero manual logging. Pure reducer; the
// live reads are the hook's job.

import { describe, expect, it } from "@rstest/core";
import type { EntityLink, EntityRecord, EntityRef } from "../../lib/entity-links";
import { entityRefKey } from "../spine/rollup";
import type { ActivityEntry } from "../tasks/model";
import { buildContactRollup, type ContactRollupInput, lastTouchLine, timeAgo } from "./rollup";

const FOCUS: EntityRef = { type: "contact", id: "c1" };
const NOW = new Date("2026-06-27T12:00:00Z");

let seq = 0;
function link(other: EntityRef, kind: EntityLink["relationKind"], createdAt: string): EntityLink {
  seq += 1;
  return {
    id: `l${seq}`,
    workspaceId: "w",
    sourceType: FOCUS.type,
    sourceId: FOCUS.id,
    targetType: other.type,
    targetId: other.id,
    relationKind: kind,
    origin: "manual",
    createdBy: "u1",
    createdAt,
    deletedAt: null,
  };
}
function rec(ref: EntityRef, label: string): EntityRecord {
  return { workspaceId: "w", type: ref.type, id: ref.id, label, icon: null, deletedAt: null };
}
function activity(op: string, createdAt: string): ActivityEntry {
  return {
    id: `a${createdAt}`,
    workspaceId: "w",
    module: "contacts",
    entityType: "contact",
    entityId: "c1",
    op,
    actorType: "user",
    actorId: "u1",
    actorLabel: "Mike",
    payload: {},
    createdAt,
  };
}

const t1: EntityRef = { type: "task", id: "t1" };
const t2: EntityRef = { type: "task", id: "t2" };
const note: EntityRef = { type: "note", id: "n1" };

function input(over: Partial<ContactRollupInput> = {}): ContactRollupInput {
  return {
    focus: FOCUS,
    links: [
      link(t1, "follow-up", "2026-06-24T09:00:00Z"),
      link(t2, "references", "2026-06-20T09:00:00Z"),
      link(note, "mentions", "2026-06-22T09:00:00Z"),
    ],
    records: new Map([
      [entityRefKey(t1), rec(t1, "Send proposal")],
      [entityRefKey(t2), rec(t2, "Old task")],
      [entityRefKey(note), rec(note, "Account plan")],
    ]),
    activity: [activity("contacts.set_status", "2026-06-25T10:00:00Z")],
    openTaskKeys: new Set([entityRefKey(t1)]), // t1 open, t2 done
    ...over,
  };
}

describe("buildContactRollup", () => {
  it("groups history into the fixed hub sections by relation_kind/type", () => {
    const { sections } = buildContactRollup(input());
    // tasks → open-work, note → notes (the fixed spine order)
    expect(sections.map((s) => s.key)).toEqual(["open-work", "notes"]);
    expect(sections.find((s) => s.key === "open-work")?.count).toBe(2);
  });

  it("prefers a real interaction (a link) over a record edit for last touch (FX-4 AC7)", () => {
    // set_status (06-25) is a record edit; the newest interaction is the t1 link
    // (06-24), so the link wins even though it's older — a record edit never
    // beats an interaction for the verb.
    const r = buildContactRollup(input());
    expect(r.lastTouchAt).toBe("2026-06-24T09:00:00Z");
    expect(r.lastTouchActivity).toBeNull();
  });

  it("falls back to a record edit only when no interaction exists (FX-4 AC7)", () => {
    const r = buildContactRollup(
      input({
        links: [],
        activity: [
          activity("contacts.update", "2026-06-25T10:00:00Z"),
          activity("contacts.create", "2026-06-20T09:00:00Z"),
        ],
      }),
    );
    expect(r.lastTouchAt).toBe("2026-06-25T10:00:00Z");
    expect(r.lastTouchActivity?.op).toBe("contacts.update");
  });

  it("a comment (interaction) beats a newer record edit for the verb (FX-4 AC7)", () => {
    const r = buildContactRollup(
      input({
        links: [],
        activity: [
          activity("contacts.update", "2026-06-26T10:00:00Z"), // newer record edit
          activity("comments.add", "2026-06-24T10:00:00Z"), // older interaction
        ],
      }),
    );
    expect(r.lastTouchActivity?.op).toBe("comments.add");
    expect(r.lastTouchAt).toBe("2026-06-24T10:00:00Z");
  });

  it("a link newer than any activity becomes the last touch (verb-less)", () => {
    const r = buildContactRollup(
      input({
        links: [link(t1, "follow-up", "2026-06-26T18:00:00Z")],
        activity: [activity("contacts.create", "2026-06-25T10:00:00Z")],
      }),
    );
    expect(r.lastTouchAt).toBe("2026-06-26T18:00:00Z");
    expect(r.lastTouchActivity).toBeNull();
  });

  it("counts only the linked tasks the hook flagged open (status ≠ done)", () => {
    const r = buildContactRollup(input());
    expect(r.openTaskCount).toBe(1); // t1 open; t2 excluded
    expect(r.unpaidPaymentCount).toBe(0); // Finance not shipped
  });

  it("a brand-new contact with no links or activity has no last touch", () => {
    const r = buildContactRollup(input({ links: [], activity: [], records: new Map() }));
    expect(r.sections).toEqual([]);
    expect(r.lastTouchAt).toBeNull();
    expect(r.openTaskCount).toBe(0);
  });
});

describe("lastTouchLine", () => {
  it("reads as a quiet sentence with verb, relative time, and open count", () => {
    // The t1 link (06-24, an interaction) wins over the 06-25 record edit (FX-4).
    expect(lastTouchLine(buildContactRollup(input()), NOW)).toBe(
      "Last touch: linked 3 days ago · 1 open task",
    );
  });

  it("says 'No activity yet' for an empty contact (never an error tone)", () => {
    const r = buildContactRollup(input({ links: [], activity: [] }));
    expect(lastTouchLine(r, NOW)).toBe("No activity yet");
  });

  it("pluralizes open tasks and appends unpaid when present", () => {
    const r = buildContactRollup(
      input({
        openTaskKeys: new Set([entityRefKey(t1), entityRefKey(t2)]),
        unpaidPaymentKeys: new Set([entityRefKey({ type: "payment", id: "p1" })]),
        links: [
          link(t1, "follow-up", "2026-06-24T09:00:00Z"),
          link(t2, "references", "2026-06-20T09:00:00Z"),
          link({ type: "payment", id: "p1" }, "paid-by", "2026-06-19T09:00:00Z"),
        ],
        activity: [],
      }),
    );
    expect(lastTouchLine(r, NOW)).toBe("Last touch: linked 3 days ago · 2 open tasks · 1 unpaid");
  });
});

describe("timeAgo", () => {
  it("buckets common ranges", () => {
    expect(timeAgo("2026-06-27T11:59:30Z", NOW)).toBe("just now");
    expect(timeAgo("2026-06-27T11:00:00Z", NOW)).toBe("1 hour ago");
    expect(timeAgo("2026-06-24T12:00:00Z", NOW)).toBe("3 days ago");
    expect(timeAgo("2026-01-01T12:00:00Z", NOW)).toBe("on 2026-01-01");
  });
});
