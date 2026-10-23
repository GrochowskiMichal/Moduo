// NR-3 · AC6 — the header meta line and the "Linked from" footer, shaped from
// the same spine roll-up the Detail panel renders (built here with the real
// `rollupSections`, so a change to the hub's shape breaks these tests too).

import { describe, expect, it } from "@rstest/core";

import type { EntityLink, EntityRecord, EntityRef, RelationKind } from "../../lib/entity-links";
import { entityRefKey, rollupSections } from "../spine/rollup";
import { relativeTimeAgo } from "../spine/snippet-format";
import {
  backlinkCount,
  META_CHIP_CAP,
  noteEditorName,
  shapeBacklinks,
  shapeNoteMetaLine,
} from "./note-meta";

const NOTE: EntityRef = { type: "note", id: "n0" };
const NOW = new Date("2026-10-13T12:00:00Z");

let seq = 0;
/** A link between the note and `other`; `incoming` makes the note the target. */
function link(other: EntityRef, kind: RelationKind = "references", incoming = false): EntityLink {
  seq += 1;
  const source = incoming ? other : NOTE;
  const target = incoming ? NOTE : other;
  return {
    id: `l${seq}`,
    workspaceId: "w1",
    sourceType: source.type,
    sourceId: source.id,
    targetType: target.type,
    targetId: target.id,
    relationKind: kind,
    origin: "manual",
    createdBy: "u1",
    createdAt: "2026-10-01T00:00:00Z",
    deletedAt: null,
  };
}

function record(ref: EntityRef, label: string, deleted = false): EntityRecord {
  return {
    workspaceId: "w1",
    type: ref.type,
    id: ref.id,
    label,
    icon: null,
    deletedAt: deleted ? "2026-10-02T00:00:00Z" : null,
  };
}

function sections(links: EntityLink[], records: EntityRecord[]) {
  const map = new Map(records.map((r) => [entityRefKey({ type: r.type, id: r.id }), r]));
  return rollupSections(NOTE, links, map, { now: NOW });
}

const acme: EntityRef = { type: "company", id: "co1" };
const t1: EntityRef = { type: "task", id: "t1" };
const t2: EntityRef = { type: "task", id: "t2" };
const call: EntityRef = { type: "event", id: "e1" };
const brief: EntityRef = { type: "note", id: "n2" };

