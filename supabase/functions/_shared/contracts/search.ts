/**
 * Global search's one row shape (GS-1, specs/global-search.md Assumption 2).
 *
 * Search is federated: each module answers `<module>__search(ws, query, limit)`
 * with these rows and `search_all` merges and ranks them. The text primitives
 * the SQL shares (`search__query`, `search__snippet`, …) live in
 * `20261028220000_search_primitives.sql`; the bounds below mirror it and
 * search.test.ts checks they agree.
 *
 * - `entity_type` stays an open string (polymorphic types).
 * - `match` is closed: `SEARCH_MATCHES` in vocabularies.ts.
 * - `rank` is 0..1 within the module.
 * - `snippet` marks matches with U+E000 … U+E001; the client splits on them and
 *   draws text, never HTML.
 */

import { z } from "zod";

import { parseOrError, type SafeParseResult } from "./errors.ts";
import { normalizeSearchMatch, searchMatchSchema } from "./vocabularies.ts";

/** Where a match starts in a snippet (U+E000). */
export const SEARCH_SNIPPET_START = "";
/** Where a match ends in a snippet (U+E001). */
export const SEARCH_SNIPPET_END = "";

/** The query is cut to this many characters, then to this many words. */
export const SEARCH_QUERY_MAX_CHARS = 256;
export const SEARCH_QUERY_MAX_WORDS = 32;
/** Words this long or longer match as word-starts; shorter ones whole words only. */
export const SEARCH_PREFIX_MIN_LETTERS = 3;

const nullableText = z.union([z.string(), z.null()]);

export const searchHitSchema = z.object({
  entity_type: z.string().min(1),
  entity_id: z.string().min(1),
  title: z.string(),
  context: nullableText,
  snippet: nullableText,
  icon: nullableText,
  match: searchMatchSchema,
  rank: z.number().min(0).max(1),
  updated_at: z.string(),
});
export type SearchHit = z.infer<typeof searchHitSchema>;

export function isSearchHit(value: unknown): value is SearchHit {
  return searchHitSchema.safeParse(value).success;
}

/** Strict parse: a row that breaks the contract is refused. */
export function parseSearchHit(input: unknown): SafeParseResult<SearchHit> {
  return parseOrError(searchHitSchema, input);
}

const textOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

function clampRank(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Lax read for display: an unknown match reads as a body hit, the rank is
 * clamped to 0..1, a missing optional field is null. A row without a type or id
 * can't be opened, so it reads as null (drop it). Never throws.
 */
export function normalizeSearchHit(input: unknown): SearchHit | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  const entityType = textOrNull(row.entity_type);
  const entityId = textOrNull(row.entity_id);
  if (!entityType || !entityId) return null;
  return {
    entity_type: entityType,
    entity_id: entityId,
    title: textOrNull(row.title) ?? "",
    context: textOrNull(row.context),
    snippet: textOrNull(row.snippet),
    icon: textOrNull(row.icon),
    match: normalizeSearchMatch(row.match),
    rank: clampRank(row.rank),
    updated_at: textOrNull(row.updated_at) ?? "",
  };
}
