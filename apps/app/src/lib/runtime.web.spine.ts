/** The web runtime's spine (Supabase). */

import {
  commentRowSchema,
  entityRecordRowSchema,
  linkSuggestionRowSchema,
  mapKnownRows,
  notificationRowSchema,
  parsedRelationKind,
  requireRow,
} from "@contracts/rows";
import { normalizeContentAuthorKind, normalizeReactionKey } from "@contracts/vocabularies";

import type { NotificationItem } from "../features/spine/notifications";
import { shapeRecentLinks } from "../features/spine/recent";
import type { RawLinkSuggestion } from "../features/spine/suggest";
import type { EntityRecord } from "./entity-links";
import { DbError, runQuery, runRpc } from "./runtime.db";
import type { CommentReactionMark, SpineComment, SpineRuntime } from "./runtime.types";
import { supabaseClient } from "./runtime.web.client";
import { createReferencePreviews } from "./runtime.web.previews";
import { entityLinkRowToModel } from "./runtime.web.shared";
import { handleSearchPattern, handleWithCurrentKey } from "./task-handle";

function entityRecordRowToModel(raw: unknown): EntityRecord {
  const r = requireRow(entityRecordRowSchema, raw, "entity");
  return {
    workspaceId: r.workspace_id,
    type: r.entity_type,
    id: r.entity_id,
    label: r.label ?? "",
    icon: r.icon ?? null,
    deletedAt: r.deleted_at ?? null,
  };
}

/** A `links_suggest` row → a raw per-signal suggestion (scoreSuggestions ranks). */
function linkSuggestionRowToModel(raw: unknown): RawLinkSuggestion {
  const r = requireRow(linkSuggestionRowSchema, raw, "link suggestion");
  return {
    otherType: r.other_type,
    otherId: r.other_id,
    otherLabel: r.other_label ?? "",
    otherIcon: r.other_icon ?? null,
    signal: r.signal as RawLinkSuggestion["signal"],
    suggestedKind: parsedRelationKind(r.suggested_kind ?? "references"),
    strength: typeof r.strength === "number" ? r.strength : Number(r.strength) || 1,
  };
}

// ── Spine: comments / notifications row<->model mappers (block CT-5) ───────────

function commentRowToModel(raw: unknown): SpineComment {
  const r = requireRow(commentRowSchema, raw, "comment");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    body: r.body ?? "",
    createdBy: r.created_by ?? null,
    authorKind: normalizeContentAuthorKind(r.author_kind),
    authorLabel: r.author_label ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
    editedAt: r.edited_at ?? null,
    reactions: reactionMarks(r.comment_reactions ?? []),
    anchorId: r.anchor_id ?? null,
    resolvedAt: r.resolved_at ?? null,
  };
}

/** Reaction rows → marks; a reaction this build doesn't know is left out. */
function reactionMarks(rows: readonly unknown[]): CommentReactionMark[] {
  const out: CommentReactionMark[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as { user_id?: unknown; reaction?: unknown };
    const reaction = normalizeReactionKey(row.reaction);
    if (typeof row.user_id === "string" && reaction) out.push({ userId: row.user_id, reaction });
  }
  return out;
}

/** A `notifications_list` row → the normalized NotificationItem the reducer groups. */
function notificationRowToModel(raw: unknown): NotificationItem {
  const r = requireRow(notificationRowSchema, raw, "notification");
  return {
    id: r.id,
    source: "spine",
    workspaceId: r.workspace_id ?? null,
    targetType: r.entity_type ?? null,
    targetId: r.entity_id ?? null,
    op: r.op,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    actorType: r.actor_type ?? "user",
    actorId: r.actor_id ?? null,
    actorLabel: r.actor_label ?? null,
    createdAt: r.created_at,
    readAt: r.read_at ?? null,
    // Absent pre-DF-21b migration → null → the row stays active (graceful).
    dismissedAt: r.dismissed_at ?? null,
  };
}

