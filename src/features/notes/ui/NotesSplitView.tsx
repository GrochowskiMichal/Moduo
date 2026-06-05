import { Fragment, useEffect, useMemo, useState, type HTMLAttributes, type ReactNode, type RefCallback } from "react";
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
  MoreHorizontal,
  Pin,
  Plus,
  Share2,
} from "lucide-react";
import type { NoteKind, NoteMeta, NoteSharePermission, NoteShareScope, NoteShareTarget } from "../types";
import type { NotesSyncEngine } from "../sync/sync-engine";
import { LexicalNoteEditor } from "../editor/LexicalNoteEditor";
import {
  NOTES_CREATE_KIND_EVENT,
  type NotesCreateKindEventDetail,
} from "./layout-events";
import { exposeNote, unexposeNote, getExposedSlug, listExposedSlugs, buildSlug } from "../utils/expose";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
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
  workspaceId: string;
  selectedNoteId: string | null;
  onSelectNote: (id: string) => void;
  onCreateNote: (parentId?: string | null, kind?: NoteKind) => Promise<string | null>;
  onMoveNote: (noteId: string, parentId: string | null, beforeId?: string | null) => Promise<void>;
  onUpdateTitle: (noteId: string, title: string) => Promise<void>;
  onUpdateTags: (noteId: string, tags: string[]) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onDuplicateNote: (noteId: string) => Promise<string | null>;
  onTogglePin: (noteId: string, isPinned: boolean) => Promise<void>;
  onUpdateSharing: (
    noteId: string,
    shareScope: NoteShareScope,
    sharePermission: NoteSharePermission,
    selectedUsers: NoteShareTarget[]
  ) => Promise<void>;
  workspaceMembers: any[];
  currentUserId: string | null;
  readOnly?: boolean;
  syncEngine: NotesSyncEngine | null;
};

const NEST_THRESHOLD_PX = 12;

function NoteKindIcon({ kind }: { kind: NoteKind }) {
  // text-current so the icon inherits the row colour and flips on hover / selection.
  const className = "size-3.5 shrink-0 text-current opacity-70";
  return <FileIcon className={className} aria-hidden="true" />;
}

const SIDEBAR_ROW_BASE =
  "group/row relative flex w-full min-w-0 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring data-[selected=true]:bg-accent data-[selected=true]:text-foreground";
const SIDEBAR_SECTION_TITLE =
  "flex w-full items-center justify-between gap-2 border-0 bg-transparent px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";

function SectionTitleContents({
  title,
  isExpanded,
  titleRef,
  titleProps,
}: {
  title: string;
  isExpanded: boolean;
  titleRef?: RefCallback<HTMLSpanElement>;
  titleProps?: HTMLAttributes<HTMLSpanElement>;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span ref={titleRef} {...titleProps} className={`truncate ${titleProps?.className ?? ""}`}>
        {title}
      </span>
      <span className="grid size-3 shrink-0 place-items-center opacity-0 transition-opacity group-hover/section:opacity-100 group-focus-within/section:opacity-100">
        {isExpanded ? (
          <ChevronDown className="size-3" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3" aria-hidden="true" />
        )}
      </span>
    </span>
  );
}

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
  isExpanded: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onToggleExpanded: () => void;
  onAddChild: () => void;
  menu: ReactNode;
  dropdownMenu: ReactNode;
  readOnly: boolean;
  dragHint?: "none" | "reorder" | "nest";
};

