// Quiet, grouped notifications (specs/connective-tissue.md AC10). A notification
// is a derived view over `module_activity` rows that target the user, overlaid
// with per-user read state. This is the pure reducer the NotificationCenter
// renders: it collapses N raw rows into target→verb cards (digest-default — no
// per-event wall), derives unread/read from the read mark, and exposes a deep-
// link target for each card. Never a red wall (Experience Principle 3).

import { type SpineActorFields, spineActivityLine, spineActorName } from "./activity";
import { referencesInText } from "./references/text";
import type { ReferenceRef } from "./references/types";

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
  /**
   * null ⇒ active. A dismissed row leaves the active bell feed but stays in
   * history (DF-21b). Orthogonal to readAt — dismiss never sets readAt, so Undo
   * restores the prior read/unread state.
   */
  dismissedAt: string | null;
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
  return [...byKey.values()].sort((a, b) =>
    a.latestAt < b.latestAt ? 1 : a.latestAt > b.latestAt ? -1 : 0,
  );
}

/** Total unread across a feed (the bell badge). */
export function unreadCount(items: NotificationItem[]): number {
  return items.reduce((n, item) => (item.readAt ? n : n + 1), 0);
}

/**
 * The active feed: rows the user hasn't dismissed (DF-21b). The bell renders +
 * badges these; dismissed rows drop out here and live on only in history. Undo
 * (clear dismissedAt) returns a row to this set in its prior read/unread state.
 */
export function activeNotifications(items: NotificationItem[]): NotificationItem[] {
  return items.filter((item) => !item.dismissedAt);
}

/**
 * Split the merged feed by source (DF-21c): `spine` = the cross-module event feed
 * (workspace-scoped, dismissable), `workspace` = the legacy invite/membership feed
 * (inherently cross-workspace) that surfaces in its own Invitations area, never
 * mixed into the event feed.
 */
export function partitionBySource(items: NotificationItem[]): {
  spine: NotificationItem[];
  workspace: NotificationItem[];
} {
  const spine: NotificationItem[] = [];
  const workspace: NotificationItem[] = [];
  for (const item of items) {
    (item.source === "spine" ? spine : workspace).push(item);
  }
  return { spine, workspace };
}

/** The three feeds the bell derives from one raw fetch, plus the badge count. */
export type NotificationFeeds = {
  /** Current-workspace spine events, muted types out, dismissed out — the dropdown. */
  active: NotificationItem[];
  /** Same, but keeping read + dismissed — the "See all" history modal (AC2). */
  history: NotificationItem[];
  /** Legacy invite/membership feed (cross-workspace) — the Invitations area (AC4). */
  invitations: NotificationItem[];
  /**
   * The bell badge (AC11): unread current-workspace events PLUS unread
   * invitations. Invitations DO nudge the badge (designer call 2026-07-13) —
   * rare, but being added to a workspace should be noticeable. Dismissed / read /
   * muted rows never count.
   */
  unreadCount: number;
};

/**
 * The single source of truth for how the raw merged feed splits into the bell's
 * three surfaces (DF-21). Kept pure so the whole composition is unit-tested (the
 * provider just wires `rawNotifications` + the DF-19f pref predicate in): spine
 * events are scoped to the current workspace and pref-gated (`isEnabled`), then
 * `history` keeps read + dismissed while `active` drops dismissed; the legacy
 * feed becomes `invitations` (never mixed in, never badged).
 */
