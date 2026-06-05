import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { getRuntime } from "../../../lib/runtime";
import { toast } from "sonner";
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
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
  Pin,
} from "lucide-react";
import type { NoteKind, NoteMeta } from "../types";
import type { NotesSyncEngine } from "../sync/sync-engine";
import { LexicalNoteEditor } from "../editor/LexicalNoteEditor";
import {
  NOTES_CREATE_KIND_EVENT,
  type NotesCreateKindEventDetail,
} from "./layout-events";
import { exposeNote, unexposeNote, getExposedSlug, buildSlug } from "../utils/expose";
import { encodeUint8ToBase64 } from "../utils/base64";
import * as Y from "yjs";
import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../../components/ui/context-menu";
import { NotesRightRail } from "./notes-right-rail";

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
    const rt = getRuntime();
    if (rt) {
      await rt.window.openExternalUrl(target);
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

const NEST_THRESHOLD_PX = 12;

function NoteKindIcon({ kind }: { kind: NoteKind }) {
  // text-current so the icon inherits the row colour and flips on hover / selection.
  const className = "size-3.5 shrink-0 text-current opacity-70";
  if (kind === "folder") return <Folder className={className} aria-hidden="true" />;
  return <FileIcon className={className} aria-hidden="true" />;
}

const SIDEBAR_ROW_BASE =
  "group/row relative flex w-full min-w-0 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring data-[selected=true]:bg-accent data-[selected=true]:text-foreground";
const SIDEBAR_SECTION_TITLE =
  "flex w-full items-center justify-between gap-2 border-0 bg-transparent px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";

function MenuOpenEffect({ onMount }: { onMount: () => void }) {
  useEffect(() => {
    onMount();
    // We want this to run exactly once per ContextMenuContent mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

type NoteRowProps = {
  note: NoteMeta;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onToggleExpanded: () => void;
  menu: ReactNode;
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
  menu,
  dragHint = "none",
}: NoteRowProps) {
  const sortable = useSortable({ id: `note:${note.id}` });

  const wrapperStyle = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
    paddingLeft: depth * 14,
  };

  return (
    <div ref={sortable.setNodeRef} style={wrapperStyle} className="relative">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={`${SIDEBAR_ROW_BASE} py-1 ${dragHint === "nest" ? "bg-accent/60" : ""}`}
            style={{ minHeight: "var(--row-h)" }}
            data-selected={isSelected ? "true" : "false"}
            onClick={onSelect}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSelect();
            }}
          >
            <button
              type="button"
              aria-label={isExpanded ? "Collapse" : "Expand"}
              className="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground transition-opacity hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[has-children=false]:pointer-events-none data-[has-children=false]:opacity-0"
              data-has-children={hasChildren ? "true" : "false"}
              disabled={!hasChildren}
              onClick={(event) => {
                event.stopPropagation();
                if (hasChildren) onToggleExpanded();
              }}
            >
              {isExpanded ? (
                <ChevronDown className="size-3" aria-hidden="true" />
              ) : (
                <ChevronRight className="size-3" aria-hidden="true" />
              )}
            </button>
            <NoteKindIcon kind={note.kind} />
            <span
              className="min-w-0 flex-1 truncate"
              ref={sortable.setActivatorNodeRef}
              {...sortable.attributes}
              {...sortable.listeners}
            >
              {note.title || "Untitled"}
            </span>
            {note.isPinned ? (
              <Pin className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : null}
          </div>
        </ContextMenuTrigger>
        {menu}
      </ContextMenu>
    </div>
  );
}

type ShortcutRowProps = {
  note: NoteMeta;
  isSelected: boolean;
  onSelect: () => void;
  menu: ReactNode;
};

function ShortcutRow({ note, isSelected, onSelect, menu }: ShortcutRowProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`${SIDEBAR_ROW_BASE} py-1`}
          style={{ minHeight: "var(--row-h)" }}
          data-selected={isSelected ? "true" : "false"}
          onClick={onSelect}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSelect();
          }}
        >
          <Pin className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <NoteKindIcon kind={note.kind} />
          <span className="min-w-0 flex-1 truncate">{note.title || "Untitled"}</span>
        </div>
      </ContextMenuTrigger>
      {menu}
    </ContextMenu>
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sectionsExpanded, setSectionsExpanded] = useState({
    pinned: true,
    notes: true,
  });
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragDeltaX, setDragDeltaX] = useState(0);
  // Expose feature
  const [exposedSlugs, setExposedSlugs] = useState<Record<string, string | null>>({});
  const [exposeLoading, setExposeLoading] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const rootDrop = useDroppable({ id: "inside:root" });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onCreateKind = async (event: Event) => {
      if (readOnly) return;
      const detail = (event as CustomEvent<NotesCreateKindEventDetail>).detail;
      const kind = detail?.kind ?? "note";
      const createdId = await onCreateNote(null, kind);
      if (createdId) {
        prewarmNoteSession(createdId);
        onSelectNote(createdId);
      }
    };

    window.addEventListener(NOTES_CREATE_KIND_EVENT, onCreateKind);

    return () => {
      window.removeEventListener(NOTES_CREATE_KIND_EVENT, onCreateKind);
    };
  }, [onCreateNote, onSelectNote, readOnly, syncEngine]);

  const activeNotes = useMemo(
    () => notes.filter((note) => !note.deletedAt && !note.isArchived),
    [notes]
  );

  const listNotes = useMemo(() => activeNotes, [activeNotes]);

  const byParent = useMemo(() => {
    const grouped = new Map<string | null, NoteMeta[]>();
    for (const note of listNotes) {
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

  const pinnedNotes = useMemo(
    () =>
      listNotes
        .filter((note) => note.isPinned)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title)),
    [listNotes]
  );

  const notesById = useMemo(() => new Map(activeNotes.map((note) => [note.id, note])), [activeNotes]);
  const selectedNote = activeNotes.find((note) => note.id === selectedNoteId) ?? null;
  const selectedEditorNote = selectedNote;

  const breadcrumbSegments = useMemo(() => {
    if (!selectedEditorNote) return ["Notes"];
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
    return [...chain, selectedEditorNote.title || "Untitled"];
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
    if (dragDeltaX > NEST_THRESHOLD_PX) return "nest";
    return "reorder";
  };

  const toggleExpanded = (noteId: string) => {
    setExpanded((current) => ({ ...current, [noteId]: !current[noteId] }));
  };

  const toggleSection = (section: "pinned" | "notes") => {
    setSectionsExpanded((current) => ({ ...current, [section]: !current[section] }));
  };

  const preloadExposeStatus = (noteId: string) => {
    if (exposedSlugs[noteId] !== undefined) return;
    void getExposedSlug(noteId).then((slug) =>
      setExposedSlugs((prev) => ({ ...prev, [noteId]: slug }))
    );
  };

  const showLiveToast = (url: string) => {
    toast.success("Note published", {
      description: url.replace(/^https?:\/\//, ""),
      action: {
        label: "Open",
        onClick: () => void openExternalUrl(url),
      },
      duration: 6000,
    });
  };

  const handleExposeNote = async (note: NoteMeta) => {
    if (!syncEngine || exposeLoading) return;
    setExposeLoading(true);

    // Safari/WebKit/Tauri drops clipboard permissions after the first `await`.
    // We must generate the slug and execute the copy synchronously right here,
    // while we are still inside the original mouse click event handler.
    const assignedSlug = exposedSlugs[note.id] || buildSlug(note.title || "Untitled");
    const optimisticUrl = `https://moduo.app/notes/${assignedSlug}`;
    copyToClipboard(optimisticUrl);
    showLiveToast(optimisticUrl);

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
        if (result.url !== optimisticUrl) showLiveToast(result.url);
      } else {
        toast.error("Failed to publish note", { description: result.error });
      }
    } catch {
      toast.error("Failed to publish note", {
        description: "An unexpected error occurred. Try again.",
      });
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
      toast.success("Note unpublished");
    } finally {
      setExposeLoading(false);
    }
  };

  const handleCopyLink = (noteId: string) => {
    copyToClipboard(`moduo://notes/${noteId}`);
    toast.success("Link copied");
  };

  const handleRenameNote = (note: NoteMeta) => {
    const next = window.prompt("Rename", note.title || "Untitled");
    if (!next) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === note.title) return;
    void onUpdateTitle(note.id, trimmed);
  };

  const handleAddNote = async (parentId: string | null, kind: NoteKind = "note") => {
    const created = await onCreateNote(parentId, kind);
    if (!created) return;
    if (parentId) {
      setExpanded((current) => ({ ...current, [parentId]: true }));
    }
    await selectNoteWithPrewarm(created);
  };

  const renderNoteMenu = (note: NoteMeta): ReactNode => {
    const isExposed = !!exposedSlugs[note.id];
    return (
      <ContextMenuContent
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <MenuOpenEffect onMount={() => preloadExposeStatus(note.id)} />
        <ContextMenuItem
          disabled={readOnly}
          onSelect={() => void onTogglePin(note.id, !note.isPinned)}
        >
          {note.isPinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => handleCopyLink(note.id)}>
          Copy Link
        </ContextMenuItem>
        <ContextMenuItem
          disabled={readOnly}
          onSelect={() => {
            void (async () => {
              const created = await onDuplicateNote(note.id);
              if (created) await selectNoteWithPrewarm(created);
            })();
          }}
        >
          Duplicate
        </ContextMenuItem>
        <ContextMenuItem
          disabled={readOnly}
          onSelect={() => handleRenameNote(note)}
        >
          Rename
        </ContextMenuItem>
        {note.kind === "folder" ? (
          <>
            <ContextMenuItem
              disabled={readOnly}
              onSelect={() => void handleAddNote(note.id, "note")}
            >
              Add Note
            </ContextMenuItem>
            <ContextMenuItem
              disabled={readOnly}
              onSelect={() => void handleAddNote(note.id, "folder")}
            >
              Add Folder
            </ContextMenuItem>
          </>
        ) : null}
        {note.kind === "note" ? (
          <ContextMenuItem
            disabled={readOnly || exposeLoading || !syncEngine}
            onSelect={() => {
              if (isExposed) void handleUnexposeNote(note.id);
              else void handleExposeNote(note);
            }}
          >
            {isExposed ? (exposeLoading ? "Unpublishing…" : "Unpublish") : exposeLoading ? "Publishing…" : "Publish"}
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          disabled={readOnly}
          onSelect={() => void onDeleteNote(note.id)}
        >
          Move to Trash
        </ContextMenuItem>
      </ContextMenuContent>
    );
  };

  const sidebarMenuContent: ReactNode = (
    <ContextMenuContent>
      <ContextMenuItem
        disabled={readOnly}
        onSelect={() => void handleAddNote(null, "folder")}
      >
        New Folder
      </ContextMenuItem>
      <ContextMenuItem
        disabled={readOnly}
        onSelect={() => void handleAddNote(null, "note")}
      >
        New Note
      </ContextMenuItem>
    </ContextMenuContent>
  );

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
                menu={renderNoteMenu(note)}
                dragHint={resolveDragHint(note.id)}
              />
              {isExpanded ? renderBranch(note.id, depth + 1) : null}
            </div>
          );
        })}
      </SortableContext>
    );
  };

  const leftSlot = (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overflow-x-hidden">
          {pinnedNotes.length > 0 ? (
            <section className="flex flex-col gap-1">
              <button
                type="button"
                className={SIDEBAR_SECTION_TITLE}
                onClick={() => toggleSection("pinned")}
              >
                <span className="flex items-center gap-2">
                  {sectionsExpanded.pinned ? (
                    <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
                  )}
                  <Pin className="size-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">Pinned</span>
                </span>
              </button>
              {sectionsExpanded.pinned ? (
                <div className="flex flex-col gap-px">
                  {pinnedNotes.map((note) => (
                    <ShortcutRow
                      key={`pinned:${note.id}`}
                      note={note}
                      isSelected={selectedNoteId === note.id}
                      onSelect={() => selectNoteWithPrewarm(note.id)}
                      menu={renderNoteMenu(note)}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

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
            <section className="flex flex-col gap-1">
              <button
                type="button"
                className={SIDEBAR_SECTION_TITLE}
                onClick={() => toggleSection("notes")}
              >
                <span className="flex items-center gap-2">
                  {sectionsExpanded.notes ? (
                    <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
                  )}
                  <FileIcon className="size-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">Notes</span>
                </span>
              </button>
              {sectionsExpanded.notes ? (
                <div
                  ref={rootDrop.setNodeRef}
                  className={`flex min-h-6 flex-col gap-px rounded-md transition-colors ${rootDrop.isOver ? "bg-accent/50" : ""}`}
                >
                  {renderBranch(null, 0) ?? <div className="h-6" />}
                </div>
              ) : null}
            </section>
          </DndContext>
        </div>
      </ContextMenuTrigger>
      {sidebarMenuContent}
    </ContextMenu>
  );

  const centerSlot = (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center px-2" style={{ minHeight: "var(--ctrl-h-lg)" }}>
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground"
        >
          {breadcrumbSegments.map((segment, index) => {
            const isLast = index === breadcrumbSegments.length - 1;
            return (
              <Fragment key={`${segment}-${index}`}>
                {index > 0 ? (
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : null}
                <span
                  className={`truncate ${isLast ? "text-foreground" : ""}`}
                  title={segment}
                >
                  {segment}
                </span>
              </Fragment>
            );
          })}
        </nav>
      </header>

      {selectedEditorNote && syncEngine ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[var(--width-prose-max)] px-2 pb-24 pt-4">
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
        </div>
      ) : selectedEditorNote ? (
        <div className="grid min-h-0 flex-1 place-content-center text-sm text-muted-foreground">
          Preparing note…
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 place-content-center gap-2 text-center">
          <h3 className="font-display text-2xl text-foreground">No note selected</h3>
          <p className="text-sm text-muted-foreground">
            Pick a note from the sidebar, or right-click to create one.
          </p>
        </div>
      )}
    </div>
  );

  const rightSlot = (
    <NotesRightRail
      selectedNote={selectedNote}
      allNotes={activeNotes}
      readOnly={readOnly}
      onSelectNote={(id) => void selectNoteWithPrewarm(id)}
      onUpdateTags={onUpdateTags}
    />
  );

  return (
    <>
      <FeaturePanelsShell
        feature="notes"
        left={leftSlot}
        center={centerSlot}
        right={rightSlot}
      />
    </>
  );
}
