import type { HTMLAttributes, ReactNode, RefCallback } from "react";
import { useEffect } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import type { NoteKind, NoteMeta } from "../../types";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "../../../../components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "../../../../components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../components/ui/tooltip";

export type DragHint = "none" | "reorder" | "nest";

export const SIDEBAR_ROW_BASE =
  "group/row relative flex w-full min-w-0 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring data-[selected=true]:bg-accent data-[selected=true]:text-foreground";
export const SIDEBAR_SECTION_TITLE =
  "flex w-full items-center justify-between gap-2 border-0 bg-transparent px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";

function NoteKindIcon({ kind: _kind }: { kind: NoteKind }) {
  const className = "size-3.5 shrink-0 text-current opacity-70";
  return <FileIcon className={className} aria-hidden="true" />;
}

export function SectionTitleContents({
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

export function MenuOpenEffect({ onMount }: { onMount: () => void }) {
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
  dragHint?: DragHint;
};

export function TreeRow({
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
            <RowActions dropdownMenu={dropdownMenu} readOnly={readOnly} onAddChild={onAddChild} />
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

export function ShortcutRow({ note, isSelected, onSelect, onAddChild, menu, dropdownMenu, readOnly }: ShortcutRowProps) {
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
          <RowActions dropdownMenu={dropdownMenu} readOnly={readOnly} onAddChild={onAddChild} />
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
  dragHint?: DragHint;
};

export function SectionHeader({
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
            <RowActions dropdownMenu={dropdownMenu} readOnly={readOnly} onAddChild={onAddChild} variant="section" />
          </div>
        </ContextMenuTrigger>
        {menu}
      </ContextMenu>
    </div>
  );
}

function RowActions({
  dropdownMenu,
  readOnly,
  onAddChild,
  variant = "row",
}: {
  dropdownMenu: ReactNode;
  readOnly: boolean;
  onAddChild: () => void;
  variant?: "row" | "section";
}) {
  const groupClass =
    variant === "section"
      ? "ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/section:opacity-100 group-focus-within/section:opacity-100"
      : "ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100";

  return (
    <div className={groupClass}>
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
  );
}
