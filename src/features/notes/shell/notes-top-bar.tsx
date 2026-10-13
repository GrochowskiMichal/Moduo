/**
 * The New Notes top bar (specs/notes-refresh.md NR-2, AC5): breadcrumb ·
 * presence · one sync signal · Share · `⋯` · right-panel toggle.
 *
 * One sync signal replaces classic's stack: nothing while healthy, a muted dot
 * with "Saved locally — will sync" when a push or a read failed.
 */

import { MoreHorizontal, PanelRight, PanelRightClose, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Note } from "../model";
import type { NoteViewer } from "../sync/notes-realtime";
import { NotePresenceAvatars } from "../ui/note-presence-avatars";
import type { Crumb, CrumbSection } from "./breadcrumb";
import { NoteBreadcrumb } from "./note-breadcrumb";
import { type RowAction, rowMenuItems } from "./row-menu";

export function NotesTopBar({
  crumbs,
  note,
  viewers,
  unsynced,
  canEdit,
  favorite,
  share,
  publish,
  panelOpen,
  onTogglePanel,
  onOpenNote,
  onOpenSection,
  onAction,
  onSwitchToClassic,
}: {
  crumbs: Crumb[];
  /** The open note, or null for a draft / nothing open (the menu hides). */
  note: Note | null;
  viewers: NoteViewer[];
  unsynced: boolean;
  canEdit: boolean;
  favorite: boolean;
  share: ReactNode;
  publish: ReactNode;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onOpenNote: (id: string) => void;
  onOpenSection: (section: CrumbSection) => void;
  onAction: (action: RowAction, note: Note) => void;
  onSwitchToClassic: () => void;
}) {
  const items = note && !note.deletedAt ? rowMenuItems({ canEdit, favorite }) : [];
  return (
    <header className="flex h-(--bar-h) shrink-0 items-center gap-2 px-2">
      <NoteBreadcrumb crumbs={crumbs} onOpenNote={onOpenNote} onOpenSection={onOpenSection} />
      <div className="flex shrink-0 items-center gap-1.5">
        <NotePresenceAvatars viewers={viewers} />
        {unsynced ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="status"
                aria-label="Saved locally — will sync"
                className="mx-1 size-2 rounded-full bg-muted-foreground/60"
              />
            </TooltipTrigger>
            <TooltipContent side="bottom">Saved locally — will sync</TooltipContent>
          </Tooltip>
        ) : null}
        {share}
        {publish}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton icon={MoreHorizontal} label="More" tooltip="More" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {note
              ? items.map((item, i) =>
                  item === "separator" ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: separators are positional
                    <DropdownMenuSeparator key={`sep-${i}`} />
                  ) : (
                    <DropdownMenuItem
                      key={item.action}
                      variant={item.destructive ? "destructive" : "default"}
                      onSelect={() => onAction(item.action, note)}
                    >
                      <item.icon aria-hidden />
                      {item.label}
                    </DropdownMenuItem>
                  ),
                )
              : null}
            {items.length > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem onSelect={onSwitchToClassic}>
              <Undo2 aria-hidden />
              Switch back to classic Notes
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton
          icon={panelOpen ? PanelRightClose : PanelRight}
          label={panelOpen ? "Hide panel" : "Show panel"}
          aria-pressed={panelOpen}
          onClick={onTogglePanel}
        />
      </div>
    </header>
  );
}
