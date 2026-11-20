// Cross-device sync engine for per-user preference domains (appearance, focus).
//
// Each domain keeps three things in play:
//   1. The full local value (owned by the consuming hook: React state + the
//      `moduo.<domain>` localStorage mirror used for instant first paint).
//   2. The *syncable subset* of that value, pushed to Supabase `user_preferences`
//      (theme/shade/accent/radius/font for appearance; everything for focus).
//      Per-device fields (density/textSize/tabs) never leave localStorage.
//   3. Sync metadata (`moduo.<domain>.sync`): which user the local subset belongs
//      to, its client logical write time, and a dirty flag for offline writes.
//
// Reconciliation is owner-aware last-write-wins per domain, and the server holds
// the same rule on every write (`prefs_op_set` keeps the newer stamp), so a
// device coming back online with an older copy can't overwrite a newer one. Timestamps are
// compared numerically (Date.parse) because Postgres echoes timestamptz back in
// a different textual format than the client writes — never compare them as
// strings. The desktop offline-lite build can later wrap pushDomain with a
// durable queue; the dirty flag + the `online` listener are the seam for that.
//
// Adding a `user_preferences` sync domain needs EIGHT coordinated touchpoints, and
// the untyped Supabase client catches none of the column ones:
//   1. A migration adding `<domain> jsonb` + `<domain>_updated_at timestamptz`
//      (the own-row RLS covers new columns), plus the domain in `prefs_op_set`'s list.
//   2. The user_preferences Row/Insert/Update types in `apps/app/src/types/supabase.ts`
//      (`bun run db:types`) and `prefsRowSchema` in `@contracts/rows`.
//   3. `UserPreferences` + `PreferenceDomain` in `runtime.types.preferences.ts`.
//   4. `prefsRowToModel`, `preferences.get`/`.set` and `prefsDomainPatch` in
//      `runtime.web.preferences.ts` (tauri delegates); a non-base column also goes in
//      `OPTIONAL_PREFS_COLS` + `optionalPrefsAvailable` (`prefs-columns.ts`). Miss the
//      `.select` column in `set` and the write silently drops the domain.
//   5. Here: `SyncDomain` (aliases `PreferenceDomain`), `META_KEY`, the `domainValue`
//      switch, and what `pushDomain` sends (`setDomain`).
//   6. A hook wired through `useDomainSync` (copy `useFocusPrefs`).
//   7. `pushLocalChange` on every syncable mutation.
//   8. Mount that hook APP-WIDE (as main.tsx mounts `<PreferencesSync/>`), not only in
//      its Settings pane: a domain reconciles only while a `useDomainSync` caller is mounted.

import { useCallback, useEffect, useRef } from "react";
import { z } from "zod";

import { createRequestCache } from "./request-cache";
import { getRuntime, initRuntime } from "./runtime";
import type { PreferenceDomain, UserPreferences } from "./runtime.types";

export type SyncDomain = PreferenceDomain;

/** Opaque jsonb payload shape shared across the transport boundary. */
type Json = Record<string, unknown>;

type SyncMeta = {
  /** User the local syncable subset belongs to; null = anonymous (pre-sign-in) edits. */
  userId: string | null;
  /** Client logical write time of the local subset (ISO), or null if never set. */
  updatedAt: string | null;
  /** A local write hasn't reached the cloud yet (offline / error) — flush on reconnect. */
  dirty: boolean;
};

const META_KEY: Record<SyncDomain, string> = {
  appearance: "moduo.appearance.sync",
  focus: "moduo.focus.sync",
  calendar: "moduo.calendar.sync",
  email: "moduo.email.sync",
  preferences: "moduo.preferences.sync",
};

const EMPTY_META: SyncMeta = { userId: null, updatedAt: null, dirty: false };

export function nowIso(): string {
  return new Date().toISOString();
}

function toMillis(iso: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

const syncMetaSchema = z.object({
  userId: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  dirty: z.boolean().optional(),
});

export function getSyncMeta(domain: SyncDomain): SyncMeta {
  if (typeof localStorage === "undefined") return { ...EMPTY_META };
  try {
    const raw = localStorage.getItem(META_KEY[domain]);
    if (!raw) return { ...EMPTY_META };
    const parsed = syncMetaSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { ...EMPTY_META };
    return {
      userId: typeof parsed.data.userId === "string" ? parsed.data.userId : null,
      updatedAt: typeof parsed.data.updatedAt === "string" ? parsed.data.updatedAt : null,
      dirty: parsed.data.dirty === true,
    };
  } catch {
    return { ...EMPTY_META };
  }
}

export function setSyncMeta(domain: SyncDomain, meta: SyncMeta): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(META_KEY[domain], JSON.stringify(meta));
  } catch {
    /* quota exceeded or storage disabled — non-fatal */
  }
}