function TreeRow({
  note,
  depth,
  isExpanded,
  isSelected,
  onSelect,
  onToggleExpanded,
  onAddChild,
  menu,
  dropdownMenu,
  readOnly,
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
            className={`${SIDEBAR_ROW_BASE} py-1 pr-1 ${dragHint === "nest" ? "bg-accent/60" : ""}`}
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
              className="relative grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpanded();
              }}
            >
              <span className="grid place-items-center opacity-100 transition-opacity group-hover/row:opacity-0 group-focus-within/row:opacity-0">
                <NoteKindIcon kind={note.kind} />
              </span>
              <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
                {isExpanded ? (
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                ) : (
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                )}
              </span>
            </button>
            <span
              className="min-w-0 flex-1 truncate"
              ref={sortable.setActivatorNodeRef}
              {...sortable.attributes}
              {...sortable.listeners}
            >
              {note.title || "Untitled"}
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Delete, duplicate, and more"
                        className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <MoreHorizontal className="size-4" aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Delete, duplicate, and more...</TooltipContent>
                </Tooltip>
                {dropdownMenu}
              </DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Add a page inside"
                    className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
                    disabled={readOnly}
                    onClick={(event) => {
                      event.stopPropagation();
                      onAddChild();
                    }}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Add a page inside</TooltipContent>
              </Tooltip>
            </div>
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
  onAddChild: () => void;
  menu: ReactNode;
  dropdownMenu: ReactNode;
  readOnly: boolean;
};

function ShortcutRow({ note, isSelected, onSelect, onAddChild, menu, dropdownMenu, readOnly }: ShortcutRowProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`${SIDEBAR_ROW_BASE} py-1 pr-1`}
          style={{ minHeight: "var(--row-h)" }}
          data-selected={isSelected ? "true" : "false"}
          onClick={onSelect}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSelect();
          }}
        >
          <NoteKindIcon kind={note.kind} />
          <span className="min-w-0 flex-1 truncate">{note.title || "Untitled"}</span>
          <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Delete, duplicate, and more"
                      className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <MoreHorizontal className="size-4" aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Delete, duplicate, and more...</TooltipContent>
              </Tooltip>
              {dropdownMenu}
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Add a page inside"
                  className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
                  disabled={readOnly}
                  onClick={(event) => {
                    event.stopPropagation();
                    onAddChild();
                  }}
                >
                  <Plus className="size-4" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Add a page inside</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </ContextMenuTrigger>
      {menu}
    </ContextMenu>
  );
}

type SectionHeaderProps = {
  section: NoteMeta;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onAddChild: () => void;
  menu: ReactNode;
  dropdownMenu: ReactNode;
  readOnly: boolean;
  dragHint?: "none" | "reorder" | "nest";
};

function SectionHeader({
  section,
  isExpanded,
  onToggleExpanded,
  onAddChild,
  menu,
  dropdownMenu,
  readOnly,
  dragHint = "none",
}: SectionHeaderProps) {
  const sortable = useSortable({ id: `note:${section.id}` });
  const drop = useDroppable({ id: `inside:${section.id}` });
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
      className={`relative rounded-md ${drop.isOver || dragHint === "nest" ? "bg-accent/60" : ""}`}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={`${SIDEBAR_SECTION_TITLE} group/section pr-1`}
            role="button"
            tabIndex={0}
            onClick={onToggleExpanded}
            onKeyDown={(event) => {
              if (event.key === "Enter") onToggleExpanded();
            }}
          >
            <SectionTitleContents
              title={section.title || "New Section"}
              isExpanded={isExpanded}
              titleRef={sortable.setActivatorNodeRef}
              titleProps={{
                ...sortable.attributes,
                ...sortable.listeners,
              }}
            />
            <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/section:opacity-100 group-focus-within/section:opacity-100">
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Delete, duplicate, and more"
                        className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <MoreHorizontal className="size-4" aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Delete, duplicate, and more...</TooltipContent>
                </Tooltip>
                {dropdownMenu}
              </DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Add a page inside"
                    className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
                    disabled={readOnly}
                    onClick={(event) => {
                      event.stopPropagation();
                      onAddChild();
                    }}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Add a page inside</TooltipContent>
              </Tooltip>
            </span>
          </div>
        </ContextMenuTrigger>
        {menu}
      </ContextMenu>
    </div>
  );
}

