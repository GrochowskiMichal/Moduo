/**
 * The New Notes sidebar tree rows (specs/notes-refresh.md NR-2, AC2/AC4).
 *
 * Each row is a real `treeitem` (aria-level / aria-expanded / aria-selected,
 * roving tabindex owned by the sidebar). Selection is the R5 tint
 * (`SELECTED_ROW`), hover a dimmed state fill, never the same as selected.
 * `⋯` and right-click open the same menu. Rows are dragged with dnd-kit (the
 * page owns the DndContext) and dropped by raw pointer at release: each row
 * carries `data-drop-*` attributes the sidebar hit-tests.
 */

import { useDraggable } from "@dnd-kit/core";
import { ChevronRight, FileText, MoreHorizontal, Plus } from "lucide-react";
import type * as React from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { DRAG_SOURCE, DROP_TARGET, InsertionLine } from "@/components/ui/drag-visuals";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SELECTED_ROW } from "@/components/ui/selection";
import { entityDrag } from "@/lib/drag-payload";
import { cn } from "@/lib/utils";

import type { Note } from "../model";
import { displayTitle } from "../title";
import type { NoteTreeNode } from "../tree";
import type { SidebarSection } from "./drop-intent";
import { type RowAction, rowMenuItems } from "./row-menu";

export type RowHover = { key: string; zone: "before" | "after" | "into" } | null;

export type TreeCtx = {
  selectedId: string | null;
  focusedKey: string | null;
  draftId: string | null;
  canEdit: boolean;
  favoriteIds: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
  hover: RowHover;
  dragging: boolean;
  onToggle: (key: string) => void;
  onOpen: (id: string) => void;
  /** The pointer is on a row: start loading its note so the click paints. */
  onWarm?: (id: string) => void;
  /** The workspace has someone to share with. */
  canShare?: boolean;
  /** A popover the menu opened for this row (Share…, Publish…), anchored to it. */
  rowPopover?: (note: Note, rowKey: string) => React.ReactNode;
  onFocusRow: (key: string) => void;
  onCreateChild: (id: string) => void;
  onAction: (action: RowAction, note: Note, rowKey: string) => void;
};

export function rowKey(section: SidebarSection, id: string): string {
  return `${section}:${id}`;
}

