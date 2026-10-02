/**
 * Notes v2 sidebar (Wave-3 NO-3, AC2/AC12) — fixed sections
 * Pinned · Inbox · tree · Published · Archive · Trash, arbitrary-depth rows,
 * hover actions, drag to reorder/reparent (raw-pointer drop resolution — the
 * TL-2 lesson: targets are re-hit-tested at release, autoScroll off).
 * Tokens-only.
 */

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  useDndMonitor,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Copy,
  Download,
  FileText,
  FolderTree,
  Globe,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  Smile,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Eyebrow } from "@/components/ui/eyebrow";
import { IconButton } from "@/components/ui/icon-button";
import { Toolbar } from "@/components/ui/toolbar";
import { entityDrag } from "@/lib/drag-payload";
import { cn } from "@/lib/utils";
import type { Note } from "../model";
import { trashDaysLeft } from "../model";
import type { NoteSearchResult } from "../search";
import { displayTitle } from "../title";
import type { DropZone, NoteSections, NoteTreeNode } from "../tree";

const ICON_CHOICES = ["📝", "📒", "📌", "💡", "🗂️", "🎯", "🧠", "📚", "🛠️", "🧾", "🌱", "🎨"];

type HoverTarget = { id: string; zone: DropZone } | null;

type Props = {
  workspaceId: string;
  sections: NoteSections;
  selectedId: string | null;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onCreateRoot: () => void;
  onCreateChild: (parentId: string) => void;
  onDropRow: (dragId: string, targetId: string, zone: DropZone) => void;
  onTogglePin: (id: string) => void;
  onSetIcon: (id: string, icon: string | null) => void;
  onDuplicate: (id: string) => void;
  onArchive: (id: string, archived: boolean) => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
  /** Full-text search (NO-8, AC8) — the page wires this to the runtime; when
   * absent (e.g. stories), the search box is hidden. */
  onSearch?: (query: string) => Promise<NoteSearchResult[]>;
  /** Open the markdown import wizard (NO-8). */
  onImport?: () => void;
  /** Export a single note as `.md` / a note + its subtree as a `.zip` (NO-8). */
  onExportNote?: (id: string, title: string) => void;
  onExportTree?: (id: string, title: string) => void;
  /** "external" = the page owns the DndContext (NO-7b: so a note can be dragged
   * into the editor / onto the Detail hub); reorder binds via a monitor. Default
   * "internal" (own DndContext) keeps stories + standalone usage working. */
  dndMode?: "internal" | "external";
};