export function NotesSplitView({
  notes,
  workspaceId,
  selectedNoteId,
  onSelectNote,
  onCreateNote,
  onMoveNote,
  onUpdateTitle,
  onUpdateTags,
  onDeleteNote,
  onDuplicateNote,
  onTogglePin,
  onUpdateSharing,
  workspaceMembers,
  currentUserId,
  readOnly = false,
  syncEngine,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sectionsExpanded, setSectionsExpanded] = useState({
    pinned: true,
    published: true,
    shared: true,
    private: true,
  });
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragDeltaX, setDragDeltaX] = useState(0);
  // Expose feature
  const [exposedSlugs, setExposedSlugs] = useState<Record<string, string | null>>({});
  const [exposeLoading, setExposeLoading] = useState(false);
  const [sharingNote, setSharingNote] = useState<NoteMeta | null>(null);
  const [shareScopeDraft, setShareScopeDraft] = useState<NoteShareScope>("private");
  const [sharePermissionDraft, setSharePermissionDraft] = useState<NoteSharePermission>("view");
  const [shareUsersDraft, setShareUsersDraft] = useState<NoteShareTarget[]>([]);
  const [shareSaving, setShareSaving] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const rootDrop = useDroppable({ id: "inside:root" });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onCreateKind = async (event: Event) => {
      if (readOnly) return;
      const detail = (event as CustomEvent<NotesCreateKindEventDetail>).detail;
      const kind = detail?.kind ?? "note";
      const createdId = await onCreateNote(null, kind);
      if (createdId && kind === "note") {
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

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    void listExposedSlugs(workspaceId).then((slugs) => {
      if (!active) return;
      setExposedSlugs((current) => ({ ...slugs, ...current }));
    });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  const listNotes = useMemo(() => activeNotes, [activeNotes]);

  const byParent = useMemo(() => {
    const grouped = new Map<string | null, NoteMeta[]>();
    for (const note of listNotes) {
      if (note.kind === "section") continue;
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

  const sectionNotes = useMemo(
    () =>
      listNotes
        .filter((note) => note.kind === "section" && !note.parentId)
        .sort((a, b) => a.position.localeCompare(b.position) || a.title.localeCompare(b.title)),
    [listNotes]
  );

  const pinnedNotes = useMemo(
    () =>
      listNotes
        .filter((note) => note.isPinned && note.kind === "note")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title)),
    [listNotes]
  );

  const publishedNotes = useMemo(
    () =>
      listNotes
        .filter((note) => note.kind === "note" && !!exposedSlugs[note.id])
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title)),
    [exposedSlugs, listNotes]
  );

  const sharedNotes = useMemo(
    () =>
      listNotes
        .filter((note) => note.kind === "note" && note.shareScope !== "private")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title)),
    [listNotes]
  );

  const teamMembers = useMemo(
    () =>
      workspaceMembers
        .map((member) => ({
          id: String(member.user_id ?? member.userId ?? ""),
          name: String(member.profiles?.display_name ?? member.displayName ?? member.user_id ?? member.userId ?? "Teammate"),
          role: String(member.role ?? "member"),
        }))
        .filter((member) => member.id && member.id !== currentUserId),
    [currentUserId, workspaceMembers]
  );

  const isTeamWorkspace = teamMembers.length > 0;

  const notesById = useMemo(() => new Map(activeNotes.map((note) => [note.id, note])), [activeNotes]);
  const selectedNote = activeNotes.find((note) => note.id === selectedNoteId) ?? null;
  const selectedEditorNote = selectedNote?.kind === "note" ? selectedNote : null;
  const selectedReadOnly = readOnly || selectedEditorNote?.effectivePermission !== "edit";

  const noteReadOnly = (note: NoteMeta): boolean => readOnly || note.effectivePermission !== "edit";
  const canManageSharing = (note: NoteMeta): boolean =>
    !readOnly && isTeamWorkspace && note.kind === "note" && note.ownerId === currentUserId;

  const breadcrumbSegments = useMemo(() => {
    if (!selectedEditorNote) return ["Private"];
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
    if (moving.kind === "section") return targetParentId === null;
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
      if (moving.kind === "section" && targetParentId) {
        const target = notesById.get(targetParentId);
        if (target?.kind === "section") {
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

      if (target.kind === "section" && moving.kind === "note") {
        if (!canMoveUnderParent(moving, target.id)) return;
        await onMoveNote(movingNoteId, target.id, null);
        expandParent(target.id);
        return;
      }

      if (moving.kind === "section") {
        if (target.kind !== "section") return;
        const sectionSiblings = sectionNotes.filter((entry) => entry.id !== moving.id);
        const beforeId = dropAfter
          ? getBeforeIdAfterTarget(sectionSiblings, target.id)
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
    if (moving.kind === "section") return target.kind === "section" ? "reorder" : "none";
    if (target.kind === "section") return "nest";
    if (dragDeltaX > NEST_THRESHOLD_PX) return "nest";
    return "reorder";
  };

  const toggleExpanded = (noteId: string) => {
    setExpanded((current) => ({ ...current, [noteId]: !current[noteId] }));
  };

  const toggleSection = (section: "pinned" | "published" | "shared" | "private") => {
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
    if (kind === "note") await selectNoteWithPrewarm(created);
  };

  const openShareDialog = (note: NoteMeta) => {
    setSharingNote(note);
    setShareScopeDraft(note.shareScope);
    setSharePermissionDraft(note.sharePermission);
    setShareUsersDraft(note.shares);
  };

  const toggleShareUser = (userId: string) => {
    setShareUsersDraft((current) => {
      if (current.some((share) => share.userId === userId)) {
        return current.filter((share) => share.userId !== userId);
      }
      return [...current, { userId, permission: sharePermissionDraft }];
    });
  };

  const setShareUserPermission = (userId: string, permission: NoteSharePermission) => {
    setShareUsersDraft((current) =>
      current.map((share) => (share.userId === userId ? { ...share, permission } : share))
    );
  };

  const saveShareDialog = async () => {
    if (!sharingNote || shareSaving) return;
    setShareSaving(true);
    try {
      const selectedUsers =
        shareScopeDraft === "selected"
          ? shareUsersDraft.map((share) => ({ ...share, permission: share.permission ?? sharePermissionDraft }))
          : [];
      await onUpdateSharing(sharingNote.id, shareScopeDraft, sharePermissionDraft, selectedUsers);
      setSharingNote(null);
      toast.success(shareScopeDraft === "private" ? "Note is private" : "Sharing updated");
    } catch {
      toast.error("Failed to update sharing");
    } finally {
      setShareSaving(false);
    }
  };

  const renderNoteMenu = (note: NoteMeta): ReactNode => {
    const isExposed = !!exposedSlugs[note.id];
    const isReadOnly = noteReadOnly(note);
    const canShare = canManageSharing(note);
    return (
      <ContextMenuContent
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <MenuOpenEffect onMount={() => preloadExposeStatus(note.id)} />
        {note.kind === "note" ? (
          <ContextMenuItem
            disabled={isReadOnly}
            onSelect={() => void onTogglePin(note.id, !note.isPinned)}
          >
            {note.isPinned ? "Unpin" : "Pin"}
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem onSelect={() => handleCopyLink(note.id)}>
          Copy Link
        </ContextMenuItem>
        <ContextMenuItem
          disabled={isReadOnly}
          onSelect={() => {
              void (async () => {
                const created = await onDuplicateNote(note.id);
                if (created && note.kind === "note") await selectNoteWithPrewarm(created);
              })();
          }}
        >
          Duplicate
        </ContextMenuItem>
        <ContextMenuItem
          disabled={isReadOnly}
          onSelect={() => handleRenameNote(note)}
        >
          Rename
        </ContextMenuItem>
        {note.kind === "section" ? (
          <>
            <ContextMenuItem
              disabled={readOnly}
              onSelect={() => void handleAddNote(note.id, "note")}
            >
              Add Note
            </ContextMenuItem>
          </>
        ) : null}
        {note.kind === "note" ? (
          <ContextMenuItem
            disabled={isReadOnly || exposeLoading || !syncEngine}
            onSelect={() => {
              if (isExposed) void handleUnexposeNote(note.id);
              else void handleExposeNote(note);
            }}
          >
            {isExposed ? (exposeLoading ? "Unpublishing…" : "Unpublish") : exposeLoading ? "Publishing…" : "Publish"}
          </ContextMenuItem>
        ) : null}
        {note.kind === "note" && isTeamWorkspace ? (
          <ContextMenuItem
            disabled={!canShare}
            onSelect={() => openShareDialog(note)}
          >
            Share
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          disabled={readOnly || note.ownerId !== currentUserId}
          onSelect={() => void onDeleteNote(note.id)}
        >
          Move to Trash
        </ContextMenuItem>
      </ContextMenuContent>
    );
  };

  const renderNoteDropdownMenu = (note: NoteMeta): ReactNode => {
    const isExposed = !!exposedSlugs[note.id];
    const isReadOnly = noteReadOnly(note);
    const canShare = canManageSharing(note);
    return (
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <MenuOpenEffect onMount={() => preloadExposeStatus(note.id)} />
        {note.kind === "note" ? (
          <DropdownMenuItem
            disabled={isReadOnly}
            onSelect={() => void onTogglePin(note.id, !note.isPinned)}
          >
            {note.isPinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => handleCopyLink(note.id)}>
          Copy Link
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isReadOnly}
          onSelect={() => {
              void (async () => {
                const created = await onDuplicateNote(note.id);
                if (created && note.kind === "note") await selectNoteWithPrewarm(created);
              })();
          }}
        >
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isReadOnly}
          onSelect={() => handleRenameNote(note)}
        >
          Rename
        </DropdownMenuItem>
        {note.kind === "section" ? (
          <>
            <DropdownMenuItem
              disabled={isReadOnly}
              onSelect={() => void handleAddNote(note.id, "note")}
            >
              Add Note
            </DropdownMenuItem>
          </>
        ) : null}
        {note.kind === "note" ? (
          <DropdownMenuItem
            disabled={isReadOnly || exposeLoading || !syncEngine}
            onSelect={() => {
              if (isExposed) void handleUnexposeNote(note.id);
              else void handleExposeNote(note);
            }}
          >
            {isExposed ? (exposeLoading ? "Unpublishing…" : "Unpublish") : exposeLoading ? "Publishing…" : "Publish"}
          </DropdownMenuItem>
        ) : null}
        {note.kind === "note" && isTeamWorkspace ? (
          <DropdownMenuItem
            disabled={!canShare}
            onSelect={() => openShareDialog(note)}
          >
            Share
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={readOnly || note.ownerId !== currentUserId}
          onSelect={() => void onDeleteNote(note.id)}
        >
          Move to Trash
        </DropdownMenuItem>
      </DropdownMenuContent>
    );
  };

  const sidebarMenuContent: ReactNode = (
    <ContextMenuContent>
      <ContextMenuItem
        disabled={readOnly}
        onSelect={() => void handleAddNote(null, "section")}
      >
        New Section
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
        <div className="flex flex-col gap-1">
          {items.map((note) => {
            const children = byParent.get(note.id) ?? [];
            const isExpanded = expanded[note.id] ?? children.length > 0;

            return (
              <div key={note.id}>
                <TreeRow
                  note={note}
                  depth={depth}
                  isExpanded={isExpanded}
                  isSelected={selectedNoteId === note.id}
                  onSelect={() => selectNoteWithPrewarm(note.id)}
                  onToggleExpanded={() => toggleExpanded(note.id)}
                  onAddChild={() => void handleAddNote(note.id, "note")}
                  menu={renderNoteMenu(note)}
                  dropdownMenu={renderNoteDropdownMenu(note)}
                  readOnly={noteReadOnly(note)}
                  dragHint={resolveDragHint(note.id)}
                />
                {isExpanded ? (
                  renderBranch(note.id, depth + 1) ?? (
                    <div
                      className="px-2 py-1 text-sm font-semibold text-muted-foreground/70"
                      style={{ paddingLeft: (depth + 1) * 14 + 28 }}
                    >
                      No pages inside
                    </div>
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      </SortableContext>
    );
  };

  const renderSection = (section: NoteMeta) => {
    const isOpen = expanded[section.id] ?? true;
    return (
      <div key={section.id} className="flex flex-col gap-1">
        <SectionHeader
          section={section}
          isExpanded={isOpen}
          onToggleExpanded={() => toggleExpanded(section.id)}
          onAddChild={() => void handleAddNote(section.id, "note")}
          menu={renderNoteMenu(section)}
          dropdownMenu={renderNoteDropdownMenu(section)}
          readOnly={noteReadOnly(section)}
          dragHint={resolveDragHint(section.id)}
        />
        {isOpen ? (
          renderBranch(section.id, 1) ?? (
            <div className="px-2 py-1 text-sm font-semibold text-muted-foreground/70" style={{ paddingLeft: 42 }}>
              No pages inside
            </div>
          )
        ) : null}
      </div>
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
                className={`${SIDEBAR_SECTION_TITLE} group/section`}
                onClick={() => toggleSection("pinned")}
              >
                <SectionTitleContents
                  title="Pinned"
                  isExpanded={sectionsExpanded.pinned}
                />
              </button>
              {sectionsExpanded.pinned ? (
                <div className="flex flex-col gap-1">
                  {pinnedNotes.map((note) => (
                    <ShortcutRow
                      key={`pinned:${note.id}`}
                      note={note}
                      isSelected={selectedNoteId === note.id}
                      onSelect={() => selectNoteWithPrewarm(note.id)}
                      onAddChild={() => void handleAddNote(note.id, "note")}
                      menu={renderNoteMenu(note)}
                      dropdownMenu={renderNoteDropdownMenu(note)}
                      readOnly={noteReadOnly(note)}
                    />
                  ))}
                </div>
              ) : null}
            </section>
	          ) : null}

          {publishedNotes.length > 0 ? (
            <section className="flex flex-col gap-1">
              <button
                type="button"
                className={`${SIDEBAR_SECTION_TITLE} group/section`}
                onClick={() => toggleSection("published")}
              >
                <SectionTitleContents
                  title="Published"
                  isExpanded={sectionsExpanded.published}
                />
              </button>
              {sectionsExpanded.published ? (
                <div className="flex flex-col gap-1">
                  {publishedNotes.map((note) => (
                    <ShortcutRow
                      key={`published:${note.id}`}
                      note={note}
                      isSelected={selectedNoteId === note.id}
                      onSelect={() => selectNoteWithPrewarm(note.id)}
                      onAddChild={() => void handleAddNote(note.id, "note")}
                      menu={renderNoteMenu(note)}
                      dropdownMenu={renderNoteDropdownMenu(note)}
                      readOnly={noteReadOnly(note)}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {isTeamWorkspace && sharedNotes.length > 0 ? (
            <section className="flex flex-col gap-1">
              <button
                type="button"
                className={`${SIDEBAR_SECTION_TITLE} group/section`}
                onClick={() => toggleSection("shared")}
              >
                <SectionTitleContents
                  title="Shared"
                  isExpanded={sectionsExpanded.shared}
                />
              </button>
              {sectionsExpanded.shared ? (
                <div className="flex flex-col gap-1">
                  {sharedNotes.map((note) => (
                    <ShortcutRow
                      key={`shared:${note.id}`}
                      note={note}
                      isSelected={selectedNoteId === note.id}
                      onSelect={() => selectNoteWithPrewarm(note.id)}
                      onAddChild={() => void handleAddNote(note.id, "note")}
                      menu={renderNoteMenu(note)}
                      dropdownMenu={renderNoteDropdownMenu(note)}
                      readOnly={noteReadOnly(note)}
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
            {sectionNotes.length > 0 ? (
              <SortableContext
                items={sectionNotes.map((entry) => `note:${entry.id}`)}
                strategy={verticalListSortingStrategy}
              >
                <section className="flex flex-col gap-1">
                  {sectionNotes.map(renderSection)}
                </section>
              </SortableContext>
            ) : null}

            <section className="flex flex-col gap-1">
	              <button
	                type="button"
	                className={`${SIDEBAR_SECTION_TITLE} group/section`}
	                onClick={() => toggleSection("private")}
	              >
	                <SectionTitleContents
	                  title="Private"
	                  isExpanded={sectionsExpanded.private}
	                />
	              </button>
	              {sectionsExpanded.private ? (
                <div
                  ref={rootDrop.setNodeRef}
                  className={`flex min-h-6 flex-col gap-1 rounded-md transition-colors ${rootDrop.isOver ? "bg-accent/50" : ""}`}
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
              editable={!selectedReadOnly}
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
      readOnly={readOnly || selectedNote?.effectivePermission !== "edit"}
      onSelectNote={(id) => void selectNoteWithPrewarm(id)}
      onUpdateTags={onUpdateTags}
    />
  );

  return (
    <>
      <Dialog open={!!sharingNote} onOpenChange={(open) => !open && setSharingNote(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="size-4" aria-hidden="true" />
              Share note
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
              {(["private", "workspace", "selected"] as NoteShareScope[]).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  className={`rounded px-2 py-1.5 text-sm font-medium capitalize transition-colors ${
                    shareScopeDraft === scope ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setShareScopeDraft(scope)}
                >
                  {scope === "workspace" ? "Everyone" : scope}
                </button>
              ))}
            </div>

            {shareScopeDraft !== "private" ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-foreground">Permission</span>
                <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
                  {(["view", "edit"] as NoteSharePermission[]).map((permission) => (
                    <button
                      key={permission}
                      type="button"
                      className={`rounded px-3 py-1 text-sm font-medium capitalize transition-colors ${
                        sharePermissionDraft === permission ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => {
                        setSharePermissionDraft(permission);
                        setShareUsersDraft((current) => current.map((share) => ({ ...share, permission })));
                      }}
                    >
                      {permission}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {shareScopeDraft === "selected" ? (
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {teamMembers.map((member) => {
                  const checked = shareUsersDraft.some((share) => share.userId === member.id);
                  const permission = shareUsersDraft.find((share) => share.userId === member.id)?.permission ?? sharePermissionDraft;
                  return (
                    <div key={member.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
                      <input
                        type="checkbox"
                        className="size-4 accent-foreground"
                        checked={checked}
                        onChange={() => toggleShareUser(member.id)}
                        aria-label={`Share with ${member.name}`}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{member.name}</span>
                      <div className="grid grid-cols-2 gap-1 rounded bg-muted p-0.5">
                        {(["view", "edit"] as NoteSharePermission[]).map((item) => (
                          <button
                            key={item}
                            type="button"
                            className={`rounded px-2 py-0.5 text-xs font-medium capitalize transition-colors ${
                              checked && permission === item ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                            }`}
                            disabled={!checked}
                            onClick={() => setShareUserPermission(member.id, item)}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {teamMembers.length === 0 ? (
                  <div className="px-2 py-4 text-center text-sm text-muted-foreground">No teammates</div>
                ) : null}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSharingNote(null)} disabled={shareSaving}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveShareDialog()}
              disabled={shareSaving || (shareScopeDraft === "selected" && shareUsersDraft.length === 0)}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <FeaturePanelsShell
        feature="notes"
        left={leftSlot}
        center={centerSlot}
        right={rightSlot}
      />
    </>
  );
}
