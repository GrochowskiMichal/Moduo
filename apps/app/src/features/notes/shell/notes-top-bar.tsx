/**
 * The Notes top bar (specs/notes-refresh.md NR-2, AC5): the breadcrumb, with
 * presence and the one sync signal when they have something to say. Every
 * note action is in the note's row menu; the panel opens from the bottom
 * bar (Mike, 2026-10-24).
 *
 * One sync signal: nothing while healthy, a muted dot that says why when not
 * ("Saved locally — will sync" for edits waiting, or a failed refresh).
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import type { NoteViewer } from "../sync/notes-realtime";
import { NotePresenceAvatars } from "../ui/note-presence-avatars";
import type { Crumb, CrumbSection } from "./breadcrumb";
import { NoteBreadcrumb } from "./note-breadcrumb";

export type NotesSignal = "unsynced" | "stale";

const SIGNAL_COPY: Record<NotesSignal, string> = {
  unsynced: "Saved locally — will sync",
  stale: "Couldn't refresh — showing what's on this device",
};

export function NotesTopBar({
  crumbs,
  viewers,
  signal,
  onOpenNote,
  onOpenSection,
}: {
  crumbs: Crumb[];
  viewers: NoteViewer[];
  /** The one sync signal: nothing while healthy. "unsynced" = edits wait on
   * this device; "stale" = the list couldn't be refreshed. */
  signal: NotesSignal | null;
  onOpenNote: (id: string) => void;
  onOpenSection: (section: CrumbSection) => void;
}) {
  return (
    <header className="flex h-(--bar-h) shrink-0 items-center gap-2 px-2">
      <NoteBreadcrumb crumbs={crumbs} onOpenNote={onOpenNote} onOpenSection={onOpenSection} />
      <div className="flex shrink-0 items-center gap-1.5">
        <NotePresenceAvatars viewers={viewers} />
        {signal ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="status"
                aria-label={SIGNAL_COPY[signal]}
                className="mx-1 size-2 rounded-full bg-muted-foreground/60"
              />
            </TooltipTrigger>
            <TooltipContent side="bottom">{SIGNAL_COPY[signal]}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </header>
  );
}
