/**
 * The "Notes" right-panel rail variant (NO-7b, AC8) — mounted by Contacts and
 * Calendar for the focused entity. Lists the notes linked to that entity and
 * offers "New linked note": create an Inbox note (`notesV2.create`) and link it
 * back with `references` (`spine.createLink`). Reuses the spine hub read, so it
 * costs one indexed `entity_links` query + one batched registry lookup.
 *
 * Runtime-parameterized + self-contained so both modules mount it identically;
 * the pure selection/link-arg logic lives in ../linked-notes.ts (tested).
 */

import { useMemo, useState } from "react";
import { FileText, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/eyebrow";
import type { EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { useEntityHub } from "@/features/spine/hooks/use-entity-hub";
import { newLinkedNoteLinkArgs, selectLinkedNotes } from "../linked-notes";

type Props = {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  /** The entity whose linked notes are shown; null → the "select something" state. */
  focus: EntityRef | null;
  /** Label/icon seeds so the created link's registry projection paints the source. */
  focusLabel?: string;
  focusIcon?: string | null;
  canEdit: boolean;
  /** Open a note (deep-link out to /notes). Fired on a row click. */
  onOpenNote: (noteId: string) => void;
  /** Optional: let the host refresh its own hub after a link lands (keeps the
   * center hub in sync with the rail). */
  onLinked?: () => void;
};

/** A short emoji icon renders as-is; a lucide-style name (or nothing) → FileText. */
function isEmojiIcon(icon: string | null): boolean {
  return !!icon && !/^[a-z0-9-]+$/i.test(icon);
}

export function LinkedNotesPanel({
  runtime,
  workspaceId,
  focus,
  focusLabel,
  focusIcon,
  canEdit,
  onOpenNote,
  onLinked,
}: Props) {
  const { status, sections, reload } = useEntityHub(runtime, workspaceId, focus);
  const rows = useMemo(() => selectLinkedNotes(sections), [sections]);
  const [creating, setCreating] = useState(false);

  async function newLinkedNote() {
    if (!runtime || !workspaceId || !focus || creating) return;
    setCreating(true);
    try {
      // Inbox note (no parent) with an empty first-line title — the user names it
      // by typing once it opens.
      const note = await runtime.notesV2.create({ workspaceId });
      const args = newLinkedNoteLinkArgs(focus, note);
      await runtime.spine.createLink({
        workspaceId,
        ...args,
        sourceLabel: focusLabel,
        sourceIcon: focusIcon ?? null,
      });
      // Refresh in place — the new note appears in the rail. We deliberately
      // don't navigate to /notes: it'd yank the user off the contact/event, and
      // the just-created note races that page's cached bundle load. They open it
      // from the rail (or /notes) when ready.
      reload();
      onLinked?.();
      toast("Note created and linked", { description: "Find it in this rail or in Notes." });
    } catch (err) {
      toast.error("Couldn't create the note", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setCreating(false);
    }
  }

  if (!focus) {
    return (
      <div className="grid h-full place-content-center px-3 text-center">
        <span className="text-sm text-muted-foreground">
          Select something to see its notes.
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <Eyebrow>Notes</Eyebrow>
        {canEdit ? (
          <button
            type="button"
            onClick={() => void newLinkedNote()}
            disabled={creating}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            New linked note
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {status === "loading" ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : status === "error" ? (
          <div className="grid place-content-center gap-2 px-2 py-6 text-center">
            <p className="text-sm text-muted-foreground">Couldn't load linked notes.</p>
            <button
              type="button"
              onClick={reload}
              className="justify-self-center rounded-md bg-secondary px-2.5 py-1 text-xs text-secondary-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            No linked notes yet.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {rows.map((r) => (
              <li key={r.noteId}>
                <button
                  type="button"
                  disabled={r.tombstoned}
                  onClick={() => onOpenNote(r.noteId)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    r.tombstoned
                      ? "cursor-default text-muted-foreground/60"
                      : "text-foreground hover:bg-accent",
                  )}
                >
                  {isEmojiIcon(r.icon) ? (
                    <span className="w-4 shrink-0 text-center text-sm leading-none">{r.icon}</span>
                  ) : (
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className={cn("min-w-0 flex-1 truncate", r.tombstoned && "line-through")}>
                    {r.title}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
