// Day-to-day behaviour preferences (DF-19f). ONE synced domain holds every group:
// default landing view, startup/behaviour, and sounds & motion. (Per-type
// notification toggles join this domain later once DF-9 lands — no migration
// needed, the cloud payload is opaque jsonb.)
//
// Two-layer persistence, mirroring appearance / focus:
//   1. In-app + cross-tab: the canonical value lives in a module-level store read
//      via useSyncExternalStore, so every usePreferences() instance shares it and
//      a `storage` listener folds in writes from other tabs. Imperative readers
//      (the boot landing redirect, the focus-chime sound gate, motion at boot)
//      read the same store synchronously.
//   2. Cross-device: the value round-trips to Supabase `user_preferences.preferences`
//      via prefs-sync.ts (owner-aware last-write-wins), with the localStorage mirror
//      as the instant first-paint + offline cache.
//
// Only `motion` has a DOM surface (the `data-motion` attribute, layered over the OS
// prefers-reduced-motion — see tokens.css); the rest are read by their consumers.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { z } from "zod";
import { useDomainSync } from "./prefs-sync";

export type LandingView = "home" | "tasks" | "calendar" | "notes" | "contacts" | "email" | "last";

/** Motion policy layered over the OS `prefers-reduced-motion` (see tokens.css):
 *  `system` follows the OS, `reduced` forces movement off, `full` forces it on. */
export type MotionPref = "system" | "reduced" | "full";

// ── Per-type notification toggles (DF-19f-notif · DF-21e) ─────────────────────
// The quiet set the bell can surface. Two flavours share one prefs record:
//   • the five MUTES (mention/assigned/completed/dueFollowUp/unblocked) — default ON — are a
//     READ-SIDE filter over the notification feed (workspace-provider + the
//     dashboard Activity widget), keyed on each row's module_activity `op`; no
//     generation change, fully reversible (rows persist; un-muting restores them).
//   • `overdueTasks` (DF-21e) — default OFF, opt-in — is NOT an op-mute. No
//     activity op maps to it; it gates a synthetic, client-computed "overdue"
//     section in the bell (drifted tasks), which is never badged and clears when a
//     task resolves. It lives here (not a fork) so the settings UI + synced domain
//     stay single-source (spec Assumption 7).

// TV-D12 (the notification table, spec §13) adds `comments` (a comment on a
// task you created, own or commented on, split from `mention`, which is now
// "@you" only) and `waiting` ("something you were waiting on came in": an
// unblocked task or a Waiting on… entry that cleared; it replaces
// `unblocked`, whose saved value it takes). Reminders have no switch: "turned
// off by the reminder".
export type NotificationType =
  | "mention"
  | "assigned"
  | "comments"
  | "completed"
  | "dueFollowUp"
  | "waiting"
  | "overdueTasks"
  | "storage";
export type NotificationPrefs = Record<NotificationType, boolean>;

const NOTIFICATION_TYPES: ReadonlyArray<NotificationType> = [
  "mention",
  "assigned",
  "comments",
  "completed",
  "dueFollowUp",
  "waiting",
  "overdueTasks",
  "storage",
];

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  mention: true,
  assigned: true,
  comments: true,
  completed: true,
  dueFollowUp: true,
  waiting: true,
  // Opt-in: overdue work otherwise lives in Tasks/Home, not the bell (AC9).
  overdueTasks: false,
  // Only a workspace owner ever gets these (AT-1: the pool passed 80% / 95%).
  storage: true,
};

/** module_activity `op` → the quiet-set toggle that governs it. An op absent from
 *  this map (legacy workspace invite/membership, `overdueTasks` which has no op at
 *  all, any future type) has no toggle and is NEVER muted — mutes are opt-in per
 *  known type. `comments.add` reaches the feed as an @mention-to-me OR a comment on
 *  your entity (DF-21d), both governed by `mention`; the two `email.*_due` ops
 *  share the `dueFollowUp` toggle. */
const OP_TO_NOTIFICATION_TYPE: Record<string, NotificationType> = {
  "comments.add": "comments",
  // TV-U13: an edit only reaches the people it newly names, so it's a mention.
  "comments.edit": "mention",
  "notes.mention": "mention",
  "tasks.mentioned": "mention",
  "tasks.assigned": "assigned",
  // Tasks handed into your Inbox (a project deleted, REPLAN 20a / U6-2).
  "tasks.project_deleted": "assigned",
  "tasks.completed": "completed",
  "email.snooze_due": "dueFollowUp",
  "email.follow_up_due": "dueFollowUp",
  "tasks.unblocked": "waiting",
  "tasks.waiting_resolved": "waiting",
  "attachments.storage_80": "storage",
  "attachments.storage_95": "storage",
};