describe("meta line (AC6)", () => {
  it("names a single entity, counts several, orders who → work → when", () => {
    const line = shapeNoteMetaLine({
      sections: sections(
        [link(call), link(t1), link(acme), link(t2, "mentions", true)],
        [
          record(call, "Thu call"),
          record(t1, "Send deck"),
          record(t2, "Book room"),
          record(acme, "Acme"),
        ],
      ),
      updatedAt: "2026-10-13T10:00:00Z",
      now: NOW,
    });
    expect(line.chips.map((c) => c.label)).toEqual(["Acme", "2 tasks", "Thu call"]);
    expect(line.chips[0]).toMatchObject({ kind: "entity", ref: acme });
    expect(line.chips[1]).toMatchObject({ kind: "count" });
  });

  it("leaves notes, deleted and private items out of the chips", () => {
    const hidden: EntityRef = { type: "contact", id: "c-hidden" };
    const gone: EntityRef = { type: "task", id: "t-gone" };
    const line = shapeNoteMetaLine({
      // No registry record for `hidden` = the viewer can't open it.
      sections: sections(
        [link(brief), link(hidden), link(gone)],
        [record(brief, "Brief"), record(gone, "Old", true)],
      ),
      updatedAt: null,
      now: NOW,
    });
    expect(line.chips).toEqual([]);
    expect(line.edited).toBeNull();
  });

  it("dedupes a pair linked by two kinds", () => {
    const line = shapeNoteMetaLine({
      sections: sections(
        [link(acme, "references"), link(acme, "mentions")],
        [record(acme, "Acme")],
      ),
      updatedAt: null,
      now: NOW,
    });
    expect(line.chips.map((c) => c.label)).toEqual(["Acme"]);
  });

  it(`caps at ${META_CHIP_CAP} chips and folds the rest into "+N more"`, () => {
    const refs: EntityRef[] = [
      acme,
      { type: "contact", id: "c1" },
      t1,
      call,
      { type: "email_thread", id: "m1" },
    ];
    const line = shapeNoteMetaLine({
      sections: sections(
        refs.map((r) => link(r)),
        refs.map((r) => record(r, r.id)),
      ),
      updatedAt: null,
      now: NOW,
    });
    expect(line.chips).toHaveLength(META_CHIP_CAP + 1);
    expect(line.chips.at(-1)).toMatchObject({ kind: "count", key: "more", label: "+2 more" });
  });

  it('says "Edited … ago", and "by …" when the editor is known', () => {
    const base = { sections: [], updatedAt: "2026-10-13T10:00:00Z", now: NOW };
    expect(shapeNoteMetaLine(base).edited).toBe("Edited 2 hours ago");
    expect(shapeNoteMetaLine({ ...base, editedBy: "Maciej" }).edited).toBe(
      "Edited 2 hours ago by Maciej",
    );
    expect(shapeNoteMetaLine({ ...base, editedBy: "  " }).edited).toBe("Edited 2 hours ago");
  });

  it('names your own edit "by you", never by your name (MOD-137)', () => {
    const members = [
      { userId: "u-me", displayName: "Maciej Grzywacz" },
      { userId: "u-mike", displayName: " Mike " },
      { userId: "u-anon", displayName: null },
    ];
    expect(noteEditorName("u-me", "u-me", members)).toBe("you");
    expect(noteEditorName("u-mike", "u-me", members)).toBe("Mike");
    expect(noteEditorName("u-anon", "u-me", members)).toBeNull();
    expect(noteEditorName("u-gone", "u-me", members)).toBeNull();
    const base = { sections: [], updatedAt: "2026-10-13T10:00:00Z", now: NOW };
    expect(
      shapeNoteMetaLine({ ...base, editedBy: noteEditorName("u-me", "u-me", members) }).edited,
    ).toBe("Edited 2 hours ago by you");
  });

  it("prefers the person's own edit time when it is known (NR-6)", () => {
    const line = shapeNoteMetaLine({
      sections: [],
      updatedAt: "2026-10-13T11:59:00Z",
      editedAt: "2026-10-13T10:00:00Z",
      editedBy: "Maciej",
      now: NOW,
    });
    expect(line.edited).toBe("Edited 2 hours ago by Maciej");
    expect(line.undoable).toBe(false);
  });

  it("names the agent after its write, with Undo only when the session can undo (AC11)", () => {
    const base = {
      sections: [],
      updatedAt: "2026-10-13T11:58:00Z",
      editedAt: "2026-10-13T10:00:00Z",
      editedBy: "Maciej",
      agentEdit: { label: "Research bot", at: "2026-10-13T11:58:00Z" },
      now: NOW,
    };
    const line = shapeNoteMetaLine({ ...base, canUndoAgent: true });
    expect(line.edited).toBe(`Research bot edited · ${relativeTimeAgo(base.agentEdit.at, NOW)}`);
    expect(line.undoable).toBe(true);
    expect(shapeNoteMetaLine(base).undoable).toBe(false);
    // An unnamed key reads as Claude.
    expect(
      shapeNoteMetaLine({ ...base, agentEdit: { label: null, at: base.agentEdit.at } }).edited,
    ).toMatch(/^Claude edited · /);
  });

  it("goes back to the person once they edit after the agent", () => {
    const line = shapeNoteMetaLine({
      sections: [],
      updatedAt: "2026-10-13T11:59:00Z",
      editedAt: "2026-10-13T11:59:00Z",
      editedBy: "Maciej",
      agentEdit: { label: "Research bot", at: "2026-10-13T11:00:00Z" },
      canUndoAgent: true,
      now: NOW,
    });
    expect(line.edited).toMatch(/^Edited .* by Maciej$/);
    expect(line.undoable).toBe(false);
  });
});

describe("Linked from footer (AC6)", () => {
  it("lists only incoming links, grouped by relationship, with snippets", () => {
    const other: EntityRef = { type: "note", id: "n3" };
    const groups = shapeBacklinks(
      NOTE.id,
      sections(
        [
          link(brief, "references", true),
          link(t1, "spawned-from", true),
          link(other, "mentions", true),
          link(acme), // outgoing: not a backlink
        ],
        [
          record(brief, "Brief"),
          record(t1, "Send deck"),
          record(other, "Standup"),
          record(acme, "Acme"),
        ],
      ),
    );
    expect(groups.map((g) => g.label)).toEqual(["References", "Created from", "Mentions"]);
    expect(groups[0]!.rows.map((r) => r.title)).toEqual(["Brief"]);
    expect(groups[0]!.rows[0]!.ref).toEqual(brief);
    expect(backlinkCount(groups)).toBe(3);
  });

  it("drops deleted sources", () => {
    const groups = shapeBacklinks(
      NOTE.id,
      sections([link(brief, "references", true)], [record(brief, "Brief", true)]),
    );
    expect(groups).toEqual([]);
    expect(backlinkCount(groups)).toBe(0);
  });
});
