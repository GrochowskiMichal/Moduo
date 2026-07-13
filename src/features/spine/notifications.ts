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
