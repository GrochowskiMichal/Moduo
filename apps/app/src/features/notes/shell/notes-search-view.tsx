/**
 * Notes' own search (DESIGN_BRIEF §2a; specs/notes-refresh.md "until NR-10 the
 * sidebar keeps its full-text search"): it takes the tree's place, like the
 * footer views, and opens from the sidebar's search row or the bottom bar's
 * Search while Notes is open.
 *
 * Titles match at once from this device; what notes say comes from the
 * server's full-text index a beat later, each hit with the line it was found
 * in. A failed text search says so and keeps the title matches.
 */

import { ArrowLeft, FileText } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { SELECTED_ROW } from "@/components/ui/selection";
import { cn } from "@/lib/utils";

import { bodyOnlyHits, bodySnippet, findByTitle, queryWords, type SnippetParts } from "../find";
import type { Note } from "../model";
import { displayTitle } from "../title";

/** What the server's text search returns (runtime.notesV2.search). */
export type NoteTextHit = {
  id: string;
  title: string;
  bodyText: string;
  isArchived: boolean;
  deletedAt: string | null;
};

const DEBOUNCE_MS = 200;

/** The server's last answer, for the words it answered. Searching is derived:
 * the words typed aren't the words answered yet. */
type TextAnswer =
  | { words: string; attempt: number; status: "ready"; hits: NoteTextHit[] }
  | { words: string; attempt: number; status: "error" };