// Dedupe the boot reads: the appearance / focus / calendar / email domains each
// reconcile on mount and would otherwise issue a `preferences.get()` apiece for the
// one shared row. They mount at slightly different ticks, so a pure in-flight memo
// only caught the truly-concurrent ones — a short TTL lets them share a single read
// across the launch window. A `pushDomain` write invalidates it so a seed one domain
// just wrote is visible to the next domain's reconcile. Only a successful read is
// retained (an error throws through, so a transient failure isn't cached).
//
// The key is scoped by userId: on a shared browser a fast A→B account switch within
// the TTL must NOT let B adopt A's cached prefs (a cross-user leak). Each user reads
// their own key; the stale key simply expires. DF-12.
const PREFS_CACHE_TTL_MS = 3_000;
const prefsReads = createRequestCache();

/**
 * The cloud row read, tagged so a failed read can never pass for "no row yet":
 * reconcile treats `none` as "seed the cloud" and `error` as "touch nothing".
 */
export type CloudPrefsRead =
  { kind: "row"; prefs: UserPreferences } | { kind: "none" } | { kind: "error"; error: unknown };

export function getCloudPrefs(userId: string): Promise<CloudPrefsRead> {
  return prefsReads
    .read(
      `prefs:${userId}`,
      async () => {
        const rt = await initRuntime();
        return await rt.preferences.get(); // throws on a real read error → not cached
      },
      PREFS_CACHE_TTL_MS,
    )
    .then(
      (prefs): CloudPrefsRead => (prefs ? { kind: "row", prefs } : { kind: "none" }),
      (error: unknown): CloudPrefsRead => ({ kind: "error", error }),
    );
}

/** Drop every cached prefs read so the next reconcile re-fetches (after a write). */
export function invalidateCloudPrefs(): void {
  prefsReads.clear();
}

function domainValue(
  prefs: UserPreferences | null,
  domain: SyncDomain,
): { value: Json | null; updatedAt: string | null } {
  if (!prefs) return { value: null, updatedAt: null };
  switch (domain) {
    case "appearance":
      return { value: prefs.appearance, updatedAt: prefs.appearanceUpdatedAt };
    case "focus":
      return { value: prefs.focus, updatedAt: prefs.focusUpdatedAt };
    case "calendar":
      return { value: prefs.calendar, updatedAt: prefs.calendarUpdatedAt };
    case "email":
      return { value: prefs.email, updatedAt: prefs.emailUpdatedAt };
    case "preferences":
      return { value: prefs.preferences, updatedAt: prefs.preferencesUpdatedAt };
  }
}

/**
 * What a push came to. The server keeps the newer copy (`prefs_op_set`), so a
 * push can lose to one saved from another device since: `newer` carries it.
 */
export type PushOutcome =
  { kind: "saved" } | { kind: "newer"; value: Json; updatedAt: string } | { kind: "failed" };

/** Push one domain's syncable subset. `failed` when offline / errored / signed out. */
export async function pushDomain(
  domain: SyncDomain,
  value: Json,
  updatedAt: string,
): Promise<PushOutcome> {
  const rt = getRuntime();
  if (!rt) return { kind: "failed" };
  try {
    const res = await rt.preferences.setDomain(domain, value, updatedAt);
    if (res === null) return { kind: "failed" }; // signed out
    // A write changed the shared row — drop the cached read so a later domain's
    // reconcile (or the same domain's next read) sees this domain's fresh value.
    invalidateCloudPrefs();
    const saved = domainValue(res, domain);
    if (saved.value && saved.updatedAt && toMillis(saved.updatedAt) > toMillis(updatedAt)) {
      return { kind: "newer", value: saved.value, updatedAt: saved.updatedAt };
    }
    return { kind: "saved" };
  } catch {
    return { kind: "failed" };
  }
}