/** The switch that governs a feed row. A comment that names you is a
 *  mention; any other comment notice is "comments". */
export function notificationTypeForOp(
  op: string,
  payload?: Record<string, unknown> | null,
  userId?: string | null,
): NotificationType | null {
  if (op === "comments.add" && userId && payload) {
    const named = payload.mentioned_user_ids;
    if (Array.isArray(named) && named.includes(userId)) return "mention";
  }
  return OP_TO_NOTIFICATION_TYPE[op] ?? null;
}

/** Whether a feed row of this `op` is visible under these prefs. Unmapped ops
 *  (a reminder, legacy types) fail OPEN (always shown) so nothing unknown is
 *  silently hidden. */
export function isNotificationEnabled(
  op: string,
  prefs: NotificationPrefs,
  payload?: Record<string, unknown> | null,
  userId?: string | null,
): boolean {
  const type = notificationTypeForOp(op, payload, userId);
  return type === null ? true : prefs[type];
}

/** The Tasks sidebar rows Customize sidebar can hide (REPLAN 29a; the Inbox
 *  always shows). */
export const TASKS_SIDEBAR_HIDEABLE = ["focus", "upcoming", "mine", "all"] as const;
export type TasksSidebarHideable = (typeof TASKS_SIDEBAR_HIDEABLE)[number];

/** A person's Tasks sidebar (TV-U6): the rows they hid, and what they pinned
 *  in each workspace (project ids, in pin order; REPLAN 29b). */
export interface TasksSidebarPrefs {
  hidden: TasksSidebarHideable[];
  pinned: Record<string, string[]>;
}

/**
 * One snoozed Inbox task (TV-U15, the triage key H): hidden until `until`
 * (a day, "2026-10-20"), or until its comments move past `stamp` (the
 * task's comment stamp when it was snoozed).
 */
export interface TasksInboxSnooze {
  until: string;
  stamp: string | null;
}

/** A person's Inbox triage state (TV-U15): what they snoozed, per workspace and task. */
export interface TasksInboxPrefs {
  snoozed: Record<string, Record<string, TasksInboxSnooze>>;
}

export interface Preferences {
  /** Which surface opens on launch. `last` = the last visited module route. */
  landingView: LandingView;
  /** Reopen the workspace you last had selected (vs. defaulting to the first). */
  reopenLastWorkspace: boolean;
  /** Master switch for app sound effects (today: the Focus interval chime). */
  soundEnabled: boolean;
  /** Reduce-motion override, layered on the OS setting. */
  motion: MotionPref;
  /** Per-type notification mutes (read-side filter over the bell feed). */
  notifications: NotificationPrefs;
  /** Desktop-only: confirm before quitting. Both quit gestures (⌘Q via a custom Quit
   *  menu item, and window close via `CloseRequested`) are intercepted natively in Rust,
   *  which reads this value from `AppState` — mirrored there by the `set_confirm_before_quit`
   *  command. See src/lib/confirm-before-quit.ts + src-tauri/src/lib.rs. */
  confirmBeforeQuit: boolean;
  /** Desktop-only: closing the window keeps Moduo running in the menu bar, so
   *  reminders still arrive (TV-D12, REPLAN 73; on by default). Mirrored into Rust
   *  by `set_keep_in_menu_bar` (src/lib/keep-in-menu-bar.ts). */
  keepInMenuBar: boolean;
  /** The Tasks sidebar's Customize and Pin choices (TV-U6), following the person. */
  tasksSidebar: TasksSidebarPrefs;
  /** Snoozed Inbox tasks (TV-U15), following the person. */
  tasksInbox: TasksInboxPrefs;
}

export const DEFAULT_PREFERENCES: Preferences = {
  landingView: "home",
  reopenLastWorkspace: true,
  soundEnabled: true,
  motion: "system",
  notifications: { ...DEFAULT_NOTIFICATION_PREFS },
  confirmBeforeQuit: false,
  keepInMenuBar: true,
  tasksSidebar: { hidden: [], pinned: {} },
  tasksInbox: { snoozed: {} },
};

