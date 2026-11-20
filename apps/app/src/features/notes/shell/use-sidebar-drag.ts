/**
 * Sidebar drag (specs/notes-refresh.md NR-2, AC4): rows drag with dnd-kit
 * under the page's DndContext, and the drop is resolved by RAW pointer at
 * release, never from stale move-time state (the TL-2 lesson). Hovering only
 * lights a target whose drop would do something: a drop into the note's own
 * subtree resolves to null, so it never highlights.
 */

import { type DragEndEvent, type DragStartEvent, useDndMonitor } from "@dnd-kit/core";
import { type RefObject, useEffect, useRef, useState } from "react";

import { asDragPayload } from "@/lib/drag-payload";

import { betweenPositions, endPosition } from "../../tasks/helpers";
import type { Note } from "../model";
import type { SidebarSections } from "../sections";
import {
  type DropIntent,
  type DropTarget,
  effectiveDropTarget,
  resolveDropIntent,
  type SidebarSection,
  zoneFromPointer,
} from "./drop-intent";
import type { RowHover } from "./sidebar-tree";

const POS = { endPosition, betweenPositions };
/** How close to the tree's top or bottom edge a drag starts scrolling it. */
const EDGE_PX = 32;

type DragState = { noteId: string; section: SidebarSection };

/** What is under the pointer: a row (with its zone) or a section header. */
function hitTest(x: number, y: number): { target: DropTarget; key: string | null } | null {
  const el = document.elementFromPoint(x, y);
  const header = el?.closest?.("[data-drop-header]") as HTMLElement | null;
  if (header) {
    const section = header.dataset.dropHeader;
    if (section === "inbox" || section === "pages") {
      return { target: { kind: "section", section }, key: `header:${section}` };
    }
  }
  const row = el?.closest?.("[data-drop-row]") as HTMLElement | null;
  if (!row) return null;
  const section = row.dataset.dropSection as SidebarSection | undefined;
  const id = row.dataset.dropId;
  if (!section || !id) return null;
  const zone = zoneFromPointer(row.getBoundingClientRect(), y, row.dataset.dropInto === "true");
  return { target: { kind: "row", section, id, zone }, key: row.dataset.dropRow ?? null };
}

export function useSidebarDrag(input: {
  notes: Note[];
  sections: SidebarSections;
  favoritePositions: Map<string, string>;
  onDrop: (intent: DropIntent) => void;
  /** The tree's scroller: a drag held near its top or bottom edge scrolls it,
   * so a target out of view can be reached (dnd-kit's own auto-scroll is off:
   * it would scroll the editor and the panels too). */
  scrollerRef?: RefObject<HTMLElement | null>;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hover, setHover] = useState<RowHover>(null);
  const [headerHover, setHeaderHover] = useState<"inbox" | "pages" | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const inputRef = useRef(input);
  inputRef.current = input;

  const resolve = (state: DragState, x: number, y: number) => {
    const hit = hitTest(x, y);
    if (!hit) return null;
    // A favorite dragged out of Favorites only ever reorders Favorites.
    if (
      state.section === "favorites" &&
      !(hit.target.kind === "row" && hit.target.section === "favorites")
    ) {
      return null;
    }
    const { notes, sections, favoritePositions } = inputRef.current;
    const target = effectiveDropTarget(hit.target, sections);
    const intent = resolveDropIntent({
      notes,
      layout: sections,
      favoritePositions,
      dragId: state.noteId,
      target,
      pos: POS,
    });
    return intent ? { target, key: target === hit.target ? hit.key : null, intent } : null;
  };

  // The pointer is tracked from the moment the drag starts (listener attached
  // synchronously, not in an effect) and the drop resolves from it. Never
  // from dnd-kit's `delta`: it folds in the sidebar's own scroll, so a drag
  // that scrolls the tree would drop somewhere other than the highlight.
  const dragRef = useRef<DragState | null>(null);
  const detachRef = useRef<(() => void) | null>(null);

  const scrollFrame = useRef(0);
  const autoScroll = () => {
    const el = inputRef.current.scrollerRef?.current;
    if (!el || !dragRef.current) return;
    const rect = el.getBoundingClientRect();
    const { x, y } = pointer.current;
    if (x >= rect.left && x <= rect.right) {
      if (y < rect.top + EDGE_PX) el.scrollTop -= Math.ceil((rect.top + EDGE_PX - y) / 4);
      else if (y > rect.bottom - EDGE_PX)
        el.scrollTop += Math.ceil((y - (rect.bottom - EDGE_PX)) / 4);
    }
    scrollFrame.current = requestAnimationFrame(autoScroll);
  };

  const stopTracking = () => {
    cancelAnimationFrame(scrollFrame.current);
    detachRef.current?.();
    detachRef.current = null;
    dragRef.current = null;
    setDrag(null);
    setHover(null);
    setHeaderHover(null);
  };

  const startTracking = (state: DragState) => {
    detachRef.current?.();
    dragRef.current = state;
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      const current = dragRef.current;
      if (!current) return;
      const res = resolve(current, e.clientX, e.clientY);
      const t = res?.target;
      const nextHover: RowHover =
        t?.kind === "row" && res?.key ? { key: res.key, zone: t.zone } : null;
      setHover((prev) =>
        prev?.key === nextHover?.key && prev?.zone === nextHover?.zone ? prev : nextHover,
      );
      setHeaderHover(t?.kind === "section" ? t.section : null);
    };
    document.addEventListener("pointermove", onMove, { capture: true });
    detachRef.current = () =>
      document.removeEventListener("pointermove", onMove, { capture: true });
    cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(autoScroll);
    setDrag(state);
  };

  useEffect(
    () => () => {
      cancelAnimationFrame(scrollFrame.current);
      detachRef.current?.();
    },
    [],
  );

  useDndMonitor({
    onDragStart: (e: DragStartEvent) => {
      const payload = asDragPayload(e.active.data.current);
      const [section] = String(e.active.id).split(":");
      if (!payload || payload.entityType !== "note") return;
      if (section !== "favorites" && section !== "inbox" && section !== "pages") return;
      // Start from where this drag began, never the previous drag's release.
      const start = e.activatorEvent as PointerEvent | null;
      if (start && "clientX" in start) pointer.current = { x: start.clientX, y: start.clientY };
      startTracking({ noteId: payload.entityId, section });
    },
    onDragEnd: (_e: DragEndEvent) => {
      const state = dragRef.current;
      const at = pointer.current;
      stopTracking();
      if (!state) return;
      const res = resolve(state, at.x, at.y);
      if (res) inputRef.current.onDrop(res.intent);
    },
    onDragCancel: stopTracking,
  });

  return { dragging: drag !== null, dragNoteId: drag?.noteId ?? null, hover, headerHover };
}