/**
 * Reconcile one domain for a signed-in user. Owner-aware last-write-wins:
 *  - cloud belongs to this user → newer of (local, cloud) wins.
 *  - cloud exists but local is anonymous or a *different* prior user → cloud
 *    (the account's saved copy) wins; this prevents one user's local values from
 *    leaking into another's row on a shared browser.
 *  - no cloud row yet → seed from local if it's ours or anonymous (adopting
 *    pre-sign-in edits); otherwise reset to defaults so a new user starts clean.
 *  - the read failed → apply nothing, push nothing, and report `"error"` so the
 *    caller retries later. A failed read must never look like "no row": seeding
 *    then would overwrite the account's real prefs with local or defaults.
 */
export async function reconcileDomain(opts: {
  domain: SyncDomain;
  userId: string;
  localValue: Json;
  defaults: Json;
  sanitizeCloud: (raw: Json) => Json;
  apply: (value: Json, userId: string) => void;
}): Promise<"ok" | "error"> {
  let outcome: "ok" | "error" = "error";
  try {
    outcome = await reconcileOnce(opts);
  } finally {
    // A failed read hasn't read anything: leave the domain unread for this user.
    if (outcome === "ok") markReconciled(opts.domain, opts.userId);
  }
  return outcome;
}

// ── "Read this session" (TV-U17) ──────────────────────────────────────────────
// Something that acts once per person (Tasks' welcome) can't trust the local
// mirror: on a new device it holds defaults until the account's copy arrives.
// A domain counts as read for a user once a reconcile for them has finished
// this session, whichever way it went.

const reconciledFor = new Map<SyncDomain, string>();
const reconciledListeners = new Set<() => void>();

function markReconciled(domain: SyncDomain, userId: string): void {
  if (reconciledFor.get(domain) === userId) return;
  reconciledFor.set(domain, userId);
  for (const listener of reconciledListeners) listener();
}

/** Whether `domain` has been read from the cloud for `userId` this session. */
export function isDomainReconciled(domain: SyncDomain, userId: string | null): boolean {
  return !!userId && reconciledFor.get(domain) === userId;
}

/** Hear when a domain finishes reading for someone (useSyncExternalStore). */
export function subscribeReconciled(listener: () => void): () => void {
  reconciledListeners.add(listener);
  return () => {
    reconciledListeners.delete(listener);
  };
}

/** Test-only: mark a domain read (or forget every domain with `null`). */
export function setDomainReconciledForTest(domain: SyncDomain, userId: string | null): void {
  if (userId === null) reconciledFor.clear();
  else reconciledFor.set(domain, userId);
  for (const listener of reconciledListeners) listener();
}

async function reconcileOnce(opts: {
  domain: SyncDomain;
  userId: string;
  localValue: Json;
  defaults: Json;
  sanitizeCloud: (raw: Json) => Json;
  apply: (value: Json, userId: string) => void;
}): Promise<"ok" | "error"> {
  const { domain, userId, localValue, defaults, sanitizeCloud, apply } = opts;

  const read = await getCloudPrefs(userId);
  if (read.kind === "error") return "error";
  const cloud = read.kind === "row" ? read.prefs : null;
  const { value: cloudRaw, updatedAt: cloudUpdatedAt } = domainValue(cloud, domain);
  // An empty {} domain means "never synced" (e.g. the row was seeded by the
  // other domain) — treat it as absent so local seeds it. The columns are NOT NULL:
  // reset a test account's domain with `'{}'::jsonb`, never NULL (23502).
  const hasCloud = !!cloudRaw && Object.keys(cloudRaw).length > 0 && !!cloudUpdatedAt;

  const meta = getSyncMeta(domain);
  const ownedBySelf = meta.userId === userId;
  const anonymous = meta.userId === null;

  const adoptCloud = (raw: Json, updatedAt: string) => {
    apply(sanitizeCloud(raw), userId);
    setSyncMeta(domain, { userId, updatedAt, dirty: false });
  };
  const push = async (value: Json, updatedAt: string) => {
    const res = await pushDomain(domain, value, updatedAt);
    // Another device saved a newer copy in between: that one stands.
    if (res.kind === "newer") adoptCloud(res.value, res.updatedAt);
    else setSyncMeta(domain, { userId, updatedAt, dirty: res.kind === "failed" });
  };
  const seedFromLocal = (updatedAt: string) => push(localValue, updatedAt);

  if (hasCloud) {
    if (ownedBySelf && toMillis(meta.updatedAt) > toMillis(cloudUpdatedAt)) {
      await seedFromLocal(meta.updatedAt as string); // local newer (offline edits)
    } else {
      adoptCloud(cloudRaw as Json, cloudUpdatedAt as string);
    }
    return "ok";
  }

  // No usable cloud value for this user yet.
  if (ownedBySelf || anonymous) {
    await seedFromLocal(meta.updatedAt ?? nowIso());
  } else {
    // A different prior user's values are in local — don't seed them into this
    // user's fresh row. Reset to defaults and seed those.
    apply(defaults, userId);
    await push(defaults, nowIso());
  }
  return "ok";
}