const LOCAL_STORAGE_KEY = "moduo.preferences";
const LAST_ROUTE_KEY = "moduo.lastRoute";

const LANDING_VIEWS = ["home", "tasks", "calendar", "notes", "contacts", "email", "last"] as const;
const MOTION_PREFS = ["system", "reduced", "full"] as const;

const notificationPrefsSchema = z
  .preprocess(
    (raw) => {
      // `unblocked` became `waiting` (TV-D12): carry a saved choice over.
      if (raw && typeof raw === "object" && !("waiting" in raw) && "unblocked" in raw) {
        return {
          ...(raw as Record<string, unknown>),
          waiting: (raw as { unblocked: unknown }).unblocked,
        };
      }
      return raw;
    },
    z.object({
      mention: z.boolean().catch(true),
      assigned: z.boolean().catch(true),
      comments: z.boolean().catch(true),
      completed: z.boolean().catch(true),
      dueFollowUp: z.boolean().catch(true),
      waiting: z.boolean().catch(true),
      overdueTasks: z.boolean().catch(false),
      storage: z.boolean().catch(true),
    }),
  )
  .catch({ ...DEFAULT_NOTIFICATION_PREFS });
// A bad entry drops alone; a workspace keeps at most 50 pins.
const tasksSidebarSchema = z
  .object({
    hidden: z
      .array(z.unknown())
      .catch([])
      .transform((list) => [
        ...new Set(
          list.filter((v): v is TasksSidebarHideable =>
            (TASKS_SIDEBAR_HIDEABLE as readonly unknown[]).includes(v),
          ),
        ),
      ]),
    pinned: z
      .record(z.string(), z.unknown())
      .catch({})
      .transform((byWs) => {
        const out: Record<string, string[]> = {};
        for (const [ws, ids] of Object.entries(byWs)) {
          if (!Array.isArray(ids)) continue;
          const clean = [
            ...new Set(ids.filter((id): id is string => typeof id === "string" && id !== "")),
          ].slice(0, 50);
          if (clean.length > 0) out[ws] = clean;
        }
        return out;
      }),
  })
  .catch({ hidden: [], pinned: {} });
// A bad entry drops alone; a workspace keeps at most 500 snoozed tasks.
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const tasksInboxSchema = z
  .object({
    snoozed: z
      .record(z.string(), z.unknown())
      .catch({})
      .transform((byWs) => {
        const out: Record<string, Record<string, TasksInboxSnooze>> = {};
        for (const [ws, entries] of Object.entries(byWs)) {
          if (!entries || typeof entries !== "object" || Array.isArray(entries)) continue;
          const clean: Record<string, TasksInboxSnooze> = {};
          for (const [taskId, raw] of Object.entries(entries).slice(0, 500)) {
            const entry = raw as Partial<TasksInboxSnooze> | null;
            if (!taskId || !entry || typeof entry.until !== "string" || !DAY_KEY.test(entry.until))
              continue;
            clean[taskId] = {
              until: entry.until,
              stamp: typeof entry.stamp === "string" ? entry.stamp : null,
            };
          }
          if (Object.keys(clean).length > 0) out[ws] = clean;
        }
        return out;
      }),
  })
  .catch({ snoozed: {} });
const preferencesSchema = z.object({
  landingView: z.enum(LANDING_VIEWS).catch(DEFAULT_PREFERENCES.landingView),
  reopenLastWorkspace: z.boolean().catch(DEFAULT_PREFERENCES.reopenLastWorkspace),
  soundEnabled: z.boolean().catch(DEFAULT_PREFERENCES.soundEnabled),
  motion: z.enum(MOTION_PREFS).catch(DEFAULT_PREFERENCES.motion),
  notifications: notificationPrefsSchema,
  confirmBeforeQuit: z.boolean().catch(DEFAULT_PREFERENCES.confirmBeforeQuit),
  keepInMenuBar: z.boolean().catch(DEFAULT_PREFERENCES.keepInMenuBar),
  tasksSidebar: tasksSidebarSchema,
  tasksInbox: tasksInboxSchema,
});

export function sanitizeNotificationPrefs(raw: unknown): NotificationPrefs {
  return notificationPrefsSchema.parse(raw && typeof raw === "object" ? raw : {});
}

