/**
 * The sidebar's full-text search (NO-8), restyled for the refreshed shell. NR-10
 * replaces it with a row that opens ⌘K scoped to notes; until then a query
 * replaces the tree with ranked results (title hits, then body snippets).
 */

import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { SELECTED_ROW } from "@/components/ui/selection";
import { cn } from "@/lib/utils";
import type { NoteSearchResult } from "../search";
import { displayTitle } from "../title";

export function useNoteSearch(onSearch?: (q: string) => Promise<NoteSearchResult[]>) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NoteSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (!onSearch || !q) {
      setResults([]);
      setSearching(false);
      setFailed(false);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      void onSearch(q)
        .then((res) => {
          if (!active) return;
          setResults(res);
          setFailed(false);
          setSearching(false);
        })
        .catch(() => {
          if (!active) return;
          setResults([]);
          setFailed(true);
          setSearching(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, onSearch]);
  return { query, setQuery, results, searching, failed, active: query.trim() !== "" };
}

export function SidebarSearchInput({
  query,
  onChange,
}: {
  query: string;
  onChange: (q: string) => void;
}) {
  return (
    <div className="relative px-1 pb-2">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-icon-sm -translate-y-1/2 text-muted-foreground"
      />
      <input
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && query) {
            e.preventDefault();
            onChange("");
          }
        }}
        placeholder="Search notes"
        aria-label="Search notes"
        className="h-(--ctrl-h-sm) w-full rounded-md bg-state-hover pr-7 pl-8 font-sans text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      {query ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute top-1/2 right-2.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-state-active hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <X aria-hidden className="size-icon-xs" />
        </button>
      ) : null}
    </div>
  );
}

export function SidebarSearchResults({
  results,
  searching,
  failed,
  selectedId,
  onOpen,
}: {
  results: NoteSearchResult[];
  searching: boolean;
  failed: boolean;
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  if (searching && results.length === 0) {
    return <p className="px-2 py-6 text-center text-sm text-muted-foreground">Searching…</p>;
  }
  if (failed) {
    return (
      <p className="px-2 py-6 text-center text-sm text-muted-foreground">
        Search needs a connection.
      </p>
    );
  }
  if (results.length === 0) {
    return <p className="px-2 py-6 text-center text-sm text-muted-foreground">No matches.</p>;
  }
  return (
    <ul aria-label="Search results" className="flex flex-col gap-px">
      {results.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={() => onOpen(r.id)}
            className={cn(
              "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              r.id === selectedId ? SELECTED_ROW : "hover:bg-state-hover",
            )}
          >
            <span className="flex w-full items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-sans text-sm text-foreground">
                {displayTitle(r.title)}
              </span>
              {r.archived ? (
                <span className="shrink-0 text-xs text-muted-foreground">Archived</span>
              ) : null}
            </span>
            {r.snippet ? (
              <span className="line-clamp-2 text-xs text-muted-foreground">{r.snippet}</span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
