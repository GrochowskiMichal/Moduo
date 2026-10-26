// The dashboard layout persistence repo (DB-4, AC6/AC11). Preference-class:
// a local cache (offline truth) + a debounced Supabase upsert, reconciled
// last-write-wins by a client-set timestamp. Mirrors the prefs-sync posture
// (client-stamped `updatedAt`, numeric-ms comparison) but the whole layout is
// ONE atomic composition, so there's no per-domain split — one row, LWW.
//
// The load path is pure + total: it never throws (a cloud/offline error degrades
// to the local cache) and always yields a legal grid (a corrupt/legacy JSONB blob
// is sanitized to the compacted default — AC11), seeding the curated default for
// a brand-new user. A failed cloud read with no cache is not "a brand-new user":
// the default shows as a placeholder that never outranks or overwrites a real
// layout (see `unconfirmed`). Save is immediate-local + 1s-debounced-cloud; `flush` forces
// the pending cloud write now (call it on hide/unload/workspace-switch).

import type { ModuoRuntime, StoredDashboardLayout } from "@/lib/runtime.types";

import { createDefaultLayout } from "../engine/default-layout";
import { fitAllowedSizes, sanitizeLayout } from "../engine/grid-engine";
import type { DashboardLayout } from "../engine/types";
import { allowedSizesFor } from "../registry/catalog";

/** localStore namespace for the per-workspace layout cache (key = workspaceId). */
const CACHE_NS = "dashboard";
const DEFAULT_DEBOUNCE_MS = 1000;
/** The stamp of a placeholder layout: older than any real save, so a real one always wins. */
const PLACEHOLDER_STAMP = new Date(0).toISOString();

export interface LoadedLayout {
  layout: DashboardLayout;
  updatedAt: string;
  origin: "cloud" | "cache" | "seed";
}

export interface LayoutRepo {
  /** Cache-first load, cloud-newer replaces, seeds the default on a fresh user (a placeholder when the cloud read fails). Never throws. */
  load(workspaceId: string): Promise<LoadedLayout>;
  /** Persist a new layout: immediate local write + 1s-debounced cloud upsert. */
  save(workspaceId: string, layout: DashboardLayout): Promise<void>;
  /** Force the pending cloud write now (hide / unload / workspace switch). */
  flush(): Promise<void>;
}

