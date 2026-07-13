// Quiet, grouped notifications (specs/connective-tissue.md AC10). A notification
// is a derived view over `module_activity` rows that target the user, overlaid
// with per-user read state. This is the pure reducer the NotificationCenter
// renders: it collapses N raw rows into target→verb cards (digest-default — no
// per-event wall), derives unread/read from the read mark, and exposes a deep-
// link target for each card. Never a red wall (Experience Principle 3).

import { spineActivityLine, spineActorName, type SpineActorFields } from "./activity";

/**
 * One normalized notification row — the shape both the spine feed
 * (notifications_list) and the legacy workspace feed map into, so the reducer is
 * source-agnostic.
 */
export type NotificationItem = SpineActorFields & {
  id: string;
  /**
   * Which feed produced this row — routes mark-read to the right op (the spine
   * activity-id op vs the legacy workspace op). The reducer is source-agnostic;
   * only mark-read cares.
   */
  source: "workspace" | "spine";
  /** Workspace the row belongs to (scope filtering + spine mark-read). */
  workspaceId: string | null;
  /** The entity the notification is about (drives grouping + deep-link). */
  targetType: string | null;
  targetId: string | null;
  /** Intent-op name (e.g. "comments.add") OR a legacy workspace event type. */
  op: string;
  payload: Record<string, unknown>;
  createdAt: string;
  /** null ⇒ unread. */
  readAt: string | null;
};

/**
 * A digest card: all the rows for one (target, verb) pair, newest first. The
 * count is how many raw events collapsed into it; `unreadCount` drives the dot.
 */
export type NotificationGroup = {
  /** Stable key: `${targetType}:${targetId}#${op}`. */
  key: string;
  targetType: string | null;
  targetId: string | null;
  op: string;
  items: NotificationItem[];
  count: number;
  unreadCount: number;
  /** Most-recent createdAt across the group (ISO). */
  latestAt: string;
  /** All distinct actor ids in the group (for "You and 2 others"). */
  actorIds: string[];
};

function groupKey(item: NotificationItem): string {
  return `${item.targetType ?? "?"}:${item.targetId ?? "?"}#${item.op}`;
}

/**
 * Collapse raw rows into target→verb cards, newest first. Digest-default: many
 * comments on one entity become ONE card with a count, not N interrupts.
 */
export function groupNotifications(items: NotificationItem[]): NotificationGroup[] {
  const byKey = new Map<string, NotificationGroup>();
  for (const item of items) {
    const key = groupKey(item);
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        targetType: item.targetType,
        targetId: item.targetId,
        op: item.op,
        items: [],
        count: 0,
        unreadCount: 0,
        latestAt: item.createdAt,
        actorIds: [],
      };
      byKey.set(key, g);
    }
    g.items.push(item);
    g.count += 1;
    if (!item.readAt) g.unreadCount += 1;
    if (item.createdAt > g.latestAt) g.latestAt = item.createdAt;
    if (item.actorId && !g.actorIds.includes(item.actorId)) g.actorIds.push(item.actorId);
  }
  return [...byKey.values()].sort((a, b) => (a.latestAt < b.latestAt ? 1 : a.latestAt > b.latestAt ? -1 : 0));
}

/** Total unread across a feed (the bell badge). */
export function unreadCount(items: NotificationItem[]): number {
  return items.reduce((n, item) => (item.readAt ? n : n + 1), 0);
}

/**
 * Humanize a verb a spine op doesn't recognize (a legacy workspace event type
 * like "note_shared" or "workspace.invite_accepted") into plain English. Never
 * raw JSON, never a snake_case token.
 */
function humanizeVerb(op: string): string {
  const tail = op.includes(".") ? op.slice(op.lastIndexOf(".") + 1) : op;
  return tail.replace(/[_-]+/g, " ").trim() || op;
}

/**
 * The card's human sentence: "<Actor>[ and N others] <verb>". The verb comes
 * from the spine activity vocabulary; an unrecognized op (e.g. a legacy
 * workspace event) is humanized instead of shown raw. The actor resolves to
 * You / a name / a quiet fallback. Never raw JSON.
 */
export function notificationSummary(group: NotificationGroup, currentUserId: string | null): string {
  const latest = group.items.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
  const actor = spineActorName(latest, currentUserId);
  const verbRaw = spineActivityLine(latest);
  const verb = verbRaw === latest.op ? humanizeVerb(latest.op) : verbRaw;
  const others = Math.max(0, group.actorIds.length - 1);
  const who = others > 0 ? `${actor} and ${others} ${others === 1 ? "other" : "others"}` : actor;
  return `${who} ${verb}`;
}

/** A deep-link target for a card, or null when the type isn't routable yet. */
export type NotificationDeepLink = { route: string; entityType: string; entityId: string };

