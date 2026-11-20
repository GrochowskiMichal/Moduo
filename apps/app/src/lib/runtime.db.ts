// The typed Supabase client every runtime file talks through, and the one way
// to turn a PostgREST answer into data or a thrown error.
//
// `Database` is generated from prod (`bun run db:types`; `db:types:local` for a
// migration still on the local stack), so table, column, RPC and p_* argument
// names are checked at compile time: a misspelt argument is a type error here,
// not a PGRST202 at run time that a "not deployed yet" fallback swallows.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/types/supabase";

export type Db = SupabaseClient<Database>;
export type { Database, Json };

type Schema = Database["public"];
/** An RPC's arguments, for a call whose args are built up before the call. */
export type RpcArgs<F extends keyof Schema["Functions"]> = Schema["Functions"][F]["Args"];
/** A table's insert/upsert row, for a payload built up before the call. */
export type TableInsert<T extends keyof Schema["Tables"]> = Schema["Tables"][T]["Insert"];

/**
 * Escape hatch for the few generic helpers that pick a table or RPC by a
 * runtime string (sync feeds, per-kind template tables). Typing stops here, so
 * keep the names in a const map next to the call.
 */
export function untypedDb(db: Db): SupabaseClient {
  return db as unknown as SupabaseClient;
}

type PgErrorLike = {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

/**
 * What every runtime read and write throws on a PostgREST/Postgres error. The
 * message is the server's, unchanged (op errors carry a parseable detail in it);
 * `code` keeps the PostgREST/SQLSTATE code a plain `new Error(message)` lost.
 */
export class DbError extends Error {
  readonly code: string | undefined;
  readonly details: string | undefined;
  readonly hint: string | undefined;

  constructor(error: PgErrorLike) {
    super(error.message);
    this.name = "DbError";
    this.code = error.code || undefined;
    this.details = error.details ?? undefined;
    this.hint = error.hint ?? undefined;
  }
}

type Answer = { data: unknown; error: PgErrorLike | null };
/** The data type of a builder's success branch (`maybeSingle` keeps its null). */
type DataOf<A extends Answer> = Extract<A, { error: null }>["data"];

/** Await a query builder; return its data or throw a `DbError`. */
export async function runQuery<A extends Answer>(query: PromiseLike<A>): Promise<DataOf<A>> {
  const res = await query;
  if (res.error) throw new DbError(res.error);
  return res.data as DataOf<A>;
}

/** `runQuery` for `db.rpc(…)` calls: same contract, named for grep-ability. */
export const runRpc: <A extends Answer>(call: PromiseLike<A>) => Promise<DataOf<A>> = runQuery;

/**
 * An RPC's `json`/`jsonb` answer read as an object (the SQL builds it with
 * json_build_object). Anything else reads as `{}`, so `obj.count` is undefined
 * exactly where the untyped `data?.count` was.
 */
export function jsonObject(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