export function NotesSearchView({
  notes,
  query,
  onQueryChange,
  searchText,
  selectedId,
  onOpen,
  onClose,
}: {
  /** Every note this person can see (archived included; trashed are skipped). */
  notes: Note[];
  query: string;
  onQueryChange: (query: string) => void;
  /** The server's full-text search over what notes say. */
  searchText: (query: string) => Promise<NoteTextHit[]>;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const [answer, setAnswer] = useState<TextAnswer | null>(null);
  const [attempt, setAttempt] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = query.trim();
  const searchable = queryWords(trimmed).length > 0;

  const titleHits = useMemo(() => findByTitle(notes, trimmed), [notes, trimmed]);

  // The box takes the caret when the search opens (and the shell puts it back
  // when Search is pressed again).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Last-write-wins: a slow answer for older words never lands.
  const request = useRef(0);
  useEffect(() => {
    const id = ++request.current;
    if (!searchable) return;
    const timer = setTimeout(() => {
      searchText(trimmed).then(
        (hits) =>
          id === request.current && setAnswer({ words: trimmed, attempt, status: "ready", hits }),
        () => id === request.current && setAnswer({ words: trimmed, attempt, status: "error" }),
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, searchable, searchText, attempt]);

  // A newer query keeps the last answer on screen until its own lands.
  const current = answer?.words === trimmed && answer.attempt === attempt ? answer : null;
  const searching = searchable && current === null;
  const shown = searchable ? (current ?? answer) : null;
  const notesById = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const textHits = shown?.status === "ready" ? bodyOnlyHits(shown.hits, titleHits) : [];
  const failed = searchable && current?.status === "error";
  const nothing =
    searchable && titleHits.length === 0 && current?.status === "ready" && textHits.length === 0;

  const hitButtons = () =>
    [...(listRef.current?.querySelectorAll<HTMLElement>("[data-search-hit]") ?? [])].filter(
      (el) => el.offsetParent !== null,
    );

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      hitButtons()[0]?.focus();
    } else if (e.key === "Enter") {
      const first = titleHits[0]?.id ?? textHits[0]?.id;
      if (first) {
        e.preventDefault();
        onOpen(first);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const onHitKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const buttons = hitButtons();
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    if (at === -1) return;
    e.preventDefault();
    const next = e.key === "ArrowDown" ? at + 1 : at - 1;
    if (next < 0) inputRef.current?.focus();
    else buttons[Math.min(next, buttons.length - 1)]?.focus();
  };

  return (
    <div data-slot="notes-search" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-1 pb-2">
        <IconButton icon={ArrowLeft} label="Back to notes" onClick={onClose} />
        <Input
          ref={inputRef}
          size="sm"
          type="search"
          aria-label="Search notes"
          placeholder="Search notes"
          className="min-w-0 flex-1"
          value={query}
          maxLength={256}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onInputKeyDown}
        />
      </div>
      <div
        ref={listRef}
        className="pane-scroll scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1 pb-4"
      >
        {!searchable ? (
          <p className="px-2 py-2 text-xs text-pretty text-subtle-foreground">
            Find a note by its title or by anything written in it.
          </p>
        ) : null}
        {titleHits.length > 0 ? (
          <HitGroup label="Titles">
            {titleHits.map((note) => (
              <HitRow
                onKeyDown={onHitKeyDown}
                key={note.id}
                note={note}
                selected={note.id === selectedId}
                onOpen={() => onOpen(note.id)}
              />
            ))}
          </HitGroup>
        ) : null}
        {failed ? (
          <div role="alert" className="flex items-center gap-2 px-2 py-2">
            <p className="text-xs text-muted-foreground">
              Couldn’t search what notes say. Titles still work.
            </p>
            <Button size="sm" variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : null}
        {textHits.length > 0 ? (
          <HitGroup label="In the text">
            {textHits.map((hit) => {
              const note = notesById.get(hit.id);
              return (
                <HitRow
                  onKeyDown={onHitKeyDown}
                  key={hit.id}
                  note={
                    note ?? { id: hit.id, title: hit.title, icon: null, isArchived: hit.isArchived }
                  }
                  snippet={bodySnippet(hit.bodyText, trimmed)}
                  selected={hit.id === selectedId}
                  onOpen={() => onOpen(hit.id)}
                />
              );
            })}
          </HitGroup>
        ) : null}
        {searching && titleHits.length === 0 && textHits.length === 0 ? (
          <output className="block px-2 py-2 text-xs text-subtle-foreground">Searching…</output>
        ) : null}
        {nothing ? (
          <output className="block px-2 py-6 text-center text-sm text-pretty text-muted-foreground">
            No notes match “{trimmed}”.
          </output>
        ) : null}
      </div>
    </div>
  );
}

function HitGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="pb-2">
      <h3 className="px-2 pt-1 pb-1 text-xs font-medium text-subtle-foreground">{label}</h3>
      <ul className="flex flex-col gap-px">{children}</ul>
    </section>
  );
}

function HitRow({
  note,
  snippet = null,
  selected,
  onOpen,
  onKeyDown,
}: {
  note: Pick<Note, "id" | "title" | "icon" | "isArchived">;
  snippet?: SnippetParts | null;
  selected: boolean;
  onOpen: () => void;
  /** ↑ ↓ between results, Esc back to the tree. */
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <li>
      <button
        type="button"
        data-search-hit={note.id}
        onClick={onOpen}
        onKeyDown={onKeyDown}
        className={cn(
          "flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left font-sans outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          selected
            ? `${SELECTED_ROW} text-foreground`
            : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
        )}
      >
        <span className="flex h-5 w-icon shrink-0 items-center justify-center">
          {note.icon ? (
            <span className="text-sm leading-none">{note.icon}</span>
          ) : (
            <FileText aria-hidden className="size-icon-sm" />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{displayTitle(note.title)}</span>
            {note.isArchived ? (
              <Eyebrow className="shrink-0" tone="tag">
                Archived
              </Eyebrow>
            ) : null}
          </span>
          {snippet ? (
            <span className="line-clamp-2 text-xs text-subtle-foreground">
              {snippet.before}
              {snippet.match ? (
                <mark className="rounded-sm bg-state-selected font-medium text-foreground">
                  {snippet.match}
                </mark>
              ) : null}
              {snippet.after}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}
