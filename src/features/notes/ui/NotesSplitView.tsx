import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { NoteKind, NoteMeta, NotesSyncStatus } from "../types";
import type { NotesSyncEngine } from "../sync/sync-engine";
import { LexicalNoteEditor } from "../editor/LexicalNoteEditor";
import {
  NOTES_CREATE_KIND_EVENT,
  NOTES_FOCUS_SEARCH_EVENT,
  NOTES_TOGGLE_SIDEBAR_EVENT,
  type NotesCreateKindEventDetail,
} from "./layout-events";

type Props = {
  notes: NoteMeta[];
  selectedNoteId: string | null;
  onSelectNote: (id: string) => void;
  onCreateNote: (parentId?: string | null, kind?: NoteKind) => Promise<string | null>;
  onMoveNote: (noteId: string, parentId: string | null, beforeId?: string | null) => Promise<void>;
  onUpdateTitle: (noteId: string, title: string) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onDuplicateNote: (noteId: string) => Promise<string | null>;
  onTogglePin: (noteId: string, isPinned: boolean) => Promise<void>;
  syncStatus: NotesSyncStatus;
  syncEngine: NotesSyncEngine;
};

type ContextMenuState =
  | { type: "note"; noteId: string; top: number; left: number }
  | { type: "sidebar"; top: number; left: number };

function statusLabel(status: NotesSyncStatus): string {
  switch (status) {
    case "offline":
      return "Offline";
    case "syncing":
      return "Syncing";
    case "error":
      return "Sync Error";
    default:
      return "Synced";
  }
}

function syncPillClass(status: NotesSyncStatus): string {
  if (status === "syncing") return "border-[#335b8f] text-[#99c5ff]";
  if (status === "error") return "border-[#8f3333] text-[#ffc5c5]";
  if (status === "offline") return "border-[#5f6272] text-[#b8bccd]";
  return "border-[#26334a] text-[#8e9cb6]";
}

function kindIcon(kind: NoteKind): string {
  if (kind === "category") return "▣";
  if (kind === "folder") return "▢";
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
        className={`notes-tree-row grid min-h-8 grid-cols-[18px_1fr_20px] items-center gap-[10px] rounded-[10px] px-[6px] py-1 text-[#a9b4c9] ${isSelected ? "bg-[#171f2d] text-[#eff3ff]" : ""}`}
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
          className={`grid h-4 w-4 place-items-center border-0 bg-transparent text-[11px] text-[#4b556b] ${hasChildren ? "" : "pointer-events-none opacity-0"}`}
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
      className={`notes-tree-row grid min-h-8 grid-cols-[16px_1fr] items-center gap-[10px] rounded-[10px] px-[6px] py-1 text-[#a9b4c9] ${isSelected ? "bg-[#171f2d] text-[#eff3ff]" : ""}`}
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
};

