// DF-7 — the roll-up threads live per-entity meta into the registered projectors
// so a hub row shows a real preview, not just a name. Isolated from rollup.test
// (vitest gives each file its own module/projector registry) because importing
// the builtins overrides the default projector for task/note/event/email.

import { describe, expect, it } from "@rstest/core";
import "./snippet-projectors.builtin";
import type { EntityLink, EntityRef } from "@/lib/entity-links";
import { entityRefKey, rollupSections } from "./rollup";
import type { HubSnippetMeta } from "./snippet-projectors";

const FOCUS: EntityRef = { type: "contact", id: "c0" };
const NOW = new Date("2026-07-15T12:00:00Z");
const DAY = 86_400_000;
const dayOffset = (n: number) => new Date(NOW.getTime() + n * DAY).toISOString();

let seq = 0;
function link(other: EntityRef): EntityLink {
  seq += 1;
  return {
    id: `l${seq}`,
    workspaceId: "w1",
    sourceType: FOCUS.type,
    sourceId: FOCUS.id,
    targetType: other.type,
    targetId: other.id,
    relationKind: "references",
    origin: "manual",
    createdBy: "u1",
    createdAt: `2026-06-25T00:00:${String(seq).padStart(2, "0")}Z`,
    deletedAt: null,
  };
}
function registry(...entries: [EntityRef, string][]) {
  return new Map(
    entries.map(([ref, label]) => [
      entityRefKey(ref),
      { workspaceId: "w1", type: ref.type, id: ref.id, label, icon: null, deletedAt: null },
    ]),
  );
}
function metaMap(...entries: [EntityRef, HubSnippetMeta][]) {
  return new Map(entries.map(([ref, meta]) => [entityRefKey(ref), meta]));
}

describe("rollupSections snippet enrichment (DF-7)", () => {
  const task: EntityRef = { type: "task", id: "t1" };
  const note: EntityRef = { type: "note", id: "n1" };
  const event: EntityRef = { type: "event", id: "ev1" };

  it("projects a task's live status + due into the row snippet", () => {
    const [section] = rollupSections(FOCUS, [link(task)], registry([task, "Ship launch"]), {
      snippetMeta: metaMap([task, { kind: "task", status: "in_progress", dueDate: dayOffset(1) }]),
      now: NOW,
    });
    const row = section.rows[0];
    expect(row.title).toBe("Ship launch");
    expect(row.snippet).toBe("In progress · due tomorrow");
  });

  it("projects a note's recency and an event's when", () => {
    const sections = rollupSections(
      FOCUS,
      [link(note), link(event)],
      registry([note, "Spec"], [event, "Kickoff"]),
      {
        snippetMeta: metaMap(
          [note, { kind: "note", updatedAt: dayOffset(-2), isPinned: false, isArchived: false }],
          [event, { kind: "event", startsAt: dayOffset(1), endsAt: dayOffset(1), allDay: true }],
        ),
        now: NOW,
      },
    );
    const rows = sections.flatMap((s) => s.rows);
    expect(rows.find((r) => r.other.id === "n1")?.snippet).toBe("Edited 2 days ago");
    expect(rows.find((r) => r.other.id === "ev1")?.snippet).toBe("Tomorrow");
  });

  it("degrades to a bare title (null snippet) when no meta is supplied", () => {
    const [section] = rollupSections(FOCUS, [link(task)], registry([task, "Ship launch"]));
    expect(section.rows[0].title).toBe("Ship launch");
    expect(section.rows[0].snippet).toBeNull();
  });

  it("never shows a snippet for a tombstoned row even with meta present", () => {
    const recs = new Map([
      [
        entityRefKey(task),
        {
          workspaceId: "w1",
          type: "task",
          id: "t1",
          label: "Gone",
          icon: null,
          deletedAt: dayOffset(-1),
        },
      ],
    ]);
    const [section] = rollupSections(FOCUS, [link(task)], recs, {
      snippetMeta: metaMap([task, { kind: "task", status: "todo", dueDate: dayOffset(1) }]),
      now: NOW,
    });
    expect(section.rows[0].tombstoned).toBe(true);
    expect(section.rows[0].snippet).toBeNull();
  });
});
