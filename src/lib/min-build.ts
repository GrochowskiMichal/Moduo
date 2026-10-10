// The minimum client build (TV-D8, REPLAN §6.7, specs/tasks-v3.md §Assumptions
// #9). The server keeps `app_settings.min_build`: the oldest app version that
// may still save. The app reads it at boot; below it the app shows "Update
// Moduo" and runs read-only, so the next schema change doesn't have to keep a
// shim for builds that can't know about it. TV-D7 is the first to raise it.
//
// Read-only is enforced where every write leaves the app: the Supabase
// client's fetch (`readOnlyFetch`). Sign-in, reads and Edge Functions pass; a
// write gets a 403 whose message says why, so whatever made it shows that
// message the way it shows any refused save.

import { useSyncExternalStore } from "react";

/** The words a refused save shows. */
export const READ_ONLY_MESSAGE =
  "This version of Moduo is too old to save changes. Update Moduo to keep working.";

/** `1.4.2`, `v1.4.2`, `1.4.2-beta.1` → [1, 4, 2]; anything else → null. */
export function parseVersion(input: string | null | undefined): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec((input ?? "").trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Is `current` older than `minimum`? Unreadable versions never hold anyone
 * back (a bad setting must not lock everyone out).
 */
export function isBelowMinimum(current: string, minimum: string | null | undefined): boolean {
  const a = parseVersion(current);
  const b = parseVersion(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]!;
  }
  return false;
}

// ── The app-wide state ─────────────────────────────────────────────────────────

export type MinBuildState = {
  /** True once a check has found this build below the minimum. */
  readOnly: boolean;
  /** The minimum the server asked for, when known. */
  minimum: string | null;
  /** This build's version. */
  current: string | null;
};

let state: MinBuildState = { readOnly: false, minimum: null, current: null };
const listeners = new Set<() => void>();

/** Record what the server said. Until a check has run, nothing is held back. */
export function applyMinBuild(minimum: string | null, current: string): MinBuildState {
  state = { readOnly: isBelowMinimum(current, minimum), minimum, current };
  for (const listener of listeners) listener();
  return state;
}

export function isReadOnlyBuild(): boolean {
  return state.readOnly;
}

export function getMinBuildState(): MinBuildState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The state for React (the "Update Moduo" banner). */
export function useMinBuild(): MinBuildState {
  return useSyncExternalStore(subscribe, getMinBuildState, getMinBuildState);
}

// ── Which requests are writes ──────────────────────────────────────────────────

/**
 * The RPCs that only read. Every other RPC counts as a write: a name can't say
 * which is which (`share_op_state` reads, `contact_merge` writes), so a new
 * RPC is held back in a read-only build until it's listed here. The list is
 * the client's read RPCs as the database marks them (STABLE, or volatile
 * without a write); `min-build.test.ts` fails when the client calls an RPC
 * this file hasn't classified.
 */
export const READ_RPCS: ReadonlySet<string> = new Set([
  "booking_google_connected",
  "calendar_busy_blocks",
  "chat_caps_get",
  "chat_unread_counts",
  "chat_workspace_enabled",
  "contact_merge_candidates",
  "links_suggest",
  "notes_list_unmaterialized",
  "notifications_list",
  "share_assign_preview",
  "share_can",
  "share_defaults_get",
  "share_op_state",
  "tasks_time_totals",
]);

/**
 * Does this request change data? Reads, sign-in (`/auth/v1`), Edge Functions
 * and Realtime always pass; a table write, any RPC not in `READ_RPCS` and a
 * Storage upload or delete don't.
 */
export function isWriteRequest(method: string | undefined, url: string): boolean {
  const verb = (method ?? "GET").toUpperCase();
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") return false;
  let path: string;
  try {
    path = new URL(url, "http://local").pathname;
  } catch {
    return false;
  }
  if (path.includes("/auth/v1/") || path.includes("/functions/v1/")) return false;
  const rpc = /\/rest\/v1\/rpc\/([^/?]+)/.exec(path);
  if (rpc) return !READ_RPCS.has(decodeURIComponent(rpc[1]!));
  if (path.includes("/rest/v1/")) return true;
  if (path.includes("/storage/v1/object/")) {
    // Signed download links and listings are reads, even though they POST.
    return !/\/storage\/v1\/object\/(?:sign|list|info)\//.test(path);
  }
  return false;
}

/** The request's method and URL, whatever fetch was called with. */
function describe(input: RequestInfo | URL, init?: RequestInit): { method: string; url: string } {
  if (typeof input === "string") return { method: init?.method ?? "GET", url: input };
  if (input instanceof URL) return { method: init?.method ?? "GET", url: input.href };
  return { method: init?.method ?? input.method, url: input.url };
}

/** A fetch that refuses writes while this build is below the minimum. */
export function readOnlyFetch(base: typeof fetch): typeof fetch {
  const guarded = (input: RequestInfo | URL, init?: RequestInit) => {
    if (state.readOnly) {
      const { method, url } = describe(input, init);
      if (isWriteRequest(method, url)) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: READ_ONLY_MESSAGE, code: "MODUO_READ_ONLY" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
    }
    return base(input, init);
  };
  return guarded as typeof fetch;
}
