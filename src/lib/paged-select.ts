// Bounded, paged reads for the module list endpoints (SCALE-1).
//
// PostgREST silently truncates every SELECT at the project's `db-max-rows` —
// 1000 on ours (verified live against the hosted project 2026-07-29): no error,
// no warning, the tail simply vanishes. Crucially an explicit `.limit(5000)`
// does NOT lift it — max-rows is a hard PER-REQUEST ceiling, so the only way
// past 1000 rows is to page with `.range()`.
//
// So every module list read now: pages up to an explicit cap well above real
// alpha usage, and — when the cap is what stopped it — reports a `Truncation`
// the UI must SHOW ("showing N of M"). Silent loss is the one outcome that is
// never acceptable.

/**
 * PostgREST's per-request row ceiling (`db-max-rows`). A hard cap, not a default.
 *
 * This mirrors a SERVER setting we can't read from the client. If the project's
 * `db-max-rows` is ever lowered below this, every page comes back short, the
 * paging loop reads that as "end of collection", and silent truncation returns
 * — so treat the Supabase API setting as coupled to this constant.
 */
export const PGRST_MAX_ROWS = 1000;

/**
 * Per-collection read ceilings. Set well above any realistic alpha workspace —
 * they exist so a runaway workspace degrades *visibly* (a notice + a number),
 * not silently. Real pagination/virtualization is the follow-up.
 */
export const READ_CAPS = {
  tasks: 5000,
  buckets: 500,
  tags: 1000,
  tagLinks: 10000,
  taskRelations: 10000,
  notes: 5000,
  contacts: 10000,
  companies: 5000,
  contactFieldDefs: 500,
  calendarEvents: 5000,
  calendarAccounts: 200,
  emailAccounts: 200,
  emailRefs: 5000,
} as const;

/** One collection that hit its cap. `null` everywhere else = nothing was cut. */
export type Truncation = {
  /** User-facing plural noun for the collection ("tasks", "events"). */
  scope: string;
  /** Rows the app is actually holding (= the cap). */
  shown: number;
  /** Total rows matching the query, or null when the count itself failed. */
  total: number | null;
};

export type PageResult<T, E> = { data: T[] | null; error: E | null };

export type ReadPagedArgs<T, E> = {
  scope: string;
  cap: number;
  /** Fetches rows `[offset, offset + limit)`. Must apply a DETERMINISTIC order. */
  page: (offset: number, limit: number) => Promise<PageResult<T, E>>;
  /** Exact total, fetched ONLY when the cap truncated (so boot stays cheap). */
  countTotal?: () => Promise<number | null>;
  /** Override the per-request page size (tests). Clamped to PGRST_MAX_ROWS. */
  pageSize?: number;
  /**
   * Stable row key. Offset paging is not a snapshot: a row inserted before the
   * cursor between two pages shifts everything down, re-emitting a row already
   * held (a duplicate React key downstream). Dedupe on the way in.
   */
  keyOf?: (row: T) => string;
};

export type PagedRead<T, E> = {
  rows: T[];
  error: E | null;
  truncation: Truncation | null;
};

/**
 * Page until the collection is exhausted or `cap` rows are held.
 *
 * Reads one row PAST the cap so "there is more" is known without a second
 * query — and under the cap (every real workspace today) the whole thing is a
 * single request, which is what keeps boot cost flat (gotchas §Boot-time read
 * caching DF-12).
 *
 * An error on any page returns the pages read so far alongside the error —
 * callers decide whether that's fatal (throw) or degradable (empty).
 */
export async function readPaged<T, E>(args: ReadPagedArgs<T, E>): Promise<PagedRead<T, E>> {
  const pageSize = Math.max(1, Math.min(args.pageSize ?? PGRST_MAX_ROWS, PGRST_MAX_ROWS));
  const cap = Math.max(1, args.cap);
  const ceiling = cap + 1;
  const rows: T[] = [];
  const seen = args.keyOf ? new Set<string>() : null;
  let offset = 0;
  // Deduping means `rows.length` no longer grows with every page, so the
  // `rows.length < ceiling` bound alone can't stop a server that keeps
  // returning already-seen ids. A hard page budget can. (+4 covers the short
  // final page and any partial pages a concurrent insert costs us.)
  const maxPages = Math.ceil(ceiling / pageSize) + 4;
  let pages = 0;

  while (rows.length < ceiling && pages < maxPages) {
    pages += 1;
    const want = Math.min(pageSize, ceiling - rows.length);
    const res = await args.page(offset, want);
    if (res.error) return { rows, error: res.error, truncation: null };
    const batch = res.data ?? [];
    for (const row of batch) {
      if (seen && args.keyOf) {
        const key = args.keyOf(row);
        if (seen.has(key)) continue;
        seen.add(key);
      }
      rows.push(row);
    }
    // A short page is the end of the collection — nothing was cut. (Advance by
    // the RAW batch length, not the deduped one, or the cursor stalls.)
    if (batch.length < want) break;
    offset += batch.length;
  }

  if (rows.length <= cap) return { rows, error: null, truncation: null };

  let total: number | null = null;
  if (args.countTotal) {
    try {
      total = await args.countTotal();
    } catch {
      total = null;
    }
  }
  return {
    rows: rows.slice(0, cap),
    error: null,
    // The count is a second round-trip, so rows deleted in between could make
    // it read "5,000 of 4,998" — or the equally silly "5,000 of 5,000, and
    // there's more". A total that no longer exceeds what we hold is stale, so
    // drop it and fall back to the honest "N (of more)".
    truncation: { scope: args.scope, shown: cap, total: total != null && total > cap ? total : null },
  };
}

/** Drop the `null`s — the shape every bundle's `truncated` field wants. */
export function collectTruncations(
  ...items: Array<Truncation | null | undefined>
): Truncation[] {
  return items.filter((t): t is Truncation => !!t);
}

/** "1,000 of 1,510 tasks" / "5,000 tasks (of more)" when the count failed. */
export function describeTruncation(t: Truncation): string {
  const shown = t.shown.toLocaleString();
  if (t.total == null) return `${shown} ${t.scope} (of more)`;
  return `${shown} of ${t.total.toLocaleString()} ${t.scope}`;
}