// ── Connective-tissue spine (specs/connective-tissue.md block CT-1) ─────────
// Mutations go through links_op_* / entities_op_* RPCs (permission guard +
// write + attributed activity row in one transaction); reads are direct,
// indexed SELECTs over entity_links / entities.
export const webSpine: SpineRuntime = {
  async listLinks({ workspaceId, entityType, entityId }) {
    // entityType/entityId are app-owned tokens (type slugs + uuids), not user
    // input — safe to interpolate into the PostgREST `.or()` filter below.
    const data = await runQuery(
      supabaseClient
        .from("entity_links")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .or(
          `and(source_type.eq.${entityType},source_id.eq.${entityId}),` +
            `and(target_type.eq.${entityType},target_id.eq.${entityId})`,
        )
        .order("created_at", { ascending: false }),
    );
    return mapKnownRows(data, entityLinkRowToModel);
  },

  async createLink({
    workspaceId,
    source,
    target,
    relationKind,
    origin,
    sourceLabel,
    sourceIcon,
    targetLabel,
    targetIcon,
  }) {
    // A `blocks` link between two tasks is a dependency (TV-D8): it fails without
    // Tasks edit on the waiting task, or on a loop ("Dependencies cannot form a
    // cycle"). Surface that error; never retry it as a plain link.
    const data = await runRpc(
      supabaseClient.rpc("links_op_create", {
        p_workspace_id: workspaceId,
        p_source_type: source.type,
        p_source_id: source.id,
        p_target_type: target.type,
        p_target_id: target.id,
        p_relation_kind: relationKind ?? "references",
        p_origin: origin ?? "manual",
        p_source_label: sourceLabel ?? null,
        p_source_icon: sourceIcon ?? null,
        p_target_label: targetLabel ?? null,
        p_target_icon: targetIcon ?? null,
      }),
    );
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("The link operation returned nothing.");
    return entityLinkRowToModel(row);
  },

  async setLinkKind({ workspaceId, linkId, relationKind }) {
    const data = await runRpc(
      supabaseClient.rpc("links_op_set_kind", {
        p_workspace_id: workspaceId,
        p_link_id: linkId,
        p_relation_kind: relationKind,
      }),
    );
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("The link operation returned nothing.");
    return entityLinkRowToModel(row);
  },

  async deleteLink({ workspaceId, linkId }) {
    const data = await runRpc(
      supabaseClient.rpc("links_op_delete", {
        p_workspace_id: workspaceId,
        p_link_id: linkId,
      }),
    );
    const row = Array.isArray(data) ? data[0] : data;
    // The op returns SQL NULL when the link never existed; guard the id too
    // in case an all-NULL composite ever slips through serialization.
    return row?.id ? entityLinkRowToModel(row) : null;
  },

  async searchEntities({ workspaceId, query, types, limit }) {
    const trimmed = query?.trim();
    // A handle (MOD-142, or its start) also finds the task (TV-D8, AC3.1),
    // and so does one typed with an earlier key of this workspace.
    let handle = trimmed ? handleSearchPattern(trimmed) : null;
    if (handle) {
      const { data: ws } = await supabaseClient
        .from("workspaces")
        .select("task_key, task_key_aliases")
        .eq("id", workspaceId)
        .maybeSingle();
      handle = handleWithCurrentKey(handle, ws?.task_key ?? null, ws?.task_key_aliases ?? []);
    }
    let q = supabaseClient
      .from("entities")
      .select("*")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null);
    if (trimmed && handle) {
      q = q.or(`label.ilike.%${trimmed}%,handle.ilike.${handle}`);
    } else if (trimmed) q = q.ilike("label", `%${trimmed}%`);
    if (types?.length) q = q.in("entity_type", types);
    const data = await runQuery(q.order("label").limit(limit ?? 20));
    return mapKnownRows(data, entityRecordRowToModel);
  },

  async getEntities({ workspaceId, refs }) {
    if (!refs.length) return [];
    // entity_id is a uuid (effectively unique across types) — query by id then
    // filter to the exact (type,id) pairs requested. Includes tombstones.
    const ids = Array.from(new Set(refs.map((r) => r.id)));
    const data = await runQuery(
      supabaseClient
        .from("entities")
        .select("*")
        .eq("workspace_id", workspaceId)
        .in("entity_id", ids),
    );
    const wanted = new Set(refs.map((r) => `${r.type}:${r.id}`));
    return mapKnownRows(data, entityRecordRowToModel).filter((rec) =>
      wanted.has(`${rec.type}:${rec.id}`),
    );
  },

  async tombstoneEntity({ workspaceId, entityType, entityId }) {
    await runRpc(
      supabaseClient.rpc("entities_op_tombstone", {
        p_workspace_id: workspaceId,
        p_entity_type: entityType,
        p_entity_id: entityId,
      }),
    );
  },

  // ── Comments + notifications (block CT-5) ────────────────────────────────
  async addComment({
    workspaceId,
    entityType,
    entityId,
    body,
    mentionedUserIds,
    entityLabel,
    entityIcon,
    anchorId,
  }) {
    const { data, error } = anchorId
      ? await supabaseClient.rpc("comments_op_add_anchored", {
          p_workspace_id: workspaceId,
          p_entity_id: entityId,
          p_anchor_id: anchorId,
          p_body: body,
          p_mentioned_user_ids: mentionedUserIds ?? [],
          p_entity_label: entityLabel ?? null,
          p_entity_icon: entityIcon ?? null,
        })
      : await supabaseClient.rpc("comments_op_add", {
          p_workspace_id: workspaceId,
          p_entity_type: entityType,
          p_entity_id: entityId,
          p_body: body,
          p_mentioned_user_ids: mentionedUserIds ?? [],
          p_entity_label: entityLabel ?? null,
          p_entity_icon: entityIcon ?? null,
        });
    if (error) throw new DbError(error);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("The comment operation returned nothing.");
    return commentRowToModel(row);
  },

  async resolveCommentThread({ workspaceId, noteId, anchorId, resolved }) {
    await runRpc(
      supabaseClient.rpc("comments_op_resolve", {
        p_workspace_id: workspaceId,
        p_entity_id: noteId,
        p_anchor_id: anchorId,
        p_resolved: resolved,
      }),
    );
  },

  async getCommentExcerpts({ workspaceId, commentIds }) {
    const ids = [...new Set(commentIds)].slice(0, 200);
    if (ids.length === 0) return [];
    // RLS: only comments on items the reader can still see.
    const data = await runQuery(
      supabaseClient
        .from("comments")
        .select("id, body")
        .eq("workspace_id", workspaceId)
        .in("id", ids)
        .is("deleted_at", null),
    );
    return (data ?? []).map((r) => ({
      id: String(r.id),
      excerpt: String(r.body ?? "").slice(0, 140),
    }));
  },

  async listComments({ workspaceId, entityType, entityId }) {
    // The reactions ride along (TV-U13).
    const data = await runQuery(
      supabaseClient
        .from("comments")
        .select("*, comment_reactions(user_id, reaction)")
        .eq("workspace_id", workspaceId)
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true }),
    );
    return mapKnownRows(data, commentRowToModel);
  },

  // ── Comment edit / delete / reactions (TV-U13) ───────────────────────────
  async editComment({ commentId, body, mentionedUserIds }) {
    const data = await runRpc(
      supabaseClient.rpc("comments_op_edit", {
        p_comment_id: commentId,
        p_body: body,
        p_mentioned_user_ids: mentionedUserIds ?? [],
      }),
    );
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("The comment operation returned nothing.");
    return commentRowToModel(row);
  },

  async deleteComment({ commentId }) {
    const data = await runRpc(
      supabaseClient.rpc("comments_op_delete", {
        p_comment_id: commentId,
      }),
    );
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("The comment operation returned nothing.");
    return commentRowToModel(row);
  },

  async mentionTeams({ commentId, teamIds }) {
    if (teamIds.length === 0) return;
    await runRpc(
      supabaseClient.rpc("comments_op_mention_teams", {
        p_comment_id: commentId,
        p_team_ids: teamIds,
      }),
    );
  },

  async restoreComment({ commentId }) {
    const data = await runRpc(
      supabaseClient.rpc("comments_op_restore", {
        p_comment_id: commentId,
      }),
    );
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("The comment operation returned nothing.");
    return commentRowToModel(row);
  },

  async reactToComment({ commentId, reaction, on }) {
    const data = await runRpc(
      supabaseClient.rpc("comments_op_react", {
        p_comment_id: commentId,
        p_reaction: reaction,
        p_on: on,
      }),
    );
    return reactionMarks(Array.isArray(data) ? data : []);
  },

  async listNotifications({ workspaceId, limit }) {
    const data = await runRpc(
      supabaseClient.rpc("notifications_list", {
        p_workspace_id: workspaceId,
        p_limit: limit ?? 50,
      }),
    );
    return mapKnownRows(data, notificationRowToModel);
  },

  async pushSubscribe({ endpoint, p256dh, auth, userAgent }) {
    await runRpc(
      supabaseClient.rpc("push_op_subscribe", {
        p_endpoint: endpoint,
        p_p256dh: p256dh,
        p_auth: auth,
        p_user_agent: userAgent ?? null,
      }),
    );
  },

  async pushUnsubscribe({ endpoint }) {
    await runRpc(supabaseClient.rpc("push_op_unsubscribe", { p_endpoint: endpoint }));
  },

  async markNotificationRead({ workspaceId, activityId }) {
    await runRpc(
      supabaseClient.rpc("notifications_op_mark_read", {
        p_workspace_id: workspaceId,
        p_activity_id: activityId,
      }),
    );
  },

  async markAllNotificationsRead({ workspaceId }) {
    await runRpc(
      supabaseClient.rpc("notifications_op_mark_all_read", {
        p_workspace_id: workspaceId,
      }),
    );
  },

  async dismissNotification({ workspaceId, activityId }) {
    await runRpc(
      supabaseClient.rpc("notifications_op_dismiss", {
        p_workspace_id: workspaceId,
        p_activity_id: activityId,
      }),
    );
  },

  async undismissNotification({ workspaceId, activityId }) {
    await runRpc(
      supabaseClient.rpc("notifications_op_undismiss", {
        p_workspace_id: workspaceId,
        p_activity_id: activityId,
      }),
    );
  },

  // ── Deterministic auto-suggested links (block CT-6) ──────────────────────
  async suggestLinks({ workspaceId, entityType, entityId, limit }) {
    const data = await runRpc(
      supabaseClient.rpc("links_suggest", {
        p_workspace_id: workspaceId,
        p_entity_type: entityType,
        p_entity_id: entityId,
        p_limit: limit ?? 25,
      }),
    );
    return mapKnownRows(data, linkSuggestionRowToModel);
  },

  async declineSuggestion({ workspaceId, source, target }) {
    await runRpc(
      supabaseClient.rpc("links_op_decline_suggestion", {
        p_workspace_id: workspaceId,
        p_source_type: source.type,
        p_source_id: source.id,
        p_target_type: target.type,
        p_target_id: target.id,
      }),
    );
  },

  async recentLinks({ workspaceId, limit }) {
    const data = await runQuery(
      supabaseClient
        .from("entity_links")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit ?? 20),
    );
    const links = mapKnownRows(data, entityLinkRowToModel);
    // One batched registry lookup for every endpoint (no N fan-out).
    const ids = Array.from(new Set(links.flatMap((l) => [l.sourceId, l.targetId])));
    let records: EntityRecord[] = [];
    if (ids.length) {
      const res = await supabaseClient
        .from("entities")
        .select("*")
        .eq("workspace_id", workspaceId)
        .in("entity_id", ids);
      if (res.error) throw new DbError(res.error);
      records = mapKnownRows(res.data, entityRecordRowToModel);
    }
    const byKey = new Map(records.map((r) => [`${r.type}:${r.id}`, r]));
    return shapeRecentLinks(links, byKey);
  },

  // References (RF-1): every read under the module table's RLS (can_access).
  previews: createReferencePreviews(supabaseClient),
};
