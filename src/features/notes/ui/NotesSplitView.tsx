import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createPortal } from "react-dom";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { NoteKind, NoteMeta } from "../types";
import type { NotesSyncEngine } from "../sync/sync-engine";
import { LexicalNoteEditor } from "../editor/LexicalNoteEditor";
import {
  NOTES_CREATE_KIND_EVENT,
  NOTES_FOCUS_SEARCH_EVENT,
  type NotesCreateKindEventDetail,
} from "./layout-events";
import { exposeNote, unexposeNote, getExposedSlug, buildSlug } from "../utils/expose";
import { encodeUint8ToBase64 } from "../utils/base64";
import * as Y from "yjs";
import {
  LAYOUT_PANELS_APPLY_EVENT,
  readFeaturePanelState,
  type LayoutPanelsApplyDetail,
} from "../../layout/panel-events";
import { useAuth } from "../../../providers/auth-provider";
import { Icon } from "../../../components/ui/icon";

/**
 * Clipboard write that works in Tauri webviews.
 * navigator.clipboard.writeText requires a secure context that Tauri
 * doesn't always provide. Fall back to the textarea/execCommand trick.
 */
function copyToClipboard(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text: string): void {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand("copy"); } catch { /* ignore */ }
  document.body.removeChild(ta);
}

async function openExternalUrl(url: string): Promise<void> {
  const target = url.trim();
  if (!target) return;

  try {
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      await invoke("open_external_url", { url: target });
      return;
    }
  } catch {
    // Fall back to browser open below.
  }

  if (typeof window !== "undefined") {
    window.open(target, "_blank", "noopener,noreferrer");
  }
}

type Props = {
  notes: NoteMeta[];
  selectedNoteId: string | null;
  onSelectNote: (id: string) => void;
  onCreateNote: (parentId?: string | null, kind?: NoteKind) => Promise<string | null>;
  onMoveNote: (noteId: string, parentId: string | null, beforeId?: string | null) => Promise<void>;
  onUpdateTitle: (noteId: string, title: string) => Promise<void>;
  onUpdateTags: (noteId: string, tags: string[]) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onDuplicateNote: (noteId: string) => Promise<string | null>;
  onTogglePin: (noteId: string, isPinned: boolean) => Promise<void>;
  readOnly?: boolean;
  syncEngine: NotesSyncEngine | null;
};

type ContextMenuState =
  | { type: "note"; noteId: string; top: number; left: number }
  | { type: "sidebar"; top: number; left: number };

const contextMenuPanelClass =
  "notes-context-menu fixed z-[1100] min-w-[148px] rounded-lg border border-[#2b2b2b] bg-[#141414] p-1 shadow-xl";
const contextMenuItemClass =
  "notes-context-item flex w-full items-center rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-[11px] font-medium text-[#d8d8d8] transition-colors hover:bg-[#1f1f1f]";
const contextMenuDeleteItemClass =
  "notes-context-item flex w-full items-center rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-[11px] font-medium text-[#d8d8d8] transition-colors hover:bg-[#1f1f1f]";
const NEST_THRESHOLD_PX = 12;

function kindIcon(kind: NoteKind) {
  if (kind === "category") return "▣";
  if (kind === "folder") return <Icon name="folder" size={12} />;
  return "☰";
}

type NoteRowProps = {
  note: NoteMeta;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onToggleExpanded: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  dragHint?: "none" | "reorder" | "nest";
};

function TreeRow({
  note,
  depth,
  hasChildren,
  isExpanded,
  isSelected,
  onSelect,
  onToggleExpanded,
  onContextMenu,
  dragHint = "none",
}: NoteRowProps) {
  const sortable = useSortable({ id: `note:${note.id}` });

  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
    marginLeft: depth * 18,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className="rounded-[10px]"
    >
      <div
        className={`notes-tree-row relative grid min-h-8 grid-cols-[18px_1fr_20px] items-center gap-[10px] rounded-[10px] px-[6px] py-1 text-[#a3a3a3] ${isSelected ? "bg-[#1a1a1a] text-[#f1f1f1]" : ""} ${dragHint === "nest" ? "bg-[#1e1e1e]" : ""}`}
        onClick={onSelect}
        onContextMenu={(event) => {
          event.stopPropagation();
          onContextMenu(event);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSelect();
        }}
      >
        <span className="text-[12px] text-[#303030]">{kindIcon(note.kind)}</span>

        <div
          className="truncate text-[14px]"
          ref={sortable.setActivatorNodeRef}
          {...sortable.attributes}
          {...sortable.listeners}
        >
          {note.title || "Untitled"}
        </div>

        <button
          type="button"
          className={`grid h-4 w-4 place-items-center border-0 bg-transparent text-[11px] text-[#6b6b6b] ${hasChildren ? "" : "pointer-events-none opacity-0"}`}
          disabled={!hasChildren}
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) onToggleExpanded();
          }}
        >
          {hasChildren ? (isExpanded ? "▾" : "▸") : ""}
        </button>
      </div>
    </div>
  );
}