export function NoteTreeSidebar(props: Props) {
  const { workspaceId, sections, canEdit, onDropRow, onSearch, dndMode = "internal" } = props;
  const [expanded, setExpanded] = useState<Set<string>>(() => readExpanded(workspaceId));
  const [dragId, setDragId] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverTarget>(null);
  const [purgeTarget, setPurgeTarget] = useState<Note | null>(null);
  const pointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Full-text search (NO-8): debounced; when a query is present the results
  // replace the tree until it's cleared.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NoteSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const q = searchQuery.trim();
    if (!onSearch || !q) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      void onSearch(q)
        .then((res) => {
          if (active) {
            setSearchResults(res);
            setSearching(false);
          }
        })
        .catch(() => {
          if (active) {
            setSearchResults([]);
            setSearching(false);
          }
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery, onSearch]);

  const toggleExpand = useCallback(
    (id: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        writeExpanded(workspaceId, next);
        return next;
      });
    },
    [workspaceId],
  );

  // Raw pointer tracker while dragging — resolved at release, never from
  // stale move-time state (docs/gotchas.md, TL-2). Hover state only changes
  // on a (row, zone) boundary crossing, not per pixel.
  useEffect(() => {
    if (!dragId) return;
    const onMove = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
      const next = resolveHover(e.clientX, e.clientY);
      setHover((prev) => (prev?.id === next?.id && prev?.zone === next?.zone ? prev : next));
    };
    document.addEventListener("pointermove", onMove, { capture: true });
    return () => document.removeEventListener("pointermove", onMove, { capture: true });
  }, [dragId]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragStart = (e: DragStartEvent) => {
    setDragId(String(e.active.id));
  };

  const onDragEnd = (e: DragEndEvent) => {
    const id = String(e.active.id);
    setDragId(null);
    setHover(null);
    const { x, y } = pointerRef.current;
    const target = resolveHover(x, y);
    if (!target || target.id === id) return;
    onDropRow(id, target.id, target.zone);
  };

  const dragNote = useMemo(() => {
    if (!dragId) return null;
    return findNote(sections, dragId);
  }, [dragId, sections]);

  const rowCtx: RowCtx = {
    ...props,
    expanded,
    toggleExpand,
    hover,
    dragging: Boolean(dragId),
    requestPurge: setPurgeTarget,
  };

  const body = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <span className="font-display text-sm font-semibold text-foreground">Notes</span>
        {canEdit ? (
          <Toolbar aria-label="Notes controls" gap="tight">
            {props.onImport ? (
              <IconButton icon={Upload} label="Import notes" onClick={props.onImport} />
            ) : null}
            <IconButton icon={Plus} label="New note (⌘N)" onClick={props.onCreateRoot} />
          </Toolbar>
        ) : null}
      </div>
      {onSearch ? (
        <div className="px-3 pb-1.5">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notes…"
              aria-label="Search notes"
              className="w-full rounded-md bg-muted py-1.5 pl-7 pr-7 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {searchQuery.trim() ? (
          searching && searchResults.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">Searching…</p>
          ) : searchResults.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">No matches.</p>
          ) : (
            <ul className="space-y-0.5 pt-1">
              {searchResults.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => props.onSelect(r.id)}
                    className={cn(
                      "relative flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      r.id === props.selectedId ? "bg-(--selected-bg)" : "hover:bg-accent/60",
                    )}
                  >
                    {/* selected marker — the app-wide R5 recipe: quiet accent bar + tint */}
                    {r.id === props.selectedId ? (
                      <span
                        className="absolute inset-y-1 left-0.5 w-0.5 rounded-full bg-primary"
                        aria-hidden
                      />
                    ) : null}
                    <span className="flex w-full items-center gap-1.5">
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {displayTitle(r.title)}
                      </span>
                      {r.archived ? (
                        <span className="shrink-0 text-2xs text-muted-foreground">Archived</span>
                      ) : null}
                    </span>
                    {r.snippet ? (
                      <span className="line-clamp-2 pl-5 text-xs text-muted-foreground">
                        {r.snippet}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <>
            {sections.pinned.length > 0 ? (
              <Section title="Pinned">
                {sections.pinned.map((n) => (
                  <NoteRow
                    key={`pin-${n.id}`}
                    note={n}
                    depth={0}
                    childrenNodes={[]}
                    ctx={rowCtx}
                    variant="live"
                    flat
                  />
                ))}
              </Section>
            ) : null}

            <Section title="Inbox">
              {sections.inbox.length === 0 ? (
                <div className="px-2 py-1 text-xs text-muted-foreground">Nothing captured yet</div>
              ) : (
                sections.inbox.map((n) => (
                  <NoteRow
                    key={n.id}
                    note={n}
                    depth={0}
                    childrenNodes={[]}
                    ctx={rowCtx}
                    variant="live"
                  />
                ))
              )}
            </Section>

            {sections.tree.length > 0 ? (
              <Section title="Workspace">
                {sections.tree.map((t) => (
                  <TreeRows key={t.note.id} node={t} depth={0} ctx={rowCtx} variant="live" />
                ))}
              </Section>
            ) : null}

            {sections.published.length > 0 ? (
              <Section title="Published">
                {sections.published.map((n) => (
                  <button
                    key={`pub-${n.id}`}
                    type="button"
                    onClick={() => props.onSelect(n.id)}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Globe className="size-3.5 shrink-0" />
                    <span className="truncate">{displayTitle(n.title)}</span>
                  </button>
                ))}
              </Section>
            ) : null}

            {sections.archive.length > 0 ? (
              <Section title="Archive">
                {sections.archive.map((t) => (
                  <TreeRows key={t.note.id} node={t} depth={0} ctx={rowCtx} variant="archive" />
                ))}
              </Section>
            ) : null}

            {sections.trash.length > 0 ? (
              <Section title="Trash">
                {sections.trash.map((t) => (
                  <TreeRows key={t.note.id} node={t} depth={0} ctx={rowCtx} variant="trash" />
                ))}
              </Section>
            ) : null}
          </>
        )}
      </div>

      <Dialog open={purgeTarget !== null} onOpenChange={(open) => !open && setPurgeTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete forever?</DialogTitle>
            <DialogDescription>
              “{displayTitle(purgeTarget?.title ?? "")}” and everything nested under it will be
              permanently deleted. Links to it will show a tombstone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPurgeTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (purgeTarget) props.onPurge(purgeTarget.id);
                setPurgeTarget(null);
              }}
            >
              Delete forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  const onDragCancel = () => {
    setDragId(null);
    setHover(null);
  };

  // pointer-events-none is LOAD-BEARING: dnd-kit's overlay tracks the cursor, so
  // without it document.elementFromPoint always returns the overlay itself and
  // every drop resolves to nothing.
  const overlay = (
    <DragOverlay dropAnimation={null} style={{ pointerEvents: "none" }}>
      {dragNote ? (
        <div className="flex max-w-52 items-center gap-1.5 rounded-md border border-border bg-popover px-2 py-1 text-sm text-foreground shadow-md">
          <RowIcon note={dragNote} />
          <span className="truncate">{displayTitle(dragNote.title)}</span>
        </div>
      ) : null}
    </DragOverlay>
  );

  // View-only: no drag machinery in EITHER mode (rows are never draggable).
  if (!canEdit) return body;

  // External mode: the page provides the DndContext (a note can be dropped into
  // the editor or onto the Detail hub); we bind reorder via a monitor + keep our
  // own overlay. Reorder resolves by raw pointer at release, so it only fires
  // over a note row — editor/hub drops leave it a quiet no-op.
  if (dndMode === "external") {
    return (
      <SidebarDragMonitor
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        {body}
        {overlay}
      </SidebarDragMonitor>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      autoScroll={false}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      {body}
      {overlay}
    </DndContext>
  );
}

