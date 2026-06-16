import { useEffect, type ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, Database, File as FileIcon, Folder, Pin } from "lucide-react";
import type { NoteKind, NoteMeta } from "../types";
import { ContextMenu, ContextMenuTrigger } from "../../../components/ui/context-menu";

export function NoteKindIcon({ kind }: { kind: NoteKind }) {
  // text-current so the icon inherits the row colour and flips on hover / selection.
  const className = "size-3.5 shrink-0 text-current opacity-70";
  if (kind === "category") return <Database className={className} aria-hidden="true" />;
  if (kind === "folder") return <Folder className={className} aria-hidden="true" />;
  return <FileIcon className={className} aria-hidden="true" />;
}

export const SIDEBAR_ROW_BASE =
  "group/row relative flex w-full min-w-0 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring data-[selected=true]:bg-accent data-[selected=true]:text-foreground";
export const SIDEBAR_SECTION_TITLE =
  "flex w-full items-center justify-between gap-2 border-0 bg-transparent px-2 py-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";

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
  hasChildren: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onToggleExpanded: () => void;
  menu: ReactNode;
  dragHint?: "none" | "reorder" | "nest";
};

export function TreeRow({
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

export function ShortcutRow({ note, isSelected, onSelect, menu }: ShortcutRowProps) {
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

type CategorySectionHeaderProps = {
  category: NoteMeta;
  isExpanded: boolean;
  onToggle: () => void;
  menu: ReactNode;
  dragHint?: "none" | "reorder" | "nest";
};

export function CategorySectionHeader({
  category,
  isExpanded,
  onToggle,
  menu,
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
      className={`relative rounded-md ${drop.isOver || dragHint === "nest" ? "bg-accent/60" : ""}`}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            className={SIDEBAR_SECTION_TITLE}
            onClick={onToggle}
          >
            <span className="flex min-w-0 items-center gap-2">
              {isExpanded ? (
                <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
              )}
              <Database className="size-3 shrink-0" aria-hidden="true" />
              <span
                ref={sortable.setActivatorNodeRef}
                {...sortable.attributes}
                {...sortable.listeners}
                className="truncate"
              >
                {category.title || "Untitled Database"}
              </span>
            </span>
          </button>
        </ContextMenuTrigger>
        {menu}
      </ContextMenu>
    </div>
  );
}