function CategorySectionHeader({ category, isExpanded, onToggle, onContextMenu }: CategorySectionHeaderProps) {
  const drop = useDroppable({ id: `inside:${category.id}` });

  return (
    <div
      ref={drop.setNodeRef}
      className={`rounded-[10px] ${drop.isOver ? "bg-[#15243b]" : ""}`}
      onContextMenu={(event) => {
        event.stopPropagation();
        onContextMenu(event);
      }}
    >
      <button
        type="button"
        className="notes-section-header flex w-full items-center justify-between border-0 bg-transparent px-[6px] py-[2px] text-[12px] tracking-[0.03em] text-[#8b94a7]"
        onClick={onToggle}
      >
        <span>{category.title || "Untitled Section"}</span>
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
  onDeleteNote,
  onDuplicateNote,
  onTogglePin,
  syncStatus,
  syncEngine,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [categoryExpanded, setCategoryExpanded] = useState<Record<string, boolean>>({});
  const [sectionsExpanded, setSectionsExpanded] = useState({ pinned: true, notes: true });
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onToggleSidebar = () => {
      setSidebarVisible((current) => !current);
    };

    const onFocusSearch = () => {
      setSidebarVisible(true);
    };

    const onCreateKind = async (event: Event) => {
      const detail = (event as CustomEvent<NotesCreateKindEventDetail>).detail;
      const kind = detail?.kind ?? "note";
      const createdId = await onCreateNote(null, kind);
      if (createdId) {
        if (kind !== "category") onSelectNote(createdId);
        setSidebarVisible(true);
      }
    };

    window.addEventListener(NOTES_TOGGLE_SIDEBAR_EVENT, onToggleSidebar);
    window.addEventListener(NOTES_FOCUS_SEARCH_EVENT, onFocusSearch);
    window.addEventListener(NOTES_CREATE_KIND_EVENT, onCreateKind);

    return () => {
      window.removeEventListener(NOTES_TOGGLE_SIDEBAR_EVENT, onToggleSidebar);
      window.removeEventListener(NOTES_FOCUS_SEARCH_EVENT, onFocusSearch);
      window.removeEventListener(NOTES_CREATE_KIND_EVENT, onCreateKind);
    };
  }, [onCreateNote, onSelectNote]);

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
        .filter((note) => note.kind === "category")
        .sort(
          (a, b) =>
            (a.parentId ?? "").localeCompare(b.parentId ?? "") ||
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

  const handleDragEnd = async (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;

    if (!overId || !activeId.startsWith("note:")) return;

    const movingNoteId = activeId.replace("note:", "");
    if (overId === activeId) return;

    if (overId.startsWith("inside:")) {
      const targetParentId = overId.replace("inside:", "");
      if (targetParentId === movingNoteId) return;
      await onMoveNote(movingNoteId, targetParentId, null);
      return;
    }

    if (overId.startsWith("note:")) {
      const targetNoteId = overId.replace("note:", "");
      const target = listNotes.find((note) => note.id === targetNoteId);
      if (!target) return;

      // Dragging to the right nests the item into the target row.
      if ((event.delta?.x ?? 0) > 24) {
        await onMoveNote(movingNoteId, target.id, null);
        setExpanded((current) => ({ ...current, [target.id]: true }));
        return;
      }

      await onMoveNote(movingNoteId, target.parentId, target.id);
    }
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
    event.preventDefault();
    const position = getMenuPosition(event, 280, 270);
    setContextMenu({ type: "note", noteId, ...position });
  };

  const openSidebarContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    const target = event.target as HTMLElement;
    if (target.closest(".notes-tree-row, .notes-section-header, .notes-context-menu")) return;
    const position = getMenuPosition(event, 240, 170);
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
                onSelect={() => onSelectNote(note.id)}
                onToggleExpanded={() => toggleExpanded(note.id)}
                onContextMenu={(event) => openContextMenu(note.id, event)}
              />
              {isExpanded ? renderBranch(note.id, depth + 1) : null}
            </div>
          );
        })}
      </SortableContext>
    );
  };

  return (
    <div
      className={`grid h-full min-h-0 overflow-hidden bg-[#050608] p-3 ${sidebarVisible ? "grid-cols-[320px_minmax(0,1fr)] gap-3" : "grid-cols-[0_minmax(0,1fr)] gap-0"}`}
    >
      <aside
        className={
          sidebarVisible
            ? "min-h-0 overflow-x-hidden overflow-y-auto rounded-[14px] bg-[#111111] p-3"
            : "min-h-0 overflow-hidden rounded-none border-0 p-0"
        }
        onContextMenu={openSidebarContextMenu}
      >
        <div className="mb-[10px] grid gap-[6px]">
          <button
            type="button"
            className="notes-section-header flex w-full items-center justify-between border-0 bg-transparent px-[6px] py-[2px] text-[12px] tracking-[0.03em] text-[#8b94a7]"
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
                    onSelect={() => onSelectNote(note.id)}
                    onContextMenu={(event) => openContextMenu(note.id, event)}
                  />
                ))}
              </div>
            ) : (
              <div className="px-2 pb-[6px] pt-[2px] text-[13px] text-[#68758d]">No pinned notes</div>
            )
          ) : null}
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          {categorySections.map((category) => {
            const isOpen = categoryExpanded[category.id] ?? true;
            return (
              <div key={category.id} className="mb-[10px] grid gap-[6px]">
                <CategorySectionHeader
                  category={category}
                  isExpanded={isOpen}
                  onToggle={() => toggleCategorySection(category.id)}
                  onContextMenu={(event) => openContextMenu(category.id, event)}
                />
                {isOpen ? <div className="grid gap-[3px]">{renderBranch(category.id, 1)}</div> : null}
              </div>
            );
          })}

          <div className="mb-[10px] grid gap-[6px]">
            <button
              type="button"
              className="notes-section-header flex w-full items-center justify-between border-0 bg-transparent px-[6px] py-[2px] text-[12px] tracking-[0.03em] text-[#8b94a7]"
              onClick={() => toggleSection("notes")}
            >
              <span>Notes</span>
              <span>{sectionsExpanded.notes ? "▾" : "▸"}</span>
            </button>

            {sectionsExpanded.notes ? <div className="grid gap-[3px]">{renderBranch(null, 0)}</div> : null}
          </div>
        </DndContext>
      </aside>

      <main className="grid min-h-0 min-w-0 grid-rows-[48px_1fr] overflow-hidden rounded-[14px] bg-[#111111]">
        <div className="flex items-center justify-between gap-[14px] px-[14px]">
          <div className="truncate whitespace-nowrap text-[13px] text-[#66738c]" title={breadcrumb}>
            {breadcrumb}
          </div>
          <span className={`inline-flex rounded-full border px-[10px] py-1 text-[12px] ${syncPillClass(syncStatus)}`}>
            {statusLabel(syncStatus)}
          </span>
        </div>

        {selectedEditorNote ? (
          <LexicalNoteEditor
            noteId={selectedEditorNote.id}
            title={selectedEditorNote.title}
            onTitleChange={(value) => {
              void onUpdateTitle(selectedEditorNote.id, value);
            }}
            syncEngine={syncEngine}
          />
        ) : (
          <div className="grid place-content-center gap-[6px] text-[#95a2bd]">
            <h3>No note selected</h3>
            <p>Use the bottom + menu to create section, folder, or note.</p>
          </div>
        )}
      </main>

      {contextMenu?.type === "note" && contextTarget ? (
        <div
          ref={contextMenuRef}
          className="notes-context-menu fixed z-[1100] grid min-w-[260px] gap-[2px] rounded-[12px] border border-[#2a3346] bg-[#10151f] p-[6px] shadow-[0_14px_30px_#00000066]"
          style={{ top: contextMenu.top, left: contextMenu.left }}
        >
          {!contextTargetIsSection ? (
            <button
              type="button"
              className="notes-context-item flex w-full items-center justify-between rounded-[8px] border-0 bg-transparent px-[10px] py-[9px] text-[#dbe1f0] hover:bg-[#1a2438]"
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
            className="notes-context-item flex w-full items-center justify-between rounded-[8px] border-0 bg-transparent px-[10px] py-[9px] text-[#dbe1f0] hover:bg-[#1a2438]"
            onClick={() => {
              runContextAction(async () => {
                const created = await onCreateNote(contextTarget.id, "note");
                if (created) onSelectNote(created);
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
            className="notes-context-item flex w-full items-center justify-between rounded-[8px] border-0 bg-transparent px-[10px] py-[9px] text-[#dbe1f0] hover:bg-[#1a2438]"
            onClick={() => {
              runContextAction(async () => {
                const created = await onCreateNote(contextTarget.id, "folder");
                if (created) onSelectNote(created);
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
            className="notes-context-item flex w-full items-center justify-between rounded-[8px] border-0 bg-transparent px-[10px] py-[9px] text-[#dbe1f0] hover:bg-[#1a2438]"
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
              className="notes-context-item flex w-full items-center justify-between rounded-[8px] border-0 bg-transparent px-[10px] py-[9px] text-[#dbe1f0] hover:bg-[#1a2438]"
              onClick={() => {
                runContextAction(async () => {
                  const created = await onDuplicateNote(contextTarget.id);
                  if (created && contextTarget.kind !== "category") onSelectNote(created);
                });
              }}
            >
              <span>Duplicate</span>
            </button>
          ) : null}
          <button
            type="button"
            className="notes-context-item flex w-full items-center justify-between rounded-[8px] border-0 bg-transparent px-[10px] py-[9px] text-[#ffb4b4] hover:bg-[#341c27]"
            onClick={() => {
              runContextAction(async () => {
                await onDeleteNote(contextTarget.id);
              });
            }}
          >
            <span>Delete</span>
          </button>
          <span className="px-[10px] pb-[2px] pt-1 text-[12px] text-[#7f8ba2]">
            {contextTarget.kind === "category" ? "Section" : contextTarget.kind === "folder" ? "Folder" : "Note"}
          </span>
        </div>
      ) : null}

      {contextMenu?.type === "sidebar" ? (
        <div
          ref={contextMenuRef}
          className="notes-context-menu fixed z-[1100] grid min-w-[260px] gap-[2px] rounded-[12px] border border-[#2a3346] bg-[#10151f] p-[6px] shadow-[0_14px_30px_#00000066]"
          style={{ top: contextMenu.top, left: contextMenu.left }}
        >
          <button
            type="button"
            className="notes-context-item flex w-full items-center justify-between rounded-[8px] border-0 bg-transparent px-[10px] py-[9px] text-[#dbe1f0] hover:bg-[#1a2438]"
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
            className="notes-context-item flex w-full items-center justify-between rounded-[8px] border-0 bg-transparent px-[10px] py-[9px] text-[#dbe1f0] hover:bg-[#1a2438]"
            onClick={() => {
              runContextAction(async () => {
                const created = await onCreateNote(null, "folder");
                if (created) onSelectNote(created);
              });
            }}
          >
            <span>New Folder</span>
          </button>
          <button
            type="button"
            className="notes-context-item flex w-full items-center justify-between rounded-[8px] border-0 bg-transparent px-[10px] py-[9px] text-[#dbe1f0] hover:bg-[#1a2438]"
            onClick={() => {
              runContextAction(async () => {
                const created = await onCreateNote(null, "note");
                if (created) onSelectNote(created);
              });
            }}
          >
            <span>New Note</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