/** Binds the sidebar's reorder handlers to a DndContext the PAGE owns (NO-7b
 * external mode) via a monitor. Must render inside that context. */
function SidebarDragMonitor({
  onDragStart,
  onDragEnd,
  onDragCancel,
  children,
}: {
  onDragStart: (e: DragStartEvent) => void;
  onDragEnd: (e: DragEndEvent) => void;
  onDragCancel: () => void;
  children: React.ReactNode;
}) {
  useDndMonitor({ onDragStart, onDragEnd, onDragCancel });
  return <>{children}</>;
}

// ── rows ─────────────────────────────────────────────────────────────────────

type RowVariant = "live" | "archive" | "trash";

type RowCtx = Props & {
  expanded: Set<string>;
  toggleExpand: (id: string) => void;
  hover: HoverTarget;
  dragging: boolean;
  requestPurge: (note: Note) => void;
};

function TreeRows({
  node,
  depth,
  ctx,
  variant,
}: {
  node: NoteTreeNode;
  depth: number;
  ctx: RowCtx;
  variant: RowVariant;
}) {
  const isExpanded = ctx.expanded.has(node.note.id);
  return (
    <>
      <NoteRow
        note={node.note}
        depth={depth}
        childrenNodes={node.children}
        ctx={ctx}
        variant={variant}
      />
      {isExpanded
        ? node.children.map((c) => (
            <TreeRows key={c.note.id} node={c} depth={depth + 1} ctx={ctx} variant={variant} />
          ))
        : null}
    </>
  );
}