function toMillis(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function isStored(v: unknown): v is StoredDashboardLayout {
  return typeof v === "object" && v !== null && "layout" in v && "updatedAt" in v;
}

/**
 * Pure load reconciliation: pick the fresher of the local cache and the cloud row
 * by client-set timestamp (cloud wins ties — same content after a save), sanitize
 * it into a legal grid, or seed the curated default when neither exists.
 */
export function resolveLoad(
  cache: StoredDashboardLayout | null,
  cloud: StoredDashboardLayout | null,
  nowIso: string,
): LoadedLayout {
  if (!cache && !cloud) {
    return { layout: sanitizeLayout(createDefaultLayout()), updatedAt: nowIso, origin: "seed" };
  }
  const cloudWins = !!cloud && (!cache || toMillis(cloud.updatedAt) >= toMillis(cache.updatedAt));
  const winner = (cloudWins ? cloud : cache) as StoredDashboardLayout;
  return {
    layout: fitAllowedSizes(sanitizeLayout(winner.layout), allowedSizesFor),
    updatedAt: winner.updatedAt,
    origin: cloudWins ? "cloud" : "cache",
  };
}

export function createLayoutRepo(
  runtime: ModuoRuntime,
  opts: { now?: () => string; debounceMs?: number } = {},
): LayoutRepo {
  const now = opts.now ?? (() => new Date().toISOString());
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { workspaceId: string; layout: DashboardLayout; updatedAt: string } | null = null;
  // Workspaces whose cloud row is unknown: the cloud read failed and there was no
  // cache, or only one still at the placeholder stamp, so what shows is a placeholder. Their saves stay local and carry the
  // placeholder stamp, so the account's real layout wins at the next good read.
  const unconfirmed = new Set<string>();

  async function readCache(workspaceId: string): Promise<StoredDashboardLayout | null> {
    try {
      const raw = await runtime.localStore.get(CACHE_NS, workspaceId);
      return isStored(raw) ? raw : null;
    } catch {
      return null;
    }
  }

  async function writeCache(workspaceId: string, row: StoredDashboardLayout): Promise<void> {
    try {
      await runtime.localStore.set(CACHE_NS, workspaceId, row);
    } catch {
      /* a full/absent localStorage never breaks the in-memory layout */
    }
  }

  async function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const p = pending;
    pending = null;
    if (!p) return;
    try {
      await runtime.dashboard.save({
        workspaceId: p.workspaceId,
        layout: p.layout,
        updatedAt: p.updatedAt,
      });
    } catch {
      /* cloud write failed — the cache holds the truth; the next save retries */
    }
  }

  async function load(workspaceId: string): Promise<LoadedLayout> {
    const cache = await readCache(workspaceId);
    let cloud: StoredDashboardLayout | null = null;
    try {
      cloud = await runtime.dashboard.get(workspaceId);
      unconfirmed.delete(workspaceId);
    } catch {
      // offline / signed-out / not-deployed → local-only mode. A failed read says
      // nothing about the cloud row, so with no cache this is a placeholder, not a
      // seed. A cache still carrying the placeholder stamp is an edit of one made
      // by an earlier mount (the hook makes a new repo per mount): still unconfirmed.
      if (!cache || cache.updatedAt === PLACEHOLDER_STAMP) {
        unconfirmed.add(workspaceId);
        return resolveLoad(cache, null, PLACEHOLDER_STAMP);
      }
    }
    const resolved = resolveLoad(cache, cloud, now());
    // A placeholder edit the cloud read has now confirmed (no row to lose) becomes
    // a normal local layout, so the epoch stamp only ever means "unconfirmed".
    if (resolved.updatedAt === PLACEHOLDER_STAMP) resolved.updatedAt = now();
    // Reflect the resolved truth back into the cache so a cloud adoption or a
    // fresh seed survives the next offline paint.
    await writeCache(workspaceId, { layout: resolved.layout, updatedAt: resolved.updatedAt });
    // NOTE (DF-12): `load` is a READ and must never issue a cloud write — the old
    // "reconcile a cache-wins load UP to the cloud" here made every boot that
    // resolved to the local cache POST a `dashboard_layouts` upsert (the write-on-
    // read the fetch-storm audit flagged). A cut-off local edit stays the truth in
    // the local cache and rides up on the next real edit's `save` instead, so
    // cross-device propagation is delayed at most one edit, never lost.
    return resolved;
  }

  // `pending` holds ONE workspace's save. Callers must keep this single-
  // workspace-at-a-time (the hook flushes before switching + gates edits behind
  // `loading`), so a cross-workspace clobber of `pending` can't occur; the
  // immediate cache write also lands regardless, so a dropped push is stale-not-lost.
  async function save(workspaceId: string, layout: DashboardLayout): Promise<void> {
    if (unconfirmed.has(workspaceId)) {
      // An edit of the placeholder: keep it on this device only, stamped so the
      // real layout (if the account has one) wins at the next good read.
      await writeCache(workspaceId, { layout, updatedAt: PLACEHOLDER_STAMP });
      return;
    }
    const updatedAt = now();
    await writeCache(workspaceId, { layout, updatedAt }); // immediate local truth
    pending = { workspaceId, layout, updatedAt };
    if (timer) clearTimeout(timer);
    if (debounceMs <= 0) {
      await flush();
      return;
    }
    timer = setTimeout(() => {
      void flush();
    }, debounceMs);
  }

  return { load, save, flush };
}
