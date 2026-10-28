/** The runtime port's spine (implemented in runtime.web.spine.ts). */

import type { SearchAllRow } from "@contracts/search";
import type { ContentAuthorKind, ReactionKey } from "@contracts/vocabularies";

import type { NotificationItem } from "../features/spine/notifications";
import type { RecentLinkItem } from "../features/spine/recent";
import type { ReferencePreviewApi } from "../features/spine/references/rows";
import type { RawLinkSuggestion } from "../features/spine/suggest";
import type { EntityLink, EntityRecord, EntityRef, LinkOrigin, RelationKind } from "./entity-links";

/** A comment on any registered entity (spine block CT-5). */
export type SpineComment = {
  id: string;
  workspaceId: string;
  entityType: string;
  entityId: string;
  body: string;
  /** Who it belongs to. For an app's comment, the person whose API key wrote it. */
  createdBy: string | null;
  /** "api_key" = written by an app over MCP: show `authorLabel`, never the person. */
  authorKind: ContentAuthorKind;
  /** The key's name when the comment was written (api_key authors only). */
  authorLabel: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** When its author last edited it (TV-U13); null when never: it reads "edited". */
  editedAt: string | null;
  /** Who reacted with which emoji (TV-U13; any emoji since CV-7c), oldest first. */
  reactions: CommentReactionMark[];
  /** The text thread it belongs to (NR-8, notes only); null/absent = note-level. */
  anchorId?: string | null;
  /** When its thread was resolved (NR-8). */
  resolvedAt?: string | null;
};

/** One person's reaction on a comment. */
export type CommentReactionMark = { userId: string; reaction: ReactionKey };