export function sanitizePreferences(raw: unknown): Preferences {
  return preferencesSchema.parse(raw && typeof raw === "object" ? raw : {});
}

/** Top-level module routes the app can land on (and remember as "last used").
 *  Hidden/utility routes (/mindmap, /settings, /onboarding…) are intentionally
 *  excluded — landing on them would be surprising. */
const LANDABLE_ROUTES: ReadonlyArray<string> = [
  "/",
  "/tasks",
  "/calendar",
  "/notes",
  "/contacts",
  "/email",
];

/** landingView (excluding home/last) → its route. */
const VIEW_ROUTES: Record<Exclude<LandingView, "home" | "last">, string> = {
  tasks: "/tasks",
  calendar: "/calendar",
  notes: "/notes",
  contacts: "/contacts",
  email: "/email",
};

export function isLandableRoute(pathname: string): boolean {
  return LANDABLE_ROUTES.includes(pathname);
}

// ── Sanitize / read / mirror ──────────────────────────────────────────────────

export function readLocalPreferences(): Preferences {
  if (typeof localStorage === "undefined") return { ...DEFAULT_PREFERENCES };
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    return sanitizePreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

function writeLocalMirror(prefs: Preferences): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota exceeded or storage disabled — non-fatal */
  }
}

// ── Motion (the only DOM-applied field) ───────────────────────────────────────

/** Apply the motion override to <html> as `data-motion`. tokens.css reads it to
 *  layer over the OS `prefers-reduced-motion`. Called at boot (main.tsx) and on
 *  every change (local edit or cloud win). */
export function applyMotion(motion: MotionPref): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-motion", motion);
}

// ── Landing view resolution (pure) ────────────────────────────────────────────

/**
 * The route to redirect to on launch for a given landing preference, or `null`
 * to stay on Home ("/"). Pure — the one-shot/guard wiring lives in
 * `consumeLandingRedirect`.
 *
 *  - `home`  → null (Home is "/").
 *  - `last`  → the remembered route if it's a real, non-home module route, else null.
 *  - module  → that module's route.
 */
export function resolveLandingRoute(
  landingView: LandingView,
  lastRoute: string | null,
): string | null {
  if (landingView === "home") return null;
  if (landingView === "last") {
    return lastRoute && LANDABLE_ROUTES.includes(lastRoute) && lastRoute !== "/" ? lastRoute : null;
  }
  const target = VIEW_ROUTES[landingView];
  return target ?? null;
}

/** Remember the current top-level route so `landingView: "last"` can restore it.
 *  Only the landable module routes are stored; utility routes are ignored. */
export function writeLastRoute(pathname: string): void {
  if (typeof localStorage === "undefined") return;
  if (!LANDABLE_ROUTES.includes(pathname)) return;
  try {
    localStorage.setItem(LAST_ROUTE_KEY, pathname);
  } catch {
    /* non-fatal */
  }
}

export function readLastRoute(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const v = localStorage.getItem(LAST_ROUTE_KEY);
    return v && LANDABLE_ROUTES.includes(v) ? v : null;
  } catch {
    return null;
  }
}