export function deriveNotificationFeeds(
  items: NotificationItem[],
  opts: { workspaceId: string | null; isEnabled: (op: string) => boolean },
): NotificationFeeds {
  const { spine, workspace } = partitionBySource(items);
  const wsEvents = spine.filter(
    (item) => item.workspaceId === opts.workspaceId && opts.isEnabled(item.op),
  );
  const active = activeNotifications(wsEvents);
  return {
    active,
    history: wsEvents,
    invitations: workspace,
    // Events + invitations both nudge the badge; only invitations are cross-ws.
    unreadCount: unreadCount(active) + unreadCount(workspace),
  };
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

function newestItem(group: NotificationGroup): NotificationItem {
  return group.items.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
}

/**
 * The task a card is about, by name (TV-P0, tasks-v3 AC1.7): the title its
 * event carried (the assigned / completed / unblocked notices store it), else a
 * label the caller resolved for the target (`labels`, keyed by target id — a
 * comment's notice carries only an excerpt). Null when neither is known, or
 * when the card isn't about a task.
 */
export function notificationSubject(
  group: NotificationGroup,
  labels?: ReadonlyMap<string, string>,
): string | null {
  if (group.targetType !== "task") return null;
  const title = newestItem(group).payload.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  const label = group.targetId ? labels?.get(group.targetId)?.trim() : "";
  return label || null;
}

/**
 * Name the item in a verb line: "assigned this to you" → "assigned “Brief” to
 * you". Only the vocabulary's own "this" is replaced, never one inside quoted
 * user text (a comment excerpt, a blocker's title).
 */
function nameTheItem(verb: string, subject: string): string {
  const named = `“${subject}”`;
  if (verb.startsWith("commented: ")) return verb.replace("commented: ", `commented on ${named}: `);
  if (verb === "left a comment") return `left a comment on ${named}`;
  // Split into vocabulary and quoted runs; quoted runs (odd indexes) stay as typed.
  const runs = verb.split(/(“[^”]*”)/);
  for (let i = 0; i < runs.length; i += 2) {
    if (/\bthis\b/.test(runs[i])) {
      runs[i] = runs[i].replace(/\bthis\b/, named);
      return runs.join("");
    }
  }
  return `${verb} · ${named}`;
}

/**
 * The card's human sentence: "<Actor>[ and N others] <verb>". The verb comes
 * from the spine activity vocabulary; an unrecognized op (e.g. a legacy
 * workspace event) is humanized instead of shown raw. The actor resolves to
 * You / a name / a quiet fallback. Never raw JSON. With a `subject` (see
 * {@link notificationSubject}) the item is named instead of "this".
 */
export function notificationSummary(
  group: NotificationGroup,
  currentUserId: string | null,
  subject?: string | null,
  /** Names references in a comment's excerpt for this reader (RF-1); see spineActivityLine. */
  referenceName?: (ref: ReferenceRef) => string,
): string {
  const latest = newestItem(group);
  const actor = spineActorName(latest, currentUserId);
  const verbRaw = spineActivityLine(latest, { referenceName });
  const verbLine = verbRaw === latest.op ? humanizeVerb(latest.op) : verbRaw;
  const verb = subject ? nameTheItem(verbLine, subject) : verbLine;
  const others = Math.max(0, group.actorIds.length - 1);
  const who = others > 0 ? `${actor} and ${others} ${others === 1 ? "other" : "others"}` : actor;
  return `${who} ${verb}`;
}

/**
 * The references the cards' newest excerpts carry (`moduo://task/<id>` in a
 * comment), so the bell can name each one for this reader (RF-1).
 */
export function notificationReferences(groups: NotificationGroup[]): ReferenceRef[] {
  const seen = new Set<string>();
  const out: ReferenceRef[] = [];
  for (const g of groups) {
    const excerpt = newestItem(g).payload.excerpt;
    if (typeof excerpt !== "string") continue;
    for (const ref of referencesInText(excerpt)) {
      const key = `${ref.type}:${ref.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}

/**
 * Target ids whose card needs a resolved name: task cards whose event carried
 * no title (comments). The caller looks them up in the entity registry.
 */
export function unnamedTaskTargets(groups: NotificationGroup[]): string[] {
  const ids = new Set<string>();
  for (const g of groups) {
    if (g.targetType === "task" && g.targetId && !notificationSubject(g)) ids.add(g.targetId);
  }
  return [...ids];
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
  // Chat mentions / thread replies (module_activity entity_type chat_channel).
  chat_channel: "/chat",
};

/**
 * A friendly noun for a deep-link target type, for the "· opens …" card hint.
 * Most types read fine raw ("task", "contact"); this only rewrites the ugly
 * ones (email_thread → "email"). Falls back to the raw type.
 */
const DEEP_LINK_NOUN: Record<string, string> = {
  email_thread: "email",
  chat_channel: "conversation",
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