function RowIcon({ note }: { note: Note }) {
  if (note.icon) return <span className="w-4 text-center text-sm leading-none">{note.icon}</span>;
  return <FileText className="size-4 shrink-0 text-muted-foreground" />;
}

function NoteRow({
  note,
  depth,
  childrenNodes,
  ctx,
  variant,
  flat = false,
}: {
  note: Note;
  depth: number;
  childrenNodes: NoteTreeNode[];
  ctx: RowCtx;
  variant: RowVariant;
  flat?: boolean;
}) {
  const selected = ctx.selectedId === note.id;
  const hasChildren = childrenNodes.length > 0;
  const isExpanded = ctx.expanded.has(note.id);
  const hover = ctx.hover && ctx.hover.id === note.id ? ctx.hover : null;
  const droppable = variant === "live" && !flat;

  const inner = (
    <div
      data-note-row={droppable ? note.id : undefined}
      className={cn(
        "group relative flex items-center gap-1 rounded-md px-1.5 py-1 text-sm",
        // Drop-target indicators win over selection while a drag is live
        // (mirrors task-row's dropActive precedence) — otherwise the 2px
        // primary selection bar reads as a third drop mark.
        selected && !hover
          ? "bg-(--selected-bg) text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        selected && hover && "text-foreground",
        hover?.zone === "into" && "ring-2 ring-primary/60",
      )}
      style={{ paddingLeft: `${8 + (flat ? 0 : depth) * 14}px` }}
    >
      {/* selected marker — the app-wide R5 recipe: quiet accent bar + tint */}
      {selected && !hover ? (
        <span className="absolute inset-y-1 left-0.5 w-0.5 rounded-full bg-primary" aria-hidden />
      ) : null}
      {hover?.zone === "before" ? (
        <div className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded-full bg-primary" />
      ) : null}
      {hover?.zone === "after" ? (
        <div className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-primary" />
      ) : null}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          ctx.toggleExpand(note.id);
        }}
        tabIndex={hasChildren ? 0 : -1}
        aria-label={isExpanded ? "Collapse" : "Expand"}
        className={cn(
          "rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          hasChildren && !flat ? "visible" : "invisible",
        )}
      >
        <ChevronRight
          className={cn(
            "size-3.5 transition-transform motion-reduce:transition-none",
            isExpanded && "rotate-90",
          )}
        />
      </button>

      <button
        type="button"
        onClick={() => ctx.onSelect(note.id)}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        <RowIcon note={note} />
        <span
          className={cn("truncate", note.title.trim() === "" && "italic text-muted-foreground")}
        >
          {displayTitle(note.title)}
        </span>
        {note.isPinned && !flat ? <Pin className="size-3 shrink-0 text-muted-foreground" /> : null}
      </button>

      {variant === "trash" ? (
        <span className="hidden shrink-0 text-xs text-muted-foreground group-hover:inline">
          {note.deletedAt ? `${trashDaysLeft(note.deletedAt, new Date())}d` : ""}
        </span>
      ) : null}

      {ctx.canEdit ? (
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none",
            ctx.dragging && "opacity-0",
          )}
        >
          {variant === "live" ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                ctx.onCreateChild(note.id);
              }}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="New child note"
              title="New child note"
            >
              <Plus className="size-3.5" />
            </button>
          ) : null}
          <RowMenu note={note} ctx={ctx} variant={variant} />
        </div>
      ) : null}
    </div>
  );

  if (ctx.canEdit && variant === "live") {
    return <DraggableRow note={note}>{inner}</DraggableRow>;
  }
  return inner;
}

/** Wrapper so useDraggable only ever runs under the DndContext (gotchas.md —
 * never call it conditionally inside one component). Listeners only: the row
 * keeps its own click/keyboard semantics, no extra tab stop.
 *
 * `id` stays the bare note id (reorder reads `active.id`); the CT-3 `data`
 * payload (NO-7b) is what the editor/hub drop targets read to insert a chip /
 * create a link. The two coexist — reorder and link-drop are spatially disjoint. */