export type SpineRuntime = {
  /**
   * Every live link touching an entity (matched on either end). Block CT-2
   * builds the grouped hub roll-up on top of this single indexed read.
   */
  listLinks(input: {
    workspaceId: string;
    entityType: string;
    entityId: string;
  }): Promise<EntityLink[]>;
  /**
   * Create a typed link. Idempotent + direction-agnostic (a duplicate pair+kind
   * no-ops and returns the existing row); rejects self-links and unknown kinds.
   * Registers both endpoints in the registry in the same transaction. Optional
   * labels/icons seed the registry projection for the @mention/search picker.
   */
  createLink(input: {
    workspaceId: string;
    source: EntityRef;
    target: EntityRef;
    relationKind?: RelationKind;
    origin?: LinkOrigin;
    sourceLabel?: string;
    sourceIcon?: string | null;
    targetLabel?: string;
    targetIcon?: string | null;
  }): Promise<EntityLink>;
  /** Re-type an existing link (optimistic re-group in the hub). No-op if unchanged. */
  setLinkKind(input: {
    workspaceId: string;
    linkId: string;
    relationKind: RelationKind;
  }): Promise<EntityLink>;
  /** Soft-delete a link (Undo-friendly; idempotent). Returns the tombstoned row. */
  deleteLink(input: { workspaceId: string; linkId: string }): Promise<EntityLink | null>;
  /**
   * Search the central registry for the @mention / `/ref` / link picker.
   * Excludes tombstones; optionally scoped to a set of entity types.
   */
  searchEntities(input: {
    workspaceId: string;
    query?: string;
    types?: string[];
    limit?: number;
  }): Promise<EntityRecord[]>;
  /**
   * Batch-read registry records for a set of refs — the hub snippet/label
   * projection for one roll-up. Includes tombstones (so the hub can dim
   * deleted targets), unlike `searchEntities`.
   */
  getEntities(input: { workspaceId: string; refs: EntityRef[] }): Promise<EntityRecord[]>;
  /**
   * ⌘K's one search (GS-3): the server's `search_all`, every module's
   * `<module>__search` merged and ranked, up to `limitPerType` rows per type
   * (8 by default, 50 at most) with each type's total and one Top result.
   * `context` is the item open now (a linked hit ranks up). Throws a `DbError`
   * (code 57014 when the server gave up after 5 s) or a network error.
   */
  searchAll(input: {
    workspaceId: string;
    query: string;
    types?: readonly string[];
    limitPerType?: number;
    context?: EntityRef | null;
  }): Promise<SearchAllRow[]>;
  /**
   * Tombstone a registry entry (the delete half of the registry contract) — a
   * module's own delete op calls this; exposed for testing + pre-adoption use.
   */
  tombstoneEntity(input: {
    workspaceId: string;
    entityType: string;
    entityId: string;
  }): Promise<void>;

  // ── Comments + notifications (block CT-5) ────────────────────────────────
  /**
   * Add a comment to any entity. `mentionedUserIds` (workspace members
   * @-mentioned in the body) become notifications for those members (AC9).
   * Goes through `comments_op_add` (guard + registry ensure + attributed
   * activity in one transaction).
   */
  addComment(input: {
    workspaceId: string;
    entityType: string;
    entityId: string;
    body: string;
    mentionedUserIds?: string[];
    entityLabel?: string;
    entityIcon?: string | null;
    /** NR-8: post into this text thread on a note (`comments_op_add_anchored`). */
    anchorId?: string | null;
  }): Promise<SpineComment>;
  /** Resolve (or reopen) a note's text thread (NR-8, `comments_op_resolve`). */
  resolveCommentThread?(input: {
    workspaceId: string;
    noteId: string;
    anchorId: string;
    resolved: boolean;
  }): Promise<void>;
  /**
   * The opening words (140 characters) of comments a bell notice names by
   * id (TV-D16: notices carry no comment text). Read through the comments'
   * own policy, so only comments on items the reader can still see answer;
   * a deleted comment doesn't.
   */
  getCommentExcerpts?(input: {
    workspaceId: string;
    commentIds: string[];
  }): Promise<Array<{ id: string; excerpt: string }>>;
  /** Read an entity's comment thread (oldest first, tombstones excluded) —
   * the Comments rail (NO-7 AC9). Direct member-read SELECT (RLS-guarded). */
  listComments(input: {
    workspaceId: string;
    entityType: string;
    entityId: string;
  }): Promise<SpineComment[]>;
  /**
   * Edit your own comment (`comments_op_edit`, TV-U13): only its author, and
   * only someone named for the first time (`mentionedUserIds`) is notified.
   */
  editComment(input: {
    commentId: string;
    body: string;
    mentionedUserIds?: string[];
  }): Promise<SpineComment>;
  /** Delete a comment (`comments_op_delete`): yours, or anyone's with Full
   *  access to the task or note. A soft delete, so the 8 s Undo can restore it. */
  deleteComment(input: { commentId: string }): Promise<SpineComment>;
  /** Undo a comment's delete (`comments_op_restore`). */
  restoreComment(input: { commentId: string }): Promise<SpineComment>;
  /**
   * `@Team` in your own comment (TV-D13, `comments_op_mention_teams`): each
   * member of those teams who can see the item hears once (never you, nor
   * anyone the comment already reached). Call it after posting or editing.
   */
  mentionTeams(input: { commentId: string; teamIds: string[] }): Promise<void>;
  /** Add (`on`) or take back one reaction (any emoji, CV-7c); answers the comment's
   *  reactions after the change. Never notifies (REPLAN 88). */
  reactToComment(input: {
    commentId: string;
    reaction: ReactionKey;
    on: boolean;
  }): Promise<CommentReactionMark[]>;
  /**
   * The derived notification feed: `module_activity` rows targeting me,
   * overlaid with my read state, newest first (AC10). The NotificationCenter
   * groups these by target then verb.
   */
  listNotifications(input: { workspaceId: string; limit?: number }): Promise<NotificationItem[]>;
  /**
   * Register this browser for Web Push notices (TV-D12): the subscription's
   * endpoint (a known push service) and keys, for the signed-in person.
   */
  pushSubscribe(input: {
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string | null;
  }): Promise<void>;
  /** Forget this browser's Web Push subscription (only your own). */
  pushUnsubscribe(input: { endpoint: string }): Promise<void>;
  /** Mark one notification (activity row) read. Idempotent. */
  markNotificationRead(input: { workspaceId: string; activityId: string }): Promise<void>;
  /** Mark every targeting-me notification in the workspace read. */
  markAllNotificationsRead(input: { workspaceId: string }): Promise<void>;
  /** Dismiss one notification — it leaves the active bell feed, stays in history (DF-21b). Idempotent. */
  dismissNotification(input: { workspaceId: string; activityId: string }): Promise<void>;
  /** Undo a dismiss — restores the row to the active feed in its prior read state. Idempotent. */
  undismissNotification(input: { workspaceId: string; activityId: string }): Promise<void>;

  // ── Deterministic auto-suggested links (block CT-6) ──────────────────────
  /**
   * Deterministic auto-suggested links for a focus entity (AC11). Computed
   * server-side from non-ML signals only (shared tags, matching email
   * domains, ±time-window co-activity), already excluding self /
   * already-linked / previously-declined pairs. Returns RAW per-signal rows;
   * `scoreSuggestions` ranks them. Requires edit access (the strip is a link
   * gesture); callers degrade gracefully on permission/RPC error.
   */
  suggestLinks(input: {
    workspaceId: string;
    entityType: string;
    entityId: string;
    limit?: number;
  }): Promise<RawLinkSuggestion[]>;
  /**
   * Record a "no" for a suggested pair so it is never re-offered (AC11).
   * Writes `link_suggestion_declines` (direction-agnostic, idempotent).
   * Accepting a suggestion is just `createLink({ origin: "suggest" })`.
   */
  declineSuggestion(input: {
    workspaceId: string;
    source: EntityRef;
    target: EntityRef;
  }): Promise<void>;

  /**
   * The workspace's most recent links, both endpoints resolved from the
   * registry — the "Recently linked" dashboard widget read (AC12). One indexed
   * `entity_links` read + one batched registry lookup, shaped newest-first.
   */
  recentLinks(input: { workspaceId: string; limit?: number }): Promise<RecentLinkItem[]>;

  // ── References (RF-1, tasks-v3 §11) ──────────────────────────────────────
  /**
   * The reads behind a reference's chip, card and hover preview: one batched
   * select per kind under the module table's row-level security (`can_access`),
   * so an item the reader can't open never comes back ("Private item").
   */
  previews: ReferencePreviewApi;
};