// A persisted Supabase auth session lives under `sb-<project-ref>-auth-token` (the
// default storage key — the client is created with no custom storageKey). We sniff
// it synchronously so the boot redirect only fires for a signed-in launch. Failure
// modes are both benign: a false negative just skips the redirect this launch (user
// sees Home); a false positive redirects then the app-gate bounces to /auth.
function hasPersistedAuthSession(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sb-") && k.endsWith("-auth-token")) {
        const v = localStorage.getItem(k);
        if (v && v !== "null" && v !== "undefined") return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

// One-shot per app load: the landing preference applies once, on the first
// authenticated arrival at "/". Subsequent in-app navigations to Home are user
// intent and must never redirect. Not consumed until a session is present, so a
// signed-out first visit (redirected to /auth) doesn't burn the shot before login.
let landingConsumed = false;

/** Reset the one-shot — test-only seam. */
export function resetLandingRedirectForTest(): void {
  landingConsumed = false;
}

/**
 * Resolve the boot landing redirect for the current location, consuming the
 * one-shot. Returns a route to redirect to, or null to stay put. Explicit
 * deep-links win: any query string at "/" (e.g. `?section=…`) is treated as
 * intentional and skips the redirect; non-"/" paths are never touched here.
 */
export function consumeLandingRedirect(pathname: string, searchStr: string): string | null {
  if (landingConsumed) return null;
  if (pathname !== "/") return null;
  // Any query params at "/" = an explicit deep link (e.g. a settings section) — honour it.
  if (searchStr && searchStr.replace(/^\?/, "") !== "") return null;
  if (!hasPersistedAuthSession()) return null; // pre-auth — wait for the post-login "/"
  landingConsumed = true;
  const prefs = readLocalPreferences();
  return resolveLandingRoute(prefs.landingView, readLastRoute());
}

// ── Imperative reads for non-React consumers ──────────────────────────────────

/** Master sound gate, read imperatively by the Focus chime (features/focus/phase-alert). */
export function areSoundsEnabled(): boolean {
  return store.soundEnabled;
}

// ── Shared module store (mirrors focus-prefs) ─────────────────────────────────

let store: Preferences = readLocalPreferences();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setStore(next: Preferences): void {
  store = next;
  emit();
}

function getSnapshot(): Preferences {
  return store;
}

function handleStorage(event: StorageEvent): void {
  // A cross-tab write to our key (or a localStorage.clear(), key === null).
  if (event.key !== null && event.key !== LOCAL_STORAGE_KEY) return;
  store = readLocalPreferences();
  applyMotion(store.motion);
  emit();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

// A change made outside Settings (the Tasks sidebar's Customize and Pin)
// reaches the cloud through the one mounted sync owner (<PreferencesSync/>),
// never a second reconcile loop (gotchas/supabase.md, Prefs sync).
const localPushers = new Set<(next: Preferences) => void>();

/** Change preferences from anywhere (not only Settings): the shared store,
 *  the local mirror and, through the sync owner, the cloud. */
export function updatePreferences(patch: Partial<Preferences>): void {
  const next = sanitizePreferences({ ...store, ...patch });
  setStore(next);
  writeLocalMirror(next);
  applyMotion(next.motion);
  const [push] = localPushers;
  push?.(next);
}

export interface UsePreferences {
  preferences: Preferences;
  setPreferences: (patch: Partial<Preferences>) => void;
  reset: () => void;
}

/** Read the shared preferences store reactively, WITHOUT wiring the cross-device
 *  sync engine. For non-settings consumers (the notification-feed filter in
 *  workspace-provider + the dashboard Activity widget) that must react to a local
 *  toggle but must NOT spin a second reconcile loop — cross-device sync is owned
 *  by the single <PreferencesSync/> in main.tsx. */
export function usePreferencesValue(): Preferences {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function usePreferences(opts?: {
  /** The one app-wide instance that also pushes `updatePreferences` changes. */
  syncOwner?: boolean;
}): UsePreferences {
  const preferences = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // A value won from the cloud (another device) lands in the shared store, so every
  // mounted instance re-renders; keep the localStorage mirror + DOM warm too.
  const applyFromCloud = useCallback((value: Record<string, unknown>) => {
    const next = sanitizePreferences(value);
    setStore(next);
    writeLocalMirror(next);
    applyMotion(next.motion);
  }, []);

  // Every field syncs, so the cloud blob IS the full prefs object (the shared store).
  const { pushLocalChange } = useDomainSync({
    domain: "preferences",
    getLocalSyncable: () => store as unknown as Record<string, unknown>,
    defaults: DEFAULT_PREFERENCES as unknown as Record<string, unknown>,
    sanitizeCloud: (raw) => sanitizePreferences(raw) as unknown as Record<string, unknown>,
    apply: applyFromCloud,
  });

  const syncOwner = opts?.syncOwner ?? false;
  useEffect(() => {
    if (!syncOwner) return;
    const push = (next: Preferences) => pushLocalChange(next as unknown as Record<string, unknown>);
    localPushers.add(push);
    return () => {
      localPushers.delete(push);
    };
  }, [syncOwner, pushLocalChange]);

  const update = useCallback(
    (patch: Partial<Preferences>) => {
      const next = sanitizePreferences({ ...store, ...patch });
      setStore(next);
      writeLocalMirror(next);
      applyMotion(next.motion);
      pushLocalChange(next as unknown as Record<string, unknown>);
    },
    [pushLocalChange],
  );

  return {
    preferences,
    setPreferences: update,
    reset: () => update(DEFAULT_PREFERENCES),
  };
}
