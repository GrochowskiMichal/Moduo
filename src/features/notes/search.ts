// /notes URL search params (Wave-3 NO-3, mirrors contacts FX-1). Selection is
// URL-held so reload/back/forward and `moduo:entity:open` deep links work;
// `action` carries the palette's / global-capture "new note" intent.

export type NotesSearch = {
  id?: string;
  action?: "new";
};

export function validateNotesSearch(search: Record<string, unknown>): NotesSearch {
  const id = typeof search.id === "string" && search.id.length > 0 ? search.id : undefined;
  const action = search.action === "new" ? search.action : undefined;
  return {
    ...(id ? { id } : {}),
    ...(action ? { action } : {}),
  };
}

// ── Full-text sidebar search (NO-8, AC8) ─────────────────────────────────────
// The runtime does the indexed SELECT over the server's `search_tsv` GIN index;
// these PURE helpers shape the candidate rows into results — title-vs-body
// match, a snippet window, the archived flag, trashed excluded — so the query
// logic is unit-testable without a database.

/** A candidate row the runtime fetches for a query (server pre-filtered by
 * `search_tsv @@ websearch_to_tsquery`). */
export type NoteSearchRow = {
  id: string;
  title: string;
  bodyText: string;
  isArchived: boolean;
  deletedAt: string | null;
};

export type NoteSearchResult = {
  id: string;
  title: string;
  /** A short excerpt around the first body match, or the body head. */
  snippet: string;
  /** The query matched the title (vs body-only). */
  titleMatch: boolean;
  /** Archived notes still surface, but flagged (spec AC8). */
  archived: boolean;
};

const SNIPPET_RADIUS = 64;

export function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

/** The distinct lowercased terms in a query (client-side match + snippet). */
export function searchTerms(query: string): string[] {
  return [...new Set(normalizeSearchQuery(query).toLowerCase().split(" ").filter(Boolean))];
}

/** A snippet window around the first term hit in the body; falls back to the
 * body head for a title-only match. Whitespace is collapsed first. */
export function snippetFor(bodyText: string, query: string): string {
  const body = bodyText.replace(/\s+/g, " ").trim();
  if (!body) return "";
  const lower = body.toLowerCase();
  let hit = -1;
  for (const term of searchTerms(query)) {
    const i = lower.indexOf(term);
    if (i >= 0 && (hit === -1 || i < hit)) hit = i;
  }
  if (hit === -1) {
    const head = body.slice(0, SNIPPET_RADIUS * 2);
    return head + (body.length > head.length ? "…" : "");
  }
  const start = Math.max(0, hit - SNIPPET_RADIUS);
  const end = Math.min(body.length, hit + SNIPPET_RADIUS);
  return (start > 0 ? "…" : "") + body.slice(start, end).trim() + (end < body.length ? "…" : "");
}

/**
 * Shape fetched candidate rows into results: exclude trashed, flag archived,
 * mark title matches, attach snippets, float title matches to the top (server
 * rank order is otherwise preserved — Array.sort is stable). The trashed
 * exclusion is re-applied here so the shaping is provably correct in a test
 * even if a caller forgets the server-side filter.
 */
export function shapeNoteSearchResults(rows: NoteSearchRow[], query: string): NoteSearchResult[] {
  const terms = searchTerms(query);
  const titleHits = (title: string) => {
    const t = title.toLowerCase();
    return terms.some((term) => t.includes(term));
  };
  return rows
    .filter((r) => !r.deletedAt)
    .map((r) => ({
      id: r.id,
      title: r.title,
      snippet: snippetFor(r.bodyText, query),
      titleMatch: titleHits(r.title),
      archived: r.isArchived,
    }))
    .sort((a, b) => Number(b.titleMatch) - Number(a.titleMatch));
}
