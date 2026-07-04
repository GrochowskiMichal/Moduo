/**
 * Detach plans — the pure half of task-line revert/detach (Wave-3 NO-5, AC4).
 * Deleting a line, a selection with N task lines, or converting a line back
 * to a checkbox soft-detaches the tasks (they survive) with ONE undoable
 * toast — never a modal, never stacked toasts. ⌘Z right after minting fully
 * reverts: the just-minted task is deleted too, not orphaned.
 *
 * The editor plugin captures line snapshots at destruction time and the page
 * executes the plan (link deletes + toast + optional task deletes). Pure and
 * runtime-free so detach.test.ts can pin the semantics.
 */

import type { EntityLink } from "../../../lib/entity-links";
import type { TaskLinkInput } from "./task-line";

/** What we knew about a task line the moment it left the document. */
export type TaskLineSnapshot = {
  taskId: string;
  /** Plain-text title at destruction time (toast-undo re-inserts it; full
   * formatting fidelity stays on Lexical's own ⌘Z). */
  title: string;
  done: boolean;
  /** Top-level index the line held, so undo restores it in place. */
  rootIndex: number;
};

export type DetachPlan = {
  /** Unique task ids detached by this gesture (N lines → one plan). */
  taskIds: string[];
  /** Live note↔task links to soft-delete, one per detached task. */
  linkIds: string[];
  /** The ONE toast's copy: "N task(s) detached". */
  toastLabel: string;
  /** Snapshots for the undo path, in document order. */
  lines: TaskLineSnapshot[];
  /** Links the undo path re-creates (kind/origin preserved). */
  restoreLinks: TaskLinkInput[];
};

/** The live links between this note and a set of task ids (either direction —
 * links are direction-agnostic on read). */
export function taskLinksForNote(
  links: EntityLink[],
  noteId: string,
  taskIds: Set<string>,
): EntityLink[] {
  return links.filter((l) => {
    if (l.deletedAt !== null) return false;
    const noteEnd =
      (l.sourceType === "note" && l.sourceId === noteId && l.targetType === "task") ||
      (l.targetType === "note" && l.targetId === noteId && l.sourceType === "task");
    if (!noteEnd) return false;
    const taskId = l.sourceType === "task" ? l.sourceId : l.targetId;
    return taskIds.has(taskId);
  });
}

/**
 * One batch plan per gesture: dedupes task ids, resolves the links to drop,
 * and prepares the undo half (restore lines + re-create the same links).
 */
export function buildDetachPlan(input: {
  workspaceId: string;
  noteId: string;
  noteLabel: string;
  lines: TaskLineSnapshot[];
  /** The note's current live links (the plugin caches `spine.listLinks`). */
  links: EntityLink[];
}): DetachPlan | null {
  const ordered = [...input.lines].sort((a, b) => a.rootIndex - b.rootIndex);
  const seen = new Set<string>();
  const lines: TaskLineSnapshot[] = [];
  for (const line of ordered) {
    if (seen.has(line.taskId)) continue;
    seen.add(line.taskId);
    lines.push(line);
  }
  if (lines.length === 0) return null;

  const links = taskLinksForNote(input.links, input.noteId, seen);
  const restoreLinks: TaskLinkInput[] = links.map((l) => ({
    workspaceId: input.workspaceId,
    source: { type: l.sourceType, id: l.sourceId },
    target: { type: l.targetType, id: l.targetId },
    relationKind: l.relationKind,
    origin: l.origin,
    sourceLabel: input.noteLabel,
  }));

  const n = lines.length;
  return {
    taskIds: lines.map((l) => l.taskId),
    linkIds: links.map((l) => l.id),
    toastLabel: n === 1 ? "1 task detached" : `${n} tasks detached`,
    lines,
    restoreLinks,
  };
}

export type MintRevertPlan = {
  /** The just-minted task to delete (⌘Z-after-mint fully reverts). */
  taskId: string;
  /** Its spawned-from link(s) to drop alongside. */
  linkIds: string[];
};

/** ⌘Z immediately after a mint: the plan deletes the minted task AND its
 * back-link — nothing orphaned (AC4). */
export function buildMintRevertPlan(input: {
  noteId: string;
  taskId: string;
  links: EntityLink[];
}): MintRevertPlan {
  const links = taskLinksForNote(input.links, input.noteId, new Set([input.taskId]));
  return { taskId: input.taskId, linkIds: links.map((l) => l.id) };
}