type ShortcutRowProps = {
  note: NoteMeta;
  isSelected: boolean;
  onSelect: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
};

function ShortcutRow({ note, isSelected, onSelect, onContextMenu }: ShortcutRowProps) {
  return (
    <div
      className={`notes-tree-row grid min-h-8 grid-cols-[16px_1fr] items-center gap-[10px] rounded-[10px] px-[6px] py-1 text-[#a3a3a3] ${isSelected ? "bg-[#1a1a1a] text-[#f1f1f1]" : ""}`}
      onClick={onSelect}
      onContextMenu={(event) => {
        event.stopPropagation();
        onContextMenu(event);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter") onSelect();
      }}
    >
      <span className="text-[12px] text-[#303030]">{kindIcon(note.kind)}</span>
      <div className="truncate text-[14px]">{note.title || "Untitled"}</div>
    </div>
  );
}

type CategorySectionHeaderProps = {
  category: NoteMeta;
  isExpanded: boolean;
  onToggle: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  dragHint?: "none" | "reorder" | "nest";
};

function CategorySectionHeader({
  category,
  isExpanded,
  onToggle,
  onContextMenu,
  dragHint = "none",
}: CategorySectionHeaderProps) {
  const sortable = useSortable({ id: `note:${category.id}` });
  const drop = useDroppable({ id: `inside:${category.id}` });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={(node) => {
        sortable.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      style={style}
      className={`relative rounded-[10px] ${drop.isOver || dragHint === "nest" ? "bg-[#1d1d1d]" : ""}`}
      onContextMenu={(event) => {
        event.stopPropagation();
        onContextMenu(event);
      }}
    >
      <button
        type="button"
        className="notes-section-header flex w-full items-center justify-between border-0 bg-transparent px-[6px] py-[2px] text-[12px] tracking-[0.03em] text-[#8e8e8e]"
        onClick={onToggle}
      >
        <span
          ref={sortable.setActivatorNodeRef}
          {...sortable.attributes}
          {...sortable.listeners}
          className="truncate"
        >
          {category.title || "Untitled Section"}
        </span>
        <span>{isExpanded ? "▾" : "▸"}</span>
      </button>
    </div>
  );
}

export function NotesSplitView({
  notes,
  selectedNoteId,
  onSelectNote,
  onCreateNote,
  onMoveNote,
  onUpdateTitle,
  onUpdateTags,
  onDeleteNote,
  onDuplicateNote,
  onTogglePin,
  readOnly = false,
  syncEngine,
}: Props) {
  const { runtime, userId } = useAuth();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [categoryExpanded, setCategoryExpanded] = useState<Record<string, boolean>>({});
  const [sectionsExpanded, setSectionsExpanded] = useState({ pinned: true, notes: true });
  const [panelState, setPanelState] = useState(() => readFeaturePanelState("notes"));
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [tagInputOpen, setTagInputOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragDeltaX, setDragDeltaX] = useState(0);
  // Expose feature
  const [exposedSlugs, setExposedSlugs] = useState<Record<string, string | null>>({});
  const [exposeLoading, setExposeLoading] = useState(false);
  const [exposeToast, setExposeToast] = useState<{ url: string; visible: boolean } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const tagInputRef = useRef<HTMLInputElement | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const rootDrop = useDroppable({ id: "inside:root" });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onFocusSearch = () => {
      setPanelState((current) => ({ ...current, left: true }));
    };

    const onCreateKind = async (event: Event) => {
      if (readOnly) return;
      const detail = (event as CustomEvent<NotesCreateKindEventDetail>).detail;
      const kind = detail?.kind ?? "note";
      const createdId = await onCreateNote(null, kind);
      if (createdId) {
        if (kind !== "category") {
          prewarmNoteSession(createdId);
          onSelectNote(createdId);
        }
        setPanelState((current) => ({ ...current, left: true }));
      }
    };

    window.addEventListener(NOTES_FOCUS_SEARCH_EVENT, onFocusSearch);
    window.addEventListener(NOTES_CREATE_KIND_EVENT, onCreateKind);

    return () => {
      window.removeEventListener(NOTES_FOCUS_SEARCH_EVENT, onFocusSearch);
      window.removeEventListener(NOTES_CREATE_KIND_EVENT, onCreateKind);
    };
  }, [onCreateNote, onSelectNote, readOnly, syncEngine]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onApplyPanels = (event: Event) => {
      const detail = (event as CustomEvent<LayoutPanelsApplyDetail>).detail;
      if (detail?.feature !== "notes") return;
      setPanelState({ left: detail.left, right: detail.right });
    };
    window.addEventListener(LAYOUT_PANELS_APPLY_EVENT, onApplyPanels);
    return () => window.removeEventListener(LAYOUT_PANELS_APPLY_EVENT, onApplyPanels);
  }, []);

  const activeNotes = useMemo(
    () => notes.filter((note) => !note.deletedAt && !note.isArchived),
    [notes]
  );

  const listNotes = useMemo(() => activeNotes, [activeNotes]);

  const byParent = useMemo(() => {
    const grouped = new Map<string | null, NoteMeta[]>();
    for (const note of listNotes) {
      if (note.kind === "category") continue;
      const list = grouped.get(note.parentId) ?? [];
      list.push(note);
      grouped.set(note.parentId, list);
    }
    for (const [key, list] of grouped.entries()) {
      list.sort((a, b) => a.position.localeCompare(b.position));
      grouped.set(key, list);
    }
    return grouped;
  }, [listNotes]);

  const categorySections = useMemo(
    () =>
      listNotes
        .filter((note) => note.kind === "category" && !note.parentId)
        .sort(
          (a, b) =>
            a.position.localeCompare(b.position) ||
            a.title.localeCompare(b.title)
        ),
    [listNotes]
  );

  const pinnedNotes = useMemo(
    () =>
      listNotes
        .filter((note) => note.isPinned && note.kind !== "category")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title)),
    [listNotes]
  );

  const notesById = useMemo(() => new Map(activeNotes.map((note) => [note.id, note])), [activeNotes]);
  const selectedNote = activeNotes.find((note) => note.id === selectedNoteId) ?? null;
  const selectedEditorNote = selectedNote && selectedNote.kind !== "category" ? selectedNote : null;
  const contextTarget =
    contextMenu?.type === "note" ? notesById.get(contextMenu.noteId) ?? null : null;
  const contextTargetIsSection = contextTarget?.kind === "category";

  const breadcrumb = useMemo(() => {
    if (!selectedEditorNote) return "Notes";
    const chain: string[] = [];
    const visited = new Set<string>([selectedEditorNote.id]);
    let parentId = selectedEditorNote.parentId;

    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = notesById.get(parentId);
      if (!parent || parent.deletedAt || parent.isArchived) break;
      chain.push(parent.title || "Untitled");
      parentId = parent.parentId;
    }

    chain.reverse();
    const fullPath = [...chain, selectedEditorNote.title || "Untitled"];
    return fullPath.join(" / ");
  }, [notesById, selectedEditorNote]);

  function prewarmNoteSession(noteId: string) {
    if (!syncEngine) return;
    try {
      syncEngine.providerFactory(noteId, new Map());
    } catch {
      // best-effort prewarm only
    }
  }

  async function selectNoteWithPrewarm(noteId: string) {
    if (syncEngine && selectedEditorNote?.id && selectedEditorNote.id !== noteId) {
      await syncEngine.flushNote(selectedEditorNote.id);
    }
    prewarmNoteSession(noteId);
    onSelectNote(noteId);
  }

  useEffect(() => {
    if (!selectedEditorNote?.id) return;
    prewarmNoteSession(selectedEditorNote.id);
  }, [selectedEditorNote?.id, syncEngine]);

  useEffect(() => {
    setTagInputOpen(false);
    setTagDraft("");
  }, [selectedEditorNote?.id]);

  useEffect(() => {
    if (!tagInputOpen) return;
    const timeout = setTimeout(() => tagInputRef.current?.focus(), 0);
    return () => clearTimeout(timeout);
  }, [tagInputOpen]);

  useEffect(() => {
    if (!contextMenu) return;

    const onPointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      setContextMenu(null);
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };

    const onScroll = () => {
      setContextMenu(null);
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onEscape);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onEscape);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [contextMenu]);

  const isDescendantOf = (ancestorId: string, maybeDescendantId: string): boolean => {
    const queue = [...(byParent.get(ancestorId) ?? []).map((note) => note.id)];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      if (current === maybeDescendantId) return true;
      for (const child of byParent.get(current) ?? []) queue.push(child.id);
    }
    return false;
  };

  const canMoveUnderParent = (moving: NoteMeta, targetParentId: string | null): boolean => {
    if (moving.kind === "category") return targetParentId === null;
    if (!targetParentId) return true;
    if (targetParentId === moving.id) return false;
    if (isDescendantOf(moving.id, targetParentId)) return false;
    const targetParent = notesById.get(targetParentId);
    if (!targetParent || targetParent.deletedAt || targetParent.isArchived) return false;
    return true;
  };

  const expandParent = (parentId: string | null) => {
    if (!parentId) return;
    setExpanded((current) => ({ ...current, [parentId]: true }));
    setCategoryExpanded((current) => ({ ...current, [parentId]: true }));
  };

  const resetDragState = () => {
    setDragActiveId(null);
    setDragOverId(null);
    setDragDeltaX(0);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    if (readOnly) return;
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;

    if (!overId || !activeId.startsWith("note:")) return;

    const movingNoteId = activeId.replace("note:", "");
    const moving = listNotes.find((note) => note.id === movingNoteId);
    if (!moving) return;
    if (overId === activeId) return;

    if (overId === "inside:root" || overId.startsWith("inside:")) {
      const targetParentId = overId === "inside:root" ? null : overId.replace("inside:", "");
      if (moving.kind === "category" && targetParentId) {
        const target = notesById.get(targetParentId);
        if (target?.kind === "category") {
          await onMoveNote(movingNoteId, null, target.id);
        }
        return;
      }
      if (!canMoveUnderParent(moving, targetParentId)) return;
      await onMoveNote(movingNoteId, targetParentId, null);
      expandParent(targetParentId);
      return;
    }

    if (overId.startsWith("note:")) {
      const targetNoteId = overId.replace("note:", "");
      const target = listNotes.find((note) => note.id === targetNoteId);
      if (!target) return;
      if (target.id === moving.id) return;
      const finalRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
      const overRect = event.over?.rect;
      const dropAfter = !!(
        finalRect &&
        overRect &&
        finalRect.top + finalRect.height / 2 > overRect.top + overRect.height / 2
      );
      const getBeforeIdAfterTarget = (siblings: NoteMeta[], targetId: string): string | null => {
        const index = siblings.findIndex((note) => note.id === targetId);
        if (index === -1) return null;
        return siblings[index + 1]?.id ?? null;
      };

      // Dropping on a section row always attaches non-section entries to that section.
      if (target.kind === "category" && moving.kind !== "category") {
        if (!canMoveUnderParent(moving, target.id)) return;
        await onMoveNote(movingNoteId, target.id, null);
        expandParent(target.id);
        return;
      }

      // Sections are root-only and reorder only against sections.
      if (moving.kind === "category") {
        if (target.kind !== "category") return;
        const categorySiblings = categorySections.filter((entry) => entry.id !== moving.id);
        const beforeId = dropAfter
          ? getBeforeIdAfterTarget(categorySiblings, target.id)
          : target.id;
        await onMoveNote(movingNoteId, null, beforeId);
        return;
      }

      const nestIntent = (event.delta?.x ?? 0) > NEST_THRESHOLD_PX;
      if (nestIntent) {
        if (!canMoveUnderParent(moving, target.id)) return;
        await onMoveNote(movingNoteId, target.id, null);
        expandParent(target.id);
        return;
      }

      if (!canMoveUnderParent(moving, target.parentId)) return;
      const siblingCandidates = (byParent.get(target.parentId) ?? []).filter((entry) => entry.id !== moving.id);
      const beforeId = dropAfter
        ? getBeforeIdAfterTarget(siblingCandidates, target.id)
        : target.id;
      await onMoveNote(movingNoteId, target.parentId, beforeId);
    }
  };

  const resolveDragHint = (targetNoteId: string): "none" | "reorder" | "nest" => {
    if (!dragActiveId || !dragOverId) return "none";
    if (!dragActiveId.startsWith("note:") || !dragOverId.startsWith("note:")) return "none";
    const movingId = dragActiveId.replace("note:", "");
    const overNoteId = dragOverId.replace("note:", "");
    if (targetNoteId !== overNoteId || movingId === targetNoteId) return "none";

    const moving = listNotes.find((note) => note.id === movingId);
    const target = listNotes.find((note) => note.id === targetNoteId);
    if (!moving || !target) return "none";
    if (moving.kind === "category") return target.kind === "category" ? "reorder" : "none";
    if (target.kind === "category") return "nest";
    if (dragDeltaX > NEST_THRESHOLD_PX) return "nest";
    return "reorder";
  };

  const toggleExpanded = (noteId: string) => {
    setExpanded((current) => ({ ...current, [noteId]: !current[noteId] }));
  };

  const toggleSection = (section: "pinned" | "notes") => {
    setSectionsExpanded((current) => ({ ...current, [section]: !current[section] }));
  };

  const toggleCategorySection = (categoryId: string) => {
    setCategoryExpanded((current) => ({ ...current, [categoryId]: !(current[categoryId] ?? true) }));
  };

  const getMenuPosition = (event: ReactMouseEvent, width: number, height: number) => {
    const gutter = 8;
    const left = Math.max(gutter, Math.min(event.clientX, window.innerWidth - width - gutter));
    const top = Math.max(gutter, Math.min(event.clientY, window.innerHeight - height - gutter));
    return { top, left };
  };

  const openContextMenu = (noteId: string, event: ReactMouseEvent<HTMLDivElement>) => {
    if (readOnly) return;
    event.preventDefault();
    const position = getMenuPosition(event, 200, 280);
    setContextMenu({ type: "note", noteId, ...position });
    // Preload expose status
    if (exposedSlugs[noteId] === undefined) {
      void getExposedSlug(noteId).then((slug) =>
        setExposedSlugs((prev) => ({ ...prev, [noteId]: slug }))
      );
    }
  };

  const handleExposeNote = async (note: NoteMeta) => {
    if (!syncEngine || exposeLoading) return;
    setExposeLoading(true);
    setContextMenu(null);

    // Safari/WebKit/Tauri drops clipboard permissions after the first `await`.
    // We must generate the slug and execute the copy synchronously right here,
    // while we are still inside the original mouse click event handler.
    const assignedSlug = exposedSlugs[note.id] || buildSlug(note.title || "Untitled");
    const optimisticUrl = `https://moduo.app/notes/${assignedSlug}`;
    copyToClipboard(optimisticUrl);

    // Show optimistic toast immediately
    setExposeToast({ url: optimisticUrl, visible: true });

    try {
      // Flush latest edits first
      await syncEngine.flushNote(note.id);
      // Get the current Y.Doc snapshot
      const session = syncEngine.getOrCreateSession(note.id);
      await session.persistence.whenSynced;
      const snapshot = Y.encodeStateAsUpdate(session.doc);
      const contentB64 = encodeUint8ToBase64(snapshot);

      const result = await exposeNote({
        noteId: note.id,
        workspaceId: note.workspaceId,
        title: note.title || "Untitled",
        contentB64,
        assignedSlug,
      });

      if (result.success) {
        setExposedSlugs((prev) => ({ ...prev, [note.id]: result.slug }));
        setExposeToast({ url: result.url, visible: true });
        setTimeout(() => setExposeToast(null), 6000);
      } else {
        setExposeToast(null); // Clear optimistic toast on failure
        alert(`Failed to expose note: ${result.error}`);
      }
    } catch {
      setExposeToast(null);
      alert("Failed to expose note due to an unexpected error.");
    } finally {
      setExposeLoading(false);
    }
  };

  const handleUnexposeNote = async (noteId: string) => {
    if (exposeLoading) return;
    setExposeLoading(true);
    try {
      await unexposeNote(noteId);
      setExposedSlugs((prev) => ({ ...prev, [noteId]: null }));
    } finally {
      setExposeLoading(false);
      setContextMenu(null);
    }
  };

  const openSidebarContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    if (readOnly) return;
    event.preventDefault();
    const target = event.target as HTMLElement;
    if (target.closest(".notes-tree-row, .notes-section-header, .notes-context-menu")) return;
    const position = getMenuPosition(event, 170, 130);
    setContextMenu({ type: "sidebar", ...position });
  };

  const runContextAction = (action: () => Promise<void>) => {
    setContextMenu(null);
    void action().catch(() => undefined);
  };

  const renderBranch = (parentId: string | null, depth: number) => {
    const items = byParent.get(parentId) ?? [];
    if (items.length === 0) return null;

    return (
      <SortableContext items={items.map((note) => `note:${note.id}`)} strategy={verticalListSortingStrategy}>
        {items.map((note) => {
          const children = byParent.get(note.id) ?? [];
          const isExpanded = expanded[note.id] ?? true;

          return (
            <div key={note.id}>
              <TreeRow
                note={note}
                depth={depth}
                hasChildren={children.length > 0}
                isExpanded={isExpanded}
                isSelected={selectedNoteId === note.id}
                onSelect={() => selectNoteWithPrewarm(note.id)}
                onToggleExpanded={() => toggleExpanded(note.id)}
                onContextMenu={(event) => openContextMenu(note.id, event)}
                dragHint={resolveDragHint(note.id)}
              />
              {isExpanded ? renderBranch(note.id, depth + 1) : null}
            </div>
          );
        })}
      </SortableContext>
    );
  };

  const layoutColumns = panelState.left
    ? "grid-cols-[20fr_80fr]"
    : "grid-cols-[1fr]";

  return (
    <div
      className={`grid h-full min-h-0 overflow-hidden bg-[#0C0C0C] p-4 gap-4 ${layoutColumns}`}
    >
      {panelState.left ? (
        <aside className="min-h-0 overflow-x-hidden overflow-y-auto rounded-[14px] bg-[#111111] p-3" onContextMenu={openSidebarContextMenu}>
          <div className="mb-[10px] grid gap-[6px]">
            <button
              type="button"
              className="notes-section-header flex w-full items-center justify-between border-0 bg-transparent px-[6px] py-[2px] text-[12px] tracking-[0.03em] text-[#8e8e8e]"
              onClick={() => toggleSection("pinned")}
            >
              <span>Pinned</span>
              <span>{sectionsExpanded.pinned ? "▾" : "▸"}</span>
            </button>

            {sectionsExpanded.pinned ? (
              pinnedNotes.length > 0 ? (
                <div className="grid gap-[3px] mb-2">
                  {pinnedNotes.map((note) => (
                    <ShortcutRow
                      key={`pinned:${note.id}`}
                      note={note}
                      isSelected={selectedNoteId === note.id}
                      onSelect={() => selectNoteWithPrewarm(note.id)}
                      onContextMenu={(event) => openContextMenu(note.id, event)}
                    />
                  ))}
                </div>
              ) : (
                <div className="px-2 pb-[6px] pt-[2px] text-[13px] text-[#7a7a7a]">No pinned notes</div>
              )
            ) : null}
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={(args) => {
              const byPointer = pointerWithin(args);
              if (byPointer.length > 0) {
                const nonRoot = byPointer.filter((entry) => String(entry.id) !== "inside:root");
                return nonRoot.length > 0 ? nonRoot : byPointer;
              }
              const byCenter = closestCenter(args);
              if (byCenter.length > 0) {
                const nonRoot = byCenter.filter((entry) => String(entry.id) !== "inside:root");
                return nonRoot.length > 0 ? nonRoot : byCenter;
              }
              return byCenter;
            }}
            onDragStart={(event) => {
              setDragActiveId(String(event.active.id));
              setDragOverId(null);
              setDragDeltaX(0);
            }}
            onDragMove={(event) => {
              setDragOverId(event.over ? String(event.over.id) : null);
              setDragDeltaX(event.delta?.x ?? 0);
            }}
            onDragCancel={resetDragState}
            onDragEnd={(event) => {
              void handleDragEnd(event).finally(resetDragState);
            }}
          >
            <SortableContext
              items={categorySections.map((entry) => `note:${entry.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {categorySections.map((category) => {
                const isOpen = categoryExpanded[category.id] ?? true;
                return (
                  <div key={category.id} className="mb-[10px] grid gap-[6px]">
                    <CategorySectionHeader
                      category={category}
                      isExpanded={isOpen}
                      onToggle={() => toggleCategorySection(category.id)}
                      onContextMenu={(event) => openContextMenu(category.id, event)}
                      dragHint={resolveDragHint(category.id)}
                    />
                    {isOpen ? <div className="grid gap-[3px]">{renderBranch(category.id, 1)}</div> : null}
                  </div>
                );
              })}
            </SortableContext>

            <div className="mb-[10px] grid gap-[6px]">
              <button
                type="button"
                className="notes-section-header flex w-full items-center justify-between border-0 bg-transparent px-[6px] py-[2px] text-[12px] tracking-[0.03em] text-[#8e8e8e]"
                onClick={() => toggleSection("notes")}
              >
                <span>Notes</span>
                <span>{sectionsExpanded.notes ? "▾" : "▸"}</span>
              </button>

              {sectionsExpanded.notes ? (
                <div
                  ref={rootDrop.setNodeRef}
                  className={`grid min-h-6 gap-[3px] rounded-[10px] ${rootDrop.isOver ? "bg-[#1c1c1c]" : ""}`}
                >
                  {renderBranch(null, 0) ?? <div className="h-6" />}
                </div>
              ) : null}
            </div>
          </DndContext>
        </aside>
      ) : null}

      <main className="grid min-h-0 min-w-0 grid-rows-[48px_1fr] overflow-hidden rounded-[14px] bg-[#111111]">
        <div className="flex items-center gap-[14px] px-[14px]">
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            <div className="truncate whitespace-nowrap text-[13px] text-[#7a7a7a]" title={breadcrumb}>
              {breadcrumb}
            </div>
            {selectedEditorNote ? (
              <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
                <span className="px-1 text-[12px] text-[#5f6570]">|</span>
                {(selectedEditorNote.tags ?? []).map((tag, index) => (
                  <span key={`${tag}-${index}`} className="inline-flex items-center gap-1 rounded-full bg-[#1a1a1a] px-2 py-0.5 text-[11px] text-[#9ea6b5]">
                    <span>#{tag}</span>
                    {!readOnly ? (
                      <button
                        type="button"
                        className="border-0 bg-transparent p-0 text-[11px] leading-none text-[#7c8494]"
                        onClick={() => {
                          const next = (selectedEditorNote.tags ?? []).filter((_, i) => i !== index);
                          void onUpdateTags(selectedEditorNote.id, next);
                        }}
                      >
                        ×
                      </button>
                    ) : null}
                  </span>
                ))}
                {!readOnly ? (
                  tagInputOpen ? (
                    <div className="inline-flex items-center gap-1 rounded-full bg-[#1a1a1a] px-2 py-0.5 text-[11px] text-[#9ea6b5]">
                      <span>#</span>
                      <input
                        ref={tagInputRef}
                        value={tagDraft}
                        onChange={(event) => setTagDraft(event.target.value)}
                        onBlur={() => {
                          const nextTag = tagDraft.trim();
                          if (!nextTag) {
                            setTagInputOpen(false);
                            return;
                          }
                          const nextTags = [...new Set([...(selectedEditorNote.tags ?? []), nextTag])];
                          void onUpdateTags(selectedEditorNote.id, nextTags);
                          setTagDraft("");
                          setTagInputOpen(false);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            const nextTag = tagDraft.trim();
                            if (!nextTag) {
                              setTagInputOpen(false);
                              return;
                            }
                            const nextTags = [...new Set([...(selectedEditorNote.tags ?? []), nextTag])];
                            void onUpdateTags(selectedEditorNote.id, nextTags);
                            setTagDraft("");
                            setTagInputOpen(false);
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setTagDraft("");
                            setTagInputOpen(false);
                          }
                        }}
                        className="w-20 bg-transparent text-[11px] text-[#d8dce5] outline-none"
                        placeholder="tag"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-full bg-[#1a1a1a] px-2 py-0.5 text-[11px] text-[#8d95a5]"
                      onClick={() => setTagInputOpen(true)}
                    >
                      + Tag
                    </button>
                  )
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {selectedEditorNote && syncEngine ? (
          <div className="grid min-h-0">
            <LexicalNoteEditor
              noteId={selectedEditorNote.id}
              title={selectedEditorNote.title}
              editable={!readOnly}
              onTitleChange={(value) => {
                void onUpdateTitle(selectedEditorNote.id, value);
              }}
              syncEngine={syncEngine}
              workspaceId={selectedEditorNote.workspaceId}
            />
          </div>
        ) : selectedEditorNote ? (
          <div className="grid min-h-0 place-content-center text-[#888888] text-[13px]">
            Preparing note...
          </div>
        ) : (
          <div className="grid place-content-center gap-[6px] text-[#9a9a9a]">
            <h3>No note selected</h3>
            <p>Use the bottom + menu to create section, folder, or note.</p>
          </div>
        )}
      </main>

      {contextMenu?.type === "note" && contextTarget ? (
        <div
          ref={contextMenuRef}
          className={contextMenuPanelClass}
          style={{ top: contextMenu.top, left: contextMenu.left }}
        >
          {!contextTargetIsSection ? (
            <button
              type="button"
              className={contextMenuItemClass}
              onClick={() => {
                runContextAction(async () => {
                  await onTogglePin(contextTarget.id, !contextTarget.isPinned);
                });
              }}
            >
              <span>{contextTarget.isPinned ? "Unpin" : "Pin"}</span>
            </button>
          ) : null}
          <button
            type="button"
            className={contextMenuItemClass}
            onClick={() => {
              runContextAction(async () => {
                const created = await onCreateNote(contextTarget.id, "note");
                if (created) selectNoteWithPrewarm(created);
                setExpanded((current) => ({ ...current, [contextTarget.id]: true }));
                if (contextTarget.kind === "category") {
                  setCategoryExpanded((current) => ({ ...current, [contextTarget.id]: true }));
                }
              });
            }}
          >
            <span>Add Note</span>
          </button>
          <button
            type="button"
            className={contextMenuItemClass}
            onClick={() => {
              runContextAction(async () => {
                const created = await onCreateNote(contextTarget.id, "folder");
                if (created) selectNoteWithPrewarm(created);
                setExpanded((current) => ({ ...current, [contextTarget.id]: true }));
                if (contextTarget.kind === "category") {
                  setCategoryExpanded((current) => ({ ...current, [contextTarget.id]: true }));
                }
              });
            }}
          >
            <span>Add Folder</span>
          </button>
          <button
            type="button"
            className={contextMenuItemClass}
            onClick={() => {
              const currentTitle = contextTarget.title || "Untitled";
              const next = window.prompt("Rename", currentTitle);
              if (!next) return;
              const trimmed = next.trim();
              if (!trimmed || trimmed === currentTitle) return;
              runContextAction(async () => {
                await onUpdateTitle(contextTarget.id, trimmed);
              });
            }}
          >
            <span>Rename</span>
          </button>
          {!contextTargetIsSection ? (
            <button
              type="button"
              className={contextMenuItemClass}
              onClick={() => {
                runContextAction(async () => {
                  const created = await onDuplicateNote(contextTarget.id);
                  if (created && contextTarget.kind !== "category") selectNoteWithPrewarm(created);
                });
              }}
            >
              <span>Mirror</span>
            </button>
          ) : null}

          {/* ── Expose ── */}
          {!contextTargetIsSection && contextTarget.kind === "note" ? (
            exposedSlugs[contextTarget.id] ? (
              <>
                <button
                  type="button"
                  className={contextMenuItemClass}
                  onClick={() => {
                    const url = `https://moduo.app/notes/${exposedSlugs[contextTarget.id]}`;
                    copyToClipboard(url);
                    setExposeToast({ url, visible: true });
                    setTimeout(() => setExposeToast(null), 4000);
                    setContextMenu(null);
                  }}
                >
                  <span>Copy Public URL</span>
                </button>
                <button
                  type="button"
                  className={contextMenuDeleteItemClass}
                  disabled={exposeLoading}
                  onClick={() => void handleUnexposeNote(contextTarget.id)}
                >
                  <span>{exposeLoading ? "Removing…" : "Unexpose"}</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                className={contextMenuItemClass}
                style={{ color: "#a3c4f3" }}
                disabled={exposeLoading || !syncEngine}
                onClick={() => void handleExposeNote(contextTarget)}
              >
                <span>{exposeLoading ? "Exposing…" : "✦ Expose to web"}</span>
              </button>
            )
          ) : null}

          <div style={{ height: 1, background: "#222", margin: "4px 0" }} />

          <button
            type="button"
            className={contextMenuDeleteItemClass}
            onClick={() => {
              runContextAction(async () => {
                await onDeleteNote(contextTarget.id);
              });
            }}
          >
            <span>Delete</span>
          </button>
        </div>
      ) : null}

      {contextMenu?.type === "sidebar" ? (
        <div
          ref={contextMenuRef}
          className={contextMenuPanelClass}
          style={{ top: contextMenu.top, left: contextMenu.left }}
        >
          <button
            type="button"
            className={contextMenuItemClass}
            onClick={() => {
              runContextAction(async () => {
                await onCreateNote(null, "category");
              });
            }}
          >
            <span>New Section</span>
          </button>
          <button
            type="button"
            className={contextMenuItemClass}
            onClick={() => {
              runContextAction(async () => {
                const created = await onCreateNote(null, "folder");
                if (created) selectNoteWithPrewarm(created);
              });
            }}
          >
            <span>New Folder</span>
          </button>
          <button
            type="button"
            className={contextMenuItemClass}
            onClick={() => {
              runContextAction(async () => {
                const created = await onCreateNote(null, "note");
                if (created) selectNoteWithPrewarm(created);
              });
            }}
          >
            <span>New Note</span>
          </button>
        </div>
      ) : null}

      {/* ── Expose Toast ── */}
      {typeof document !== "undefined" && exposeToast?.visible
        ? createPortal(
            <div
              className="fixed bottom-6 z-[3500] flex items-center gap-3 rounded-[14px] border border-[#2a2a2a] bg-[#161616] px-5 py-3 shadow-[0_16px_40px_#00000080] text-[13px] text-[#d0d0d0] pointer-events-auto"
              style={{ left: "50%", transform: "translateX(-50%)", animation: "fadeSlideUp 0.25s ease" }}
            >
              <span className="text-[#a3c4f3]">✦</span>
              <span>
                Note live at{" "}
                <button
                  type="button"
                  onClick={() => {
                    void openExternalUrl(exposeToast.url);
                  }}
                  className="cursor-pointer border-0 bg-transparent p-0 underline text-[#a3c4f3] hover:text-[#c5d9f7]"
                >
                  {exposeToast.url.replace("https://", "")}
                </button>
              </span>
              <span className="ml-1 text-[11px] text-[#555]">— URL copied!</span>
              <button
                type="button"
                className="ml-2 text-[#555] hover:text-[#aaa]"
                onClick={() => setExposeToast(null)}
              >
                ✕
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
