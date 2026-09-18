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
// Reconciliation is owner-aware last-write-wins per domain. Timestamps are
// compared numerically (Date.parse) because Postgres echoes timestamptz back in
// a different textual format than the client writes — never compare them as
// strings. The desktop offline-lite build can later wrap pushDomain with a
// durable queue; the dirty flag + the `online` listener are the seam for that.

import { useCallback, useEffect, useRef } from "react";
import { z } from "zod";
import { createRequestCache } from "./request-cache";
import { getRuntime, initRuntime } from "./runtime";
import type { UserPreferences } from "./runtime.types";

export type SyncDomain = "appearance" | "focus" | "calendar" | "email" | "preferences";

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

export function getCloudPrefs(userId: string): Promise<UserPreferences | null> {
  return prefsReads
    .read(
      `prefs:${userId}`,
      async () => {
        const rt = await initRuntime();
        return await rt.preferences.get(); // throws on a real read error → not cached
      },
      PREFS_CACHE_TTL_MS,
    )
    .catch(() => null);
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

/** Push one domain's syncable subset. Returns false when offline / errored / signed out. */
export async function pushDomain(
  domain: SyncDomain,
  value: Json,
  updatedAt: string,
): Promise<boolean> {
  const rt = getRuntime();
  if (!rt) return false;
  try {
    const patch =
      domain === "appearance"
        ? { appearance: value, appearanceUpdatedAt: updatedAt }
        : domain === "focus"
          ? { focus: value, focusUpdatedAt: updatedAt }
          : domain === "calendar"
            ? { calendar: value, calendarUpdatedAt: updatedAt }
            : domain === "email"
              ? { email: value, emailUpdatedAt: updatedAt }
              : { preferences: value, preferencesUpdatedAt: updatedAt };
    const res = await rt.preferences.set(patch);
    // A write changed the shared row — drop the cached read so a later domain's
    // reconcile (or the same domain's next read) sees this domain's fresh value.
    if (res !== null) invalidateCloudPrefs();
    return res !== null; // null = signed out
  } catch {
    return false;
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
 */
export async function reconcileDomain(opts: {
  domain: SyncDomain;
  userId: string;
  localValue: Json;
  defaults: Json;
  sanitizeCloud: (raw: Json) => Json;
  apply: (value: Json) => void;
}): Promise<void> {
  const { domain, userId, localValue, defaults, sanitizeCloud, apply } = opts;

  const cloud = await getCloudPrefs(userId);
  const { value: cloudRaw, updatedAt: cloudUpdatedAt } = domainValue(cloud, domain);
  // An empty {} domain means "never synced" (e.g. the row was seeded by the
  // other domain) — treat it as absent so local seeds it.
  const hasCloud = !!cloudRaw && Object.keys(cloudRaw).length > 0 && !!cloudUpdatedAt;

  const meta = getSyncMeta(domain);
  const ownedBySelf = meta.userId === userId;
  const anonymous = meta.userId === null;

  const seedFromLocal = async (updatedAt: string) => {
    const ok = await pushDomain(domain, localValue, updatedAt);
    setSyncMeta(domain, { userId, updatedAt, dirty: !ok });
  };
  const adoptCloud = (raw: Json, updatedAt: string) => {
    apply(sanitizeCloud(raw));
    setSyncMeta(domain, { userId, updatedAt, dirty: false });
  };

  if (hasCloud) {
    if (ownedBySelf && toMillis(meta.updatedAt) > toMillis(cloudUpdatedAt)) {
      await seedFromLocal(meta.updatedAt as string); // local newer (offline edits)
    } else {
      adoptCloud(cloudRaw as Json, cloudUpdatedAt as string);
    }
    return;
  }

  // No usable cloud value for this user yet.
  if (ownedBySelf || anonymous) {
    await seedFromLocal(meta.updatedAt ?? nowIso());
  } else {
    // A different prior user's values are in local — don't seed them into this
    // user's fresh row. Reset to defaults and seed those.
    const updatedAt = nowIso();
    apply(defaults);
    const ok = await pushDomain(domain, defaults, updatedAt);
    setSyncMeta(domain, { userId, updatedAt, dirty: !ok });
  }
}

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
  apply: (value: Json) => void;
}): { pushLocalChange: (syncable: Json) => void } {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const userIdRef = useRef<string | null>(null);

  const runReconcile = useCallback((userId: string) => {
    const o = optsRef.current;
    return reconcileDomain({
      domain: o.domain,
      userId,
      localValue: o.getLocalSyncable(),
      defaults: o.defaults,
      sanitizeCloud: o.sanitizeCloud,
      apply: o.apply,
    });
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
    void pushDomain(o.domain, syncable, updatedAt).then((ok) => {
      // Only clear dirty if no newer local change has happened since this push.
      const m = getSyncMeta(o.domain);
      if (m.updatedAt === updatedAt) setSyncMeta(o.domain, { userId: uid, updatedAt, dirty: !ok });
    });
  }, []);

  return { pushLocalChange };
}
