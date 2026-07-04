/**
 * AC4 proof — detach plans: deleting a selection with N task lines yields ONE
 * batch plan (one toast); the undo plan restores lines + links (kind/origin
 * preserved); the ⌘Z-after-mint plan includes the task deletion.
 */

import { describe, expect, it } from "vitest";
import type { EntityLink } from "../../../lib/entity-links";
import { buildDetachPlan, buildMintRevertPlan, type TaskLineSnapshot } from "./detach";

const WS = "ws-1";
const NOTE_ID = "note-1";

function link(overrides: Partial<EntityLink>): EntityLink {
  return {
    id: "link-1",
    workspaceId: WS,
    sourceType: "note",
    sourceId: NOTE_ID,
    targetType: "task",
    targetId: "task-1",
    relationKind: "spawned-from",
    origin: "ref",
    createdBy: null,
    createdAt: "2026-07-01T00:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function line(taskId: string, rootIndex = 0): TaskLineSnapshot {
  return { taskId, title: `Task ${taskId}`, done: false, rootIndex };
}

describe("buildDetachPlan", () => {
  it("N lines → ONE plan: deduped ids, one toast label, links resolved", () => {
    const links = [
      link({ id: "l1", targetId: "t1" }),
      link({ id: "l2", targetId: "t2", relationKind: "references" }),
      link({ id: "l3", targetId: "t-other" }), // untouched task — stays
    ];
    const plan = buildDetachPlan({
      workspaceId: WS,
      noteId: NOTE_ID,
      noteLabel: "Plan",
      lines: [line("t1", 2), line("t2", 0), line("t1", 5)], // t1 twice — dedupe
      links,
    });
    expect(plan).not.toBeNull();
    expect(plan!.taskIds.sort()).toEqual(["t1", "t2"]);
    expect(plan!.linkIds.sort()).toEqual(["l1", "l2"]);
    expect(plan!.toastLabel).toBe("2 tasks detached");
    // Undo restores lines in document order…
    expect(plan!.lines.map((l) => l.taskId)).toEqual(["t2", "t1"]);
    // …and re-creates the SAME links (kind + origin preserved).
    const restored = plan!.restoreLinks.find((l) => l.target.id === "t2");
    expect(restored?.relationKind).toBe("references");
    expect(restored?.origin).toBe("ref");
  });

  it("singular copy for one line; null for none", () => {
    const one = buildDetachPlan({
      workspaceId: WS,
      noteId: NOTE_ID,
      noteLabel: "Plan",
      lines: [line("t1")],
      links: [link({ id: "l1", targetId: "t1" })],
    });
    expect(one!.toastLabel).toBe("1 task detached");
    expect(
      buildDetachPlan({ workspaceId: WS, noteId: NOTE_ID, noteLabel: "P", lines: [], links: [] }),
    ).toBeNull();
  });

  it("matches links in either direction, skips dead ones and other notes'", () => {
    const links = [
      // task as SOURCE (direction-agnostic reads).
      link({ id: "l1", sourceType: "task", sourceId: "t1", targetType: "note", targetId: NOTE_ID }),
      link({ id: "l2", targetId: "t1", deletedAt: "2026-07-02T00:00:00Z" }), // tombstoned
      link({ id: "l3", targetId: "t1", sourceId: "another-note" }), // different note
    ];
    const plan = buildDetachPlan({
      workspaceId: WS,
      noteId: NOTE_ID,
      noteLabel: "Plan",
      lines: [line("t1")],
      links,
    });
    expect(plan!.linkIds).toEqual(["l1"]);
  });
});

describe("buildMintRevertPlan (⌘Z-after-mint)", () => {
  it("includes the task deletion AND its back-link(s)", () => {
    const plan = buildMintRevertPlan({
      noteId: NOTE_ID,
      taskId: "t1",
      links: [link({ id: "l1", targetId: "t1" }), link({ id: "l2", targetId: "t2" })],
    });
    expect(plan.taskId).toBe("t1"); // the just-minted task is deleted too
    expect(plan.linkIds).toEqual(["l1"]);
  });
});
