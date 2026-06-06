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
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronRight } from "lucide-react";
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
} from "../../../components/ui/dropdown-menu";
import { NotesRightRail } from "./notes-right-rail";
import {
  MenuOpenEffect,
  SectionHeader,
  SectionTitleContents,
  ShortcutRow,
  SIDEBAR_SECTION_TITLE,
  TreeRow,
} from "./split-view/notes-sidebar";
import { NotesShareDialog } from "./split-view/notes-share-dialog";
import { buildNotesTreeModel } from "./split-view/notes-tree-model";
import { handleNoteDragEnd, resolveNoteDragHint } from "./split-view/notes-drag";

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

  const {
    activeNotes,
    listNotes,
    byParent,
    sectionNotes,
    pinnedNotes,
    publishedNotes,
    sharedNotes,
    teamMembers,
    isTeamWorkspace,
    notesById,
    selectedNote,
    selectedEditorNote,
    breadcrumbSegments,
  } = useMemo(
    () =>
      buildNotesTreeModel({
        notes,
        exposedSlugs,
        selectedNoteId,
        workspaceMembers,
        currentUserId,
      }),
    [currentUserId, exposedSlugs, notes, selectedNoteId, workspaceMembers]
  );
  const selectedReadOnly = readOnly || selectedEditorNote?.effectivePermission !== "edit";

  const noteReadOnly = (note: NoteMeta): boolean => readOnly || note.effectivePermission !== "edit";
  const canManageSharing = (note: NoteMeta): boolean =>
    !readOnly && isTeamWorkspace && note.kind === "note" && note.ownerId === currentUserId;

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

  const expandParent = (parentId: string | null) => {
    if (!parentId) return;
    setExpanded((current) => ({ ...current, [parentId]: true }));
  };

  const resetDragState = () => {
    setDragActiveId(null);
    setDragOverId(null);
    setDragDeltaX(0);
  };

  const resolveDragHint = (targetNoteId: string) =>
    resolveNoteDragHint({
      targetNoteId,
      dragActiveId,
      dragOverId,
      dragDeltaX,
      nestThresholdPx: NEST_THRESHOLD_PX,
      listNotes,
      sectionNotes,
      byParent,
      notesById,
    });

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
              void handleNoteDragEnd({
                event,
                readOnly,
                nestThresholdPx: NEST_THRESHOLD_PX,
                listNotes,
                sectionNotes,
                byParent,
                notesById,
                onMoveNote,
                expandParent,
              }).finally(resetDragState);
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
      <NotesShareDialog
        open={!!sharingNote}
        shareScope={shareScopeDraft}
        sharePermission={sharePermissionDraft}
        shareUsers={shareUsersDraft}
        teamMembers={teamMembers}
        saving={shareSaving}
        onOpenChange={(open) => !open && setSharingNote(null)}
        onShareScopeChange={setShareScopeDraft}
        onSharePermissionChange={setSharePermissionDraft}
        onShareUsersChange={setShareUsersDraft}
        onToggleUser={toggleShareUser}
        onSetUserPermission={setShareUserPermission}
        onSave={() => void saveShareDialog()}
      />
      <FeaturePanelsShell
        feature="notes"
        left={leftSlot}
        center={centerSlot}
        right={rightSlot}
      />
    </>
  );
}