export function TreeNodes({
  nodes,
  section,
  depth,
  ctx,
}: {
  nodes: NoteTreeNode[];
  section: SidebarSection;
  depth: number;
  ctx: TreeCtx;
}) {
  return (
    <>
      {nodes.map((node) => {
        const key = rowKey(section, node.note.id);
        const open = node.children.length > 0 && ctx.expanded.has(key);
        return (
          <div key={key} role="none">
            <TreeRow
              note={node.note}
              section={section}
              depth={depth}
              expandable={node.children.length > 0}
              expanded={open}
              ctx={ctx}
            />
            {open ? (
              <div role="group">
                <TreeNodes nodes={node.children} section={section} depth={depth + 1} ctx={ctx} />
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export function TreeRow({
  note,
  section,
  depth,
  expandable,
  expanded,
  ctx,
}: {
  note: Note;
  section: SidebarSection;
  depth: number;
  expandable: boolean;
  expanded: boolean;
  ctx: TreeCtx;
}) {
  const key = rowKey(section, note.id);
  const isDraft = note.id === ctx.draftId;
  const selected = ctx.selectedId === note.id;
  const hover = ctx.hover?.key === key ? ctx.hover : null;
  const favorite = ctx.favoriteIds.has(note.id);
  const items = isDraft
    ? []
    : rowMenuItems({
        canEdit: ctx.canEdit,
        favorite,
        section,
        hasChildren: expandable,
        fullWidth: note.fullWidth,
        canShare: ctx.canShare,
      });

  const row = (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={expandable ? expanded : undefined}
      aria-selected={selected}
      tabIndex={ctx.focusedKey === key ? 0 : -1}
      data-row-key={key}
      data-drop-row={isDraft ? undefined : key}
      onPointerEnter={isDraft ? undefined : () => ctx.onWarm?.(note.id)}
      data-drop-section={section}
      data-drop-id={note.id}
      data-drop-into={section === "favorites" ? undefined : "true"}
      onClick={() => {
        ctx.onFocusRow(key);
        ctx.onOpen(note.id);
      }}
      onFocus={(e) => {
        if (e.target === e.currentTarget) ctx.onFocusRow(key);
      }}
      className={cn(
        "group/row relative flex h-(--row-h) min-w-0 cursor-default items-center gap-1.5 rounded-md pr-1.5 font-sans text-sm outline-none select-none",
        "ps-[calc(var(--spacing)+var(--tree-depth)*var(--tree-indent))]",
        "transition-[color,background-color,box-shadow] duration-(--motion-fade) ease-(--ease-out)",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        selected && !hover
          ? `${SELECTED_ROW} text-foreground`
          : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
        hover?.zone === "into" && [DROP_TARGET, "text-foreground"],
      )}
      style={{ "--tree-depth": depth } as React.CSSProperties}
    >
      {hover && hover.zone !== "into" ? (
        // Starts at the row's depth, so the line shows the level it lands at.
        <span className="pointer-events-none absolute inset-y-0 end-0 start-[calc(var(--spacing)+var(--tree-depth)*var(--tree-indent))]">
          <InsertionLine edge={hover.zone === "before" ? "top" : "bottom"} />
        </span>
      ) : null}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden={!expandable}
        onClick={(e) => {
          e.stopPropagation();
          if (expandable) ctx.onToggle(key);
        }}
        className={cn(
          "hit-min flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-state-active hover:text-foreground",
          !expandable && "invisible",
        )}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "size-icon-xs transition-transform duration-(--motion-fade) ease-(--ease-out)",
            expanded && "rotate-90",
          )}
        />
        <span className="sr-only">{expanded ? "Collapse" : "Expand"}</span>
      </button>
      {ctx.rowPopover?.(note, key)}
      <span className="flex w-icon shrink-0 items-center justify-center">
        {note.icon ? (
          <span className="text-sm leading-none">{note.icon}</span>
        ) : (
          <FileText aria-hidden className="size-icon-sm" />
        )}
      </span>
      <span className={cn("min-w-0 flex-1 truncate", note.title.trim() === "" && "italic")}>
        {displayTitle(note.title)}
      </span>
      {!isDraft ? (
        <span
          className={cn(
            "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-(--motion-fade) ease-(--ease-out)",
            "group-hover/row:opacity-100 group-focus-within/row:opacity-100 has-[[aria-expanded=true]]:opacity-100",
            ctx.dragging && "invisible",
          )}
        >
          {ctx.canEdit && section !== "favorites" ? (
            <button
              type="button"
              tabIndex={-1}
              aria-label="New subpage"
              onClick={(e) => {
                e.stopPropagation();
                ctx.onCreateChild(note.id);
              }}
              className="hit-min flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-state-active hover:text-foreground"
            >
              <Plus aria-hidden className="size-icon-sm" />
            </button>
          ) : null}
          {items.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`${displayTitle(note.title)} options`}
                  onClick={(e) => e.stopPropagation()}
                  className="hit-min flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-state-active hover:text-foreground"
                >
                  <MoreHorizontal aria-hidden className="size-icon-sm" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-52"
                onCloseAutoFocus={keepFocusForPopover}
              >
                <MenuItems items={items} note={note} section={section} ctx={ctx} kit="dropdown" />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </span>
      ) : null}
    </div>
  );

  const withMenu =
    items.length > 0 ? (
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent className="w-52" onCloseAutoFocus={keepFocusForPopover}>
          <MenuItems items={items} note={note} section={section} ctx={ctx} kit="context" />
        </ContextMenuContent>
      </ContextMenu>
    ) : (
      row
    );

  if (!ctx.canEdit || isDraft) return withMenu;
  return (
    <DraggableRow note={note} dragKey={key}>
      {withMenu}
    </DraggableRow>
  );
}

/** The item picked opens a popover on the row (Share…, Publish…): the menu
 * must not hand focus back as it closes, or that closes the popover. */
let opensPopover = false;
function keepFocusForPopover(event: Event) {
  if (!opensPopover) return;
  opensPopover = false;
  event.preventDefault();
}

function MenuItems({
  items,
  note,
  section,
  ctx,
  kit,
}: {
  items: ReturnType<typeof rowMenuItems>;
  note: Note;
  section: SidebarSection;
  ctx: TreeCtx;
  kit: "dropdown" | "context";
}) {
  const Item = kit === "dropdown" ? DropdownMenuItem : ContextMenuItem;
  const Separator = kit === "dropdown" ? DropdownMenuSeparator : ContextMenuSeparator;
  return (
    <>
      {items.map((item, i) =>
        item === "separator" ? (
          // eslint-disable-next-line react/no-array-index-key -- separators are positional
          <Separator key={`sep-${i}`} />
        ) : (
          <Item
            key={item.action}
            variant={item.destructive ? "destructive" : "default"}
            onSelect={() => {
              opensPopover = item.action === "share" || item.action === "publish";
              ctx.onAction(item.action, note, rowKey(section, note.id));
            }}
          >
            <item.icon aria-hidden />
            {item.label}
          </Item>
        ),
      )}
    </>
  );
}

/** useDraggable only ever runs under the page's DndContext (never call it
 * conditionally inside one component). Listeners only: the row keeps its own
 * click and keyboard semantics. The CT-3 payload lets the editor and the
 * Detail hub take a dropped note as a chip or a link. */
function DraggableRow({
  note,
  dragKey,
  children,
}: {
  note: Note;
  dragKey: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: dragKey,
    data: entityDrag(
      { type: "note", id: note.id },
      { label: displayTitle(note.title), icon: note.icon, from: "notes-sidebar" },
    ),
  });
  return (
    <div ref={setNodeRef} {...listeners} className={cn(isDragging && DRAG_SOURCE)}>
      {children}
    </div>
  );
}