function DraggableRow({ note, children }: { note: Note; children: React.ReactNode }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: note.id,
    data: entityDrag(
      { type: "note", id: note.id },
      { label: displayTitle(note.title), icon: note.icon, from: "notes-sidebar" },
    ),
  });
  return (
    <div ref={setNodeRef} {...listeners} className={cn("cursor-grab", isDragging && "opacity-50")}>
      {children}
    </div>
  );
}

function RowMenu({ note, ctx, variant }: { note: Note; ctx: RowCtx; variant: RowVariant }) {
  if (variant === "trash") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Note actions"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem onSelect={() => ctx.onRestore(note.id)}>
            <RotateCcw className="size-4" /> Restore
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => ctx.requestPurge(note)}
          >
            <Trash2 className="size-4" /> Delete forever
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Note actions"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Smile className="size-4" /> Icon
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            <div className="grid grid-cols-6 gap-1 p-1">
              {ICON_CHOICES.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => ctx.onSetIcon(note.id, emoji)}
                  className="rounded p-1 text-base hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {emoji}
                </button>
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => ctx.onSetIcon(note.id, null)}>
              <X className="size-4" /> Remove icon
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={() => ctx.onTogglePin(note.id)}>
          {note.isPinned ? (
            <>
              <PinOff className="size-4" /> Unpin
            </>
          ) : (
            <>
              <Pin className="size-4" /> Pin
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void ctx.onDuplicate(note.id)}>
          <Copy className="size-4" /> Duplicate
        </DropdownMenuItem>
        {ctx.onExportNote ? (
          <DropdownMenuItem onSelect={() => ctx.onExportNote!(note.id, note.title)}>
            <Download className="size-4" /> Export as Markdown
          </DropdownMenuItem>
        ) : null}
        {ctx.onExportTree ? (
          <DropdownMenuItem onSelect={() => ctx.onExportTree!(note.id, note.title)}>
            <FolderTree className="size-4" /> Export subtree as .zip
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        {variant === "archive" || note.isArchived ? (
          <DropdownMenuItem onSelect={() => ctx.onArchive(note.id, false)}>
            <ArchiveRestore className="size-4" /> Unarchive
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => ctx.onArchive(note.id, true)}>
            <Archive className="size-4" /> Archive
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => ctx.onTrash(note.id)}
        >
          <Trash2 className="size-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 first:mt-1">
      <Eyebrow as="div" className="px-2 pb-1">
        {title}
      </Eyebrow>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  );
}

// ── drop resolution (shared by move + end) ──────────────────────────────────

function resolveHover(x: number, y: number): HoverTarget {
  const el = document.elementFromPoint(x, y)?.closest?.("[data-note-row]") as HTMLElement | null;
  if (!el) return null;
  const id = el.getAttribute("data-note-row");
  if (!id) return null;
  const rect = el.getBoundingClientRect();
  const quarter = rect.height / 4;
  const zone: DropZone =
    y < rect.top + quarter ? "before" : y > rect.bottom - quarter ? "after" : "into";
  return { id, zone };
}

// ── expansion persistence ────────────────────────────────────────────────────

function expandKey(workspaceId: string): string {
  return `moduo:notes:expanded:v1:${workspaceId}`;
}

function readExpanded(workspaceId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(expandKey(workspaceId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function writeExpanded(workspaceId: string, expanded: Set<string>) {
  try {
    window.localStorage.setItem(expandKey(workspaceId), JSON.stringify([...expanded]));
  } catch {
    // ignore
  }
}

function findNote(sections: NoteSections, id: string): Note | null {
  const inTree = (nodes: NoteTreeNode[]): Note | null => {
    for (const n of nodes) {
      if (n.note.id === id) return n.note;
      const hit = inTree(n.children);
      if (hit) return hit;
    }
    return null;
  };
  return (
    sections.pinned.find((n) => n.id === id) ??
    sections.inbox.find((n) => n.id === id) ??
    inTree(sections.tree) ??
    inTree(sections.archive) ??
    inTree(sections.trash)
  );
}
