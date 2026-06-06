import type { DragEndEvent } from "@dnd-kit/core";
import type { NoteMeta } from "../../types";
import type { DragHint } from "./notes-sidebar";

type NoteDragContext = {
  listNotes: NoteMeta[];
  sectionNotes: NoteMeta[];
  byParent: Map<string | null, NoteMeta[]>;
  notesById: Map<string, NoteMeta>;
};

type HandleNoteDragEndArgs = NoteDragContext & {
  event: DragEndEvent;
  readOnly: boolean;
  nestThresholdPx: number;
  onMoveNote: (noteId: string, parentId: string | null, beforeId?: string | null) => Promise<void>;
  expandParent: (parentId: string | null) => void;
};

export async function handleNoteDragEnd({
  event,
  readOnly,
  nestThresholdPx,
  listNotes,
  sectionNotes,
  byParent,
  notesById,
  onMoveNote,
  expandParent,
}: HandleNoteDragEndArgs): Promise<void> {
  if (readOnly) return;
  const activeId = String(event.active.id);
  const overId = event.over ? String(event.over.id) : null;

  if (!overId || !activeId.startsWith("note:")) return;

  const movingNoteId = activeId.replace("note:", "");
  const moving = listNotes.find((note) => note.id === movingNoteId);
  if (!moving) return;
  if (overId === activeId) return;

  const canMoveUnderParent = (targetParentId: string | null): boolean =>
    canMoveNoteUnderParent(moving, targetParentId, byParent, notesById);

  if (overId === "inside:root" || overId.startsWith("inside:")) {
    const targetParentId = overId === "inside:root" ? null : overId.replace("inside:", "");
    if (moving.kind === "section" && targetParentId) {
      const target = notesById.get(targetParentId);
      if (target?.kind === "section") {
        await onMoveNote(movingNoteId, null, target.id);
      }
      return;
    }
    if (!canMoveUnderParent(targetParentId)) return;
    await onMoveNote(movingNoteId, targetParentId, null);
    expandParent(targetParentId);
    return;
  }

  if (overId.startsWith("note:")) {
    const targetNoteId = overId.replace("note:", "");
    const target = listNotes.find((note) => note.id === targetNoteId);
    if (!target) return;
    if (target.id === moving.id) return;
    const dropAfter = shouldDropAfterTarget(event);

    if (target.kind === "section" && moving.kind === "note") {
      if (!canMoveUnderParent(target.id)) return;
      await onMoveNote(movingNoteId, target.id, null);
      expandParent(target.id);
      return;
    }

    if (moving.kind === "section") {
      if (target.kind !== "section") return;
      const sectionSiblings = sectionNotes.filter((entry) => entry.id !== moving.id);
      const beforeId = dropAfter ? getBeforeIdAfterTarget(sectionSiblings, target.id) : target.id;
      await onMoveNote(movingNoteId, null, beforeId);
      return;
    }

    const nestIntent = (event.delta?.x ?? 0) > nestThresholdPx;
    if (nestIntent) {
      if (!canMoveUnderParent(target.id)) return;
      await onMoveNote(movingNoteId, target.id, null);
      expandParent(target.id);
      return;
    }

    if (!canMoveUnderParent(target.parentId)) return;
    const siblingCandidates = (byParent.get(target.parentId) ?? []).filter((entry) => entry.id !== moving.id);
    const beforeId = dropAfter ? getBeforeIdAfterTarget(siblingCandidates, target.id) : target.id;
    await onMoveNote(movingNoteId, target.parentId, beforeId);
  }
}

export function resolveNoteDragHint({
  targetNoteId,
  dragActiveId,
  dragOverId,
  dragDeltaX,
  nestThresholdPx,
  listNotes,
}: NoteDragContext & {
  targetNoteId: string;
  dragActiveId: string | null;
  dragOverId: string | null;
  dragDeltaX: number;
  nestThresholdPx: number;
}): DragHint {
  if (!dragActiveId || !dragOverId) return "none";
  if (!dragActiveId.startsWith("note:") || !dragOverId.startsWith("note:")) return "none";
  const movingId = dragActiveId.replace("note:", "");
  const overNoteId = dragOverId.replace("note:", "");
  if (targetNoteId !== overNoteId || movingId === targetNoteId) return "none";

  const moving = listNotes.find((note) => note.id === movingId);
  const target = listNotes.find((note) => note.id === targetNoteId);
  if (!moving || !target) return "none";
  if (moving.kind === "section") return target.kind === "section" ? "reorder" : "none";
  if (target.kind === "section") return "nest";
  if (dragDeltaX > nestThresholdPx) return "nest";
  return "reorder";
}

function canMoveNoteUnderParent(
  moving: NoteMeta,
  targetParentId: string | null,
  byParent: Map<string | null, NoteMeta[]>,
  notesById: Map<string, NoteMeta>
): boolean {
  if (moving.kind === "section") return targetParentId === null;
  if (!targetParentId) return true;
  if (targetParentId === moving.id) return false;
  if (isDescendantOf(moving.id, targetParentId, byParent)) return false;
  const targetParent = notesById.get(targetParentId);
  if (!targetParent || targetParent.deletedAt || targetParent.isArchived) return false;
  return true;
}

function isDescendantOf(
  ancestorId: string,
  maybeDescendantId: string,
  byParent: Map<string | null, NoteMeta[]>
): boolean {
  const queue = [...(byParent.get(ancestorId) ?? []).map((note) => note.id)];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (current === maybeDescendantId) return true;
    for (const child of byParent.get(current) ?? []) queue.push(child.id);
  }
  return false;
}

function shouldDropAfterTarget(event: DragEndEvent): boolean {
  const finalRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
  const overRect = event.over?.rect;
  return !!(
    finalRect &&
    overRect &&
    finalRect.top + finalRect.height / 2 > overRect.top + overRect.height / 2
  );
}

function getBeforeIdAfterTarget(siblings: NoteMeta[], targetId: string): string | null {
  const index = siblings.findIndex((note) => note.id === targetId);
  if (index === -1) return null;
  return siblings[index + 1]?.id ?? null;
}