const RECONCILE_RETRY_BASE_MS = 5_000;
const RECONCILE_RETRY_MAX_MS = 5 * 60_000;

/**
 * Wires a preference domain to the cloud. Reconciles on sign-in / app start and
 * on reconnect, and returns `pushLocalChange` for the hook to call after a
 * *syncable* field changes locally. Local-only fields must NOT call it.
 */
export function useDomainSync(opts: {
  domain: SyncDomain;
  /** Current syncable subset, read live (from a ref) at reconcile time. */
  getLocalSyncable: () => Json;
  /** Syncable subset of the domain defaults (used to reset a new user's row). */
  defaults: Json;
  sanitizeCloud: (raw: Json) => Json;
  /** Merge a cloud-won subset into local state + DOM + mirror. */
  apply: (value: Json, userId: string) => void;
}): { pushLocalChange: (syncable: Json) => void } {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const userIdRef = useRef<string | null>(null);
  const retryRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; attempt: number }>({
    timer: null,
    attempt: 0,
  });

  const runReconcile = useCallback(async (userId: string): Promise<void> => {
    const retry = retryRef.current;
    if (retry.timer) clearTimeout(retry.timer);
    retry.timer = null;
    const o = optsRef.current;
    const outcome = await reconcileDomain({
      domain: o.domain,
      userId,
      localValue: o.getLocalSyncable(),
      defaults: o.defaults,
      sanitizeCloud: o.sanitizeCloud,
      apply: o.apply,
    });
    if (outcome === "ok") {
      retry.attempt = 0;
      return;
    }
    // The read failed: nothing was applied or pushed. Try again later (backing
    // off), as long as the same user is still signed in; `online` also retries.
    const delay = Math.min(RECONCILE_RETRY_BASE_MS * 2 ** retry.attempt, RECONCILE_RETRY_MAX_MS);
    retry.attempt += 1;
    retry.timer = setTimeout(() => {
      retry.timer = null;
      if (userIdRef.current === userId) void runReconcile(userId);
    }, delay);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;
    void initRuntime().then((rt) => {
      if (cancelled) return;
      // Supabase fires INITIAL_SESSION to each new subscriber once the persisted
      // session is restored, so this also covers the first reconcile at startup.
      const sub = rt.auth.onAuthStateChange((event, session) => {
        const uid = session?.user.id ?? null;
        userIdRef.current = uid;
        if (uid && (event === "INITIAL_SESSION" || event === "SIGNED_IN")) {
          void runReconcile(uid);
        }
      });
      unsub = () => sub.data.subscription.unsubscribe();
    });

    const onOnline = () => {
      const uid = userIdRef.current;
      if (uid) void runReconcile(uid);
    };
    if (typeof window !== "undefined") window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      unsub?.();
      if (retryRef.current.timer) clearTimeout(retryRef.current.timer);
      if (typeof window !== "undefined") window.removeEventListener("online", onOnline);
    };
  }, [runReconcile]);

  const pushLocalChange = useCallback((syncable: Json) => {
    const o = optsRef.current;
    const uid = userIdRef.current;
    const updatedAt = nowIso();
    // Stamp meta immediately so a concurrent reconcile sees local as newest.
    // When signed out, keep userId null: these are anonymous edits, adopted into
    // the account on next sign-in (if it has no cloud copy of its own).
    setSyncMeta(o.domain, { userId: uid, updatedAt, dirty: true });
    if (!uid) return;
    void pushDomain(o.domain, syncable, updatedAt).then((res) => {
      // Only settle if no newer local change has happened since this push.
      const m = getSyncMeta(o.domain);
      if (m.updatedAt !== updatedAt) return;
      if (res.kind === "newer") {
        // Another device saved a newer copy (a clock ahead of ours): it stands.
        o.apply(o.sanitizeCloud(res.value), uid);
        setSyncMeta(o.domain, { userId: uid, updatedAt: res.updatedAt, dirty: false });
      } else {
        setSyncMeta(o.domain, { userId: uid, updatedAt, dirty: res.kind === "failed" });
      }
    });
  }, []);

  return { pushLocalChange };
}
