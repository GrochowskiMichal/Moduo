/**
 * The sidebar footer and its sub-views (specs/notes-refresh.md NR-2 §Sidebar):
 * one quiet row, `Published (n) · Archive (n) · Trash (n)`; each opens in place
 * of the tree with a back arrow. Trash keeps its 30-day purge and "Delete
 * forever" (an AlertDialog); view-only members can look but not act.
 */

import { ArchiveRestore, ArrowLeft, FileText, Globe, RotateCcw, Trash2 } from "lucide-react";
import { type CSSProperties, type ReactNode, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { IconButton } from "@/components/ui/icon-button";
import { SELECTED_ROW } from "@/components/ui/selection";
import { cn } from "@/lib/utils";

import type { Note } from "../model";
import { trashDaysLeft } from "../model";
import type { SidebarSections } from "../sections";
import { displayTitle } from "../title";
import type { NoteTreeNode } from "../tree";

export type FooterView = "published" | "archive" | "trash";

const VIEW_TITLE: Record<FooterView, string> = {
  published: "Published",
  archive: "Archived",
  trash: "Recently deleted",
};

function countTree(nodes: NoteTreeNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countTree(n.children), 0);
}

export function footerCounts(footer: SidebarSections["footer"]): Record<FooterView, number> {
  return {
    published: footer.published.length,
    archive: countTree(footer.archive),
    trash: countTree(footer.trash),
  };
}

export function FooterSubView({
  view,
  footer,
  selectedId,
  canEdit,
  onBack,
  onOpen,
  onUnarchive,
  onTrash,
  onRestore,
  onPurge,
}: {
  view: FooterView;
  footer: SidebarSections["footer"];
  selectedId: string | null;
  canEdit: boolean;
  onBack: () => void;
  onOpen: (id: string) => void;
  onUnarchive: (id: string) => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
}) {
  const [purgeTarget, setPurgeTarget] = useState<Note | null>(null);
  const now = new Date();
  const nodes: NoteTreeNode[] =
    view === "published"
      ? footer.published.map((note) => ({ note, children: [] }))
      : view === "archive"
        ? footer.archive
        : footer.trash;

  const renderRows = (list: NoteTreeNode[], depth: number): ReactNode =>
    list.map(({ note, children }) => (
      <li key={note.id}>
        <div
          className={cn(
            "group/row flex h-(--row-h) min-w-0 items-center gap-1.5 rounded-md pr-1 font-sans text-sm",
            "ps-[calc(var(--spacing)*2+var(--tree-depth)*var(--tree-indent))]",
            selectedId === note.id
              ? `${SELECTED_ROW} text-foreground`
              : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
          )}
          style={{ "--tree-depth": depth } as CSSProperties}
        >
          <button
            type="button"
            onClick={() => onOpen(note.id)}
            className="flex h-full min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {view === "published" ? (
              <Globe aria-hidden className="size-icon-sm shrink-0" />
            ) : note.icon ? (
              <span className="w-icon shrink-0 text-center text-sm leading-none">{note.icon}</span>
            ) : (
              <FileText aria-hidden className="size-icon-sm shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">{displayTitle(note.title)}</span>
            {view === "trash" && note.deletedAt ? (
              <span
                className="shrink-0 text-xs text-subtle-foreground tabular-nums"
                title="Days until it is deleted for good"
              >
                {trashDaysLeft(note.deletedAt, now)} days left
              </span>
            ) : null}
          </button>
          {canEdit && depth === 0 && view === "archive" ? (
            <span className="flex shrink-0 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100">
              <IconButton
                icon={ArchiveRestore}
                label="Unarchive"
                onClick={() => onUnarchive(note.id)}
              />
              <IconButton icon={Trash2} label="Delete" onClick={() => onTrash(note.id)} />
            </span>
          ) : null}
          {canEdit && depth === 0 && view === "trash" ? (
            <span className="flex shrink-0 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100">
              <IconButton icon={RotateCcw} label="Restore" onClick={() => onRestore(note.id)} />
              <IconButton
                icon={Trash2}
                label="Delete forever"
                onClick={() => setPurgeTarget(note)}
              />
            </span>
          ) : null}
        </div>
        {children.length > 0 ? <ul>{renderRows(children, depth + 1)}</ul> : null}
      </li>
    ));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-1 pb-1">
        <IconButton icon={ArrowLeft} label="Back to notes" onClick={onBack} />
        <h3 className="font-display text-sm font-medium text-foreground">{VIEW_TITLE[view]}</h3>
      </div>
      {view === "trash" && nodes.length > 0 ? (
        <p className="px-3 pb-2 text-xs text-subtle-foreground">
          Deleted notes stay here for 30 days, then they’re gone for good.
        </p>
      ) : null}
      <div className="pane-scroll scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1">
        {nodes.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {view === "published"
              ? "Nothing is published."
              : view === "archive"
                ? "Nothing archived."
                : "Nothing deleted. Deleted notes stay here for 30 days."}
          </p>
        ) : (
          <ul aria-label={VIEW_TITLE[view]}>{renderRows(nodes, 0)}</ul>
        )}
      </div>
      <AlertDialog
        open={purgeTarget !== null}
        onOpenChange={(open) => !open && setPurgeTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete forever?</AlertDialogTitle>
            <AlertDialogDescription>
              “{displayTitle(purgeTarget?.title ?? "")}” and everything nested under it will be
              permanently deleted. Links to it will show a tombstone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (purgeTarget) onPurge(purgeTarget.id);
              }}
            >
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
