import { entityLinkRowSchema, requireRow } from "@contracts/rows";

import type { EntityLink } from "./entity-links";
import { readPaged, type Truncation } from "./paged-select";
import { AUTH_USER_KEY, bootReads, supabaseClient } from "./runtime.web.client";

/**
 * The current authenticated user, deduped across the boot storm. Cached until an
 * identity transition invalidates it (below), so repeated boot reads share one
 * `/auth/v1/user` round-trip instead of ~16. Returns null when signed out.
 */
export async function getAuthedUser() {
  try {
    // Cache ONLY a real authenticated user. A signed-out state and a transient
    // failure (offline / a mid-refresh 401 / a 5xx) both surface as `getUser()`
    // returning an error + null user — we throw on either so the request-cache
    // does NOT retain it. Otherwise one boot blip would pin `null` forever (Infinity
    // TTL, cleared only on a real sign-in/out) and brick every user-scoped read +
    // write for the whole session. `getAuthedUser` still resolves to `null` for the
    // caller (the old `getUser()` graceful-null contract), it just isn't cached, so
    // the next call retries — exactly the per-call self-heal the old code had.
    return await bootReads.read(
      AUTH_USER_KEY,
      async () => {
        const { data, error } = await supabaseClient.auth.getUser();
        if (error) throw error;
        if (!data.user) throw new Error("no authenticated user");
        return data.user;
      },
      Number.POSITIVE_INFINITY,
    );
  } catch {
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

// ── Bounded module reads (SCALE-1) ────────────────────────────────────────────
// PostgREST caps EVERY select at `db-max-rows` (1000 here) and says nothing —
// and `.limit(5000)` does not lift it, it's a hard per-request ceiling. So the
// list reads page with `.range()` up to an explicit cap and report what they
// had to cut. See [paged-select.ts](./paged-select.ts) for the full rule.

export type SelectOpts = { count: "exact"; head: true };
/** Rebuilds the *same* filtered query each call — a supabase builder is single-use. */
export type QueryBuilderFn = (opts?: SelectOpts) => any;

export type CappedRead<T> = { rows: T[]; error: any; truncation: Truncation | null };

/**
 * Page a filtered query up to `cap` rows.
 *
 * `build` must apply the select + every filter; `order` adds the sort to the
 * ROW query only (a head-count doesn't need one). Paging is only correct under
 * a total order, so `order` must end in a unique tiebreaker — `id`.
 */
export async function selectCapped<T>(args: {
  scope: string;
  cap: number;
  build: QueryBuilderFn;
  order: (q: any) => any;
}): Promise<CappedRead<T>> {
  const res = await readPaged<T, any>({
    scope: args.scope,
    cap: args.cap,
    page: async (offset, limit) => {
      const { data, error } = await args.order(args.build()).range(offset, offset + limit - 1);
      return { data: (data ?? null) as T[] | null, error };
    },
    countTotal: async () => {
      const { count, error } = await args.build({ count: "exact", head: true });
      return error ? null : (count ?? null);
    },
    // Every table here is keyed by `id` — dedupe guards the offset-paging
    // window against concurrent inserts shifting rows across a page edge.
    keyOf: (row: any) => String(row?.id),
  });
  return { rows: res.rows, error: res.error, truncation: res.truncation };
}

export function desktopOnly(): { message: string } {
  return { message: "This feature is only available on the desktop app." };
}

/** First row of a single-object RPC result, with a clear error if empty. */
export function firstRow(data: unknown, fn: string): any {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error(`The ${fn} operation returned nothing.`);
  return row;
}

// ── Spine: entity_links / entities row<->model mappers ────────────────────────

export function entityLinkRowToModel(raw: unknown): EntityLink {
  const r = requireRow(entityLinkRowSchema, raw, "entity link");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    sourceType: r.source_type,
    sourceId: r.source_id,
    targetType: r.target_type,
    targetId: r.target_id,
    relationKind: r.relation_kind,
    origin: r.origin,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    deletedAt: r.deleted_at ?? null,
  };
}