const ROUTE_BY_TYPE: Record<string, string> = {
  task: "/tasks",
  contact: "/contacts",
  company: "/contacts",
  note: "/notes",
  event: "/calendar",
  // Email snooze-due / follow-up-due activity logs entity_type='email_thread'
  // (DF-9). The entity-open host resolves 'email_thread' → /email?thread=<id>
  // (DF-2), so passing this entityType through deep-links the thread, not a
  // dead-end inbox.
  email_thread: "/email",
};

/**
 * A friendly noun for a deep-link target type, for the "· opens …" card hint.
 * Most types read fine raw ("task", "contact"); this only rewrites the ugly
 * ones (email_thread → "email"). Falls back to the raw type.
 */
const DEEP_LINK_NOUN: Record<string, string> = {
  email_thread: "email",
};

export function notificationDeepLinkNoun(entityType: string): string {
  return DEEP_LINK_NOUN[entityType] ?? entityType;
}

/** Resolve where clicking a card should navigate (best-effort by entity type). */
export function notificationDeepLink(group: NotificationGroup): NotificationDeepLink | null {
  if (!group.targetType || !group.targetId) return null;
  const route = ROUTE_BY_TYPE[group.targetType];
  if (!route) return null;
  return { route, entityType: group.targetType, entityId: group.targetId };
}

// ── Preference taxonomy (DF-21) ──────────────────────────────────────────────
// The user-facing categories a notification can be muted by. This is the SHARED
// contract with DF-19f: the settings toggles write `preferences.notifications.
// <key>: boolean`; the bell reads it and hides a muted category. DF-21 only
// READS — an absent key (or an unclassifiable row) always shows (graceful
// degrade), so the bell never lies by silently swallowing something it can't map.

/** A muteable notification category. `overdueTasks` is opt-IN (default off, DF-21e). */
export type NotificationPrefKey =
  | "mentions"
  | "assigned"
  | "unblocked"
  | "emailDue"
  | "comments"
  | "invites";

/** Per-category on/off; every key optional. Absent ⇒ shown (event) / hidden (overdueTasks, opt-in). */
export type NotificationPrefs = Partial<Record<NotificationPrefKey | "overdueTasks", boolean>>;

/** Email due-reminder ops (self-notifications via notify_user_ids). */
const EMAIL_DUE_OPS = new Set(["email.snooze_due", "email.follow_up_due"]);

function payloadUserIds(payload: Record<string, unknown>, key: string): string[] {
  const raw = payload[key];
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Classify a notification into its preference category, or null when it isn't
 * gated by a toggle (unknown/legacy op → always shown). `comments.add` is
 * ambiguous by op alone — it is an @mention when the current user is in
 * `mentioned_user_ids`, otherwise a comment-on-your-entity (DF-21d) via
 * `notify_user_ids` — so the split needs the current user id.
 */
export function notificationPrefKey(item: NotificationItem, currentUserId: string | null): NotificationPrefKey | null {
  if (item.source === "workspace") return "invites"; // legacy invite / membership feed
  switch (item.op) {
    case "tasks.assigned":
      return "assigned";
    case "tasks.unblocked":
      return "unblocked";
  }
  if (EMAIL_DUE_OPS.has(item.op)) return "emailDue";
  if (currentUserId) {
    if (payloadUserIds(item.payload, "mentioned_user_ids").includes(currentUserId)) return "mentions";
    if (payloadUserIds(item.payload, "notify_user_ids").includes(currentUserId)) return "comments";
  }
  return null; // unclassified → not gated → always shown
}

/** Is this notification enabled under the user's prefs? Unclassified / absent key ⇒ shown. */
export function isNotificationEnabled(
  item: NotificationItem,
  prefs: NotificationPrefs,
  currentUserId: string | null,
): boolean {
  const key = notificationPrefKey(item, currentUserId);
  if (!key) return true;
  return prefs[key] !== false;
}

/** Drop notifications whose category the user has muted (pure; graceful — unknown rows pass). */
export function filterNotificationsByPrefs(
  items: NotificationItem[],
  prefs: NotificationPrefs,
  currentUserId: string | null,
): NotificationItem[] {
  return items.filter((item) => isNotificationEnabled(item, prefs, currentUserId));
}

/**
 * Scope the event feed to one workspace (AC3 — no unrelated-workspace noise). A
 * null workspace (pre-selection boot) returns the input untouched so the feed
 * isn't emptied before a workspace resolves.
 */
export function notificationsForWorkspace(items: NotificationItem[], workspaceId: string | null): NotificationItem[] {
  if (!workspaceId) return items;
  return items.filter((item) => item.workspaceId === workspaceId);
}

/** The unread badge is capped so a busy feed never renders a 3-digit count. */
export const NOTIFICATION_BADGE_CAP = 99;

/** The bell badge: unread events only, capped (AC11). Read/dismissed never count. */
export function notificationBadgeCount(items: NotificationItem[]): number {
  return Math.min(unreadCount(items), NOTIFICATION_BADGE_CAP);
}
