/**
 * The editor pane as a drop target (NO-7b), lifted from the classic page for
 * the refreshed shell (classic imports it too): dropping an entity here fires the chip-insert event (a
 * reference chip, no `entity_links` write). The chip lands at the release
 * coordinates, tracked via a raw pointer listener (the TL-2 lesson: dnd-kit's
 * `delta` folds auto-scroll, unreliable for a point).
 */

import { useDndMonitor, useDroppable } from "@dnd-kit/core";
import { type ReactNode, useEffect, useRef } from "react";

import { asDragPayload } from "../../../lib/drag-payload";
import { cn } from "../../../lib/utils";
import {
  INSERT_ENTITY_CHIP_EVENT,
  type InsertEntityChipDetail,
} from "../editor/notes-editor-bridge";

const NOTES_EDITOR_DROP_ID = "notes-editor-drop";

export function NotesEditorDropZone({
  noteId,
  editable,
  children,
}: {
  noteId: string | null;
  editable: boolean;
  children: ReactNode;
}) {
  const pointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const active = editable && !!noteId;
  const {
    setNodeRef,
    isOver,
    active: dragActive,
  } = useDroppable({
    id: NOTES_EDITOR_DROP_ID,
    data: { kind: "note-editor" },
    disabled: !active,
  });
  const overWithPayload = isOver && !!asDragPayload(dragActive?.data?.current);

  // Track the pointer only WHILE a drag is in flight (parity with the sidebar's
  // gated tracker) — the release coords give the chip its drop point.
  const isDragging = !!dragActive;
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    document.addEventListener("pointermove", onMove, { capture: true });
    return () => document.removeEventListener("pointermove", onMove, { capture: true });
  }, [isDragging]);

  useDndMonitor({
    onDragEnd: (event) => {
      if (!active || !noteId) return;
      if (event.over?.id !== NOTES_EDITOR_DROP_ID) return;
      const payload = asDragPayload(event.active.data.current);
      if (!payload) return;
      const detail: InsertEntityChipDetail = {
        noteId,
        entityType: payload.entityType,
        entityId: payload.entityId,
        label: payload.label ?? payload.entityType,
        icon: payload.icon ?? null,
        clientX: pointer.current.x,
        clientY: pointer.current.y,
      };
      window.dispatchEvent(new CustomEvent(INSERT_ENTITY_CHIP_EVENT, { detail }));
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "h-full min-h-0",
        overWithPayload && "rounded-lg ring-2 ring-inset ring-primary/40",
      )}
    >
      {children}
    </div>
  );
}
