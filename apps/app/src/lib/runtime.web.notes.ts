import {
  mapKnownRows,
  noteFavoriteRowSchema,
  noteRowSchema,
  noteUpdateRowSchema,
  requireRow,
} from "@contracts/rows";

import {
  type Note,
  noteRowToModel,
  type NoteUpdateRow,
  noteUpdateRowToModel,
  trashWindowCutoffIso,
} from "../features/notes/model";
// Any missing table (develop's deploy-gap guard); task-rows' version names the table.
import { isMissingTableError as isAnyTableMissing, selectFirstDeployedTier } from "./deploy-tiers";
import { collectTruncations, READ_CAPS, readAfterCursor } from "./paged-select";
import { publicConfig } from "./public-config";
import { DbError, jsonObject, runQuery, runRpc, untypedDb } from "./runtime.db";
import type { NotesRuntime, NotesV2Runtime } from "./runtime.types";
import { supabaseClient } from "./runtime.web.client";
import { joinNoteLive } from "./runtime.web.notes-live";
import { firstRow, selectCapped } from "./runtime.web.shared";
import { isMissingFunctionError } from "./task-rows";

function mapNoteRow(raw: unknown): Note {
  return noteRowToModel(requireRow(noteRowSchema, raw, "note"));
}

function mapNoteUpdateRow(raw: unknown): NoteUpdateRow {
  return noteUpdateRowToModel(requireRow(noteUpdateRowSchema, raw, "note update"));
}

export const webNotes: { notes: NotesRuntime; notesV2: NotesV2Runtime } = {
  // LEGACY read-only surface (see runtime.types.ts) — the dashboard preview
  // widget on web; the redb import reads through the tauri implementation.
  notes: {
    async list(workspaceId) {
      const data = await runQuery(
        supabaseClient
          .from("notes")
          .select("*")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .order("position"),
      );
      return data ?? [];
    },
    async getDocState(_workspaceId, noteId) {
      const { data, error } = await supabaseClient
        .from("notes")
        .select("doc_state")
        .eq("id", noteId)
        .single();
      if (error || !data) return null;
      return {
        snapshotB64: data.doc_state ?? "",
        lastCompactedUpdateId: 0,
        updates: [],
      };
    },
  },
  notesV2: {
    // ── Wave-3 rebuild surface (NO-1). Writes = notes_op_* RPCs (guard +
    // write + registry upsert + attributed activity); reads = indexed
    // SELECTs that DEGRADE pre-migration: the v2 column list 42703s until
    // the migration lands, so we fall back to the legacy columns and flag
    // the bundle degraded. Explicit mutations throw honest errors instead.
    async listMeta(workspaceId) {
      const V2_COLS =
        "id, workspace_id, created_by, parent_id, title, icon, is_pinned, position, is_archived, published_at, publish_token, doc_version, share_mode, workspace_shared, created_at, updated_at, deleted_at";
      // NR-1 columns ride on top of v2; until that migration is applied the
      // v2 read still works fully (not degraded) and sections derive Inbox.
      const NR1_COLS = `${V2_COLS}, in_inbox, full_width`;
      // NR-6: the last human editor, for the header's "Edited … by …".
      const NR6_COLS = `${NR1_COLS}, edited_by, edited_at`;
      const LEGACY_COLS =
        "id, workspace_id, created_by, parent_id, title, icon, is_pinned, position, is_archived, created_at, updated_at, deleted_at";
      const cutoff = trashWindowCutoffIso(new Date());
      const query = (cols: string) =>
        selectCapped<any>({
          scope: "notes",
          cap: READ_CAPS.notes,
          build: (opts) =>
            supabaseClient
              .from("notes")
              .select(cols, opts)
              .eq("workspace_id", workspaceId)
              .or(`deleted_at.is.null,deleted_at.gt.${cutoff}`),
          order: (q) => q.order("position").order("id"),
        });
      const tiers = [NR6_COLS, NR1_COLS, V2_COLS, LEGACY_COLS];
      const { res, tier } = await selectFirstDeployedTier(tiers, query);
      // Degrade ONLY on the deploy gap (missing v2 columns = 42703). An
      // outage/auth error must surface as an error, not an empty module.
      if (res.error) throw new DbError(res.error);
      return {
        notes: mapKnownRows(res.rows, mapNoteRow),
        // Only the legacy column set (the last tier) means the v2 ops are missing.
        degraded: tier === tiers.length - 1,
        truncated: collectTruncations(res.truncation),
      };
    },

    async pullDoc({ workspaceId, noteId, sinceUpdateId, knownDocVersion }) {
      // Log FIRST, snapshot SECOND. A concurrent compaction between the two
      // reads then only ever makes the snapshot NEWER than the log we hold —
      // applying both stays lossless (Yjs is idempotent). The reverse order
      // could pair a stale snapshot with a log missing its folded tail.
      // Paged to the end (NR-3): one select stops at PostgREST's 1,000-row
      // ceiling, so a long log silently lost its tail. A failed page fails
      // the pull rather than returning a partial log the cursor would skip.
      // NR-6 adds who wrote each row; until that migration is applied the
      // select 42703s, so retry once with the original columns.
      const readLog = (cols: string) =>
        readAfterCursor({
          after: sinceUpdateId ?? 0,
          idOf: (row: { id: number | string }) => Number(row.id),
          page: async (after, limit) =>
            supabaseClient
              .from("note_updates")
              .select<string, { id: number | string }>(cols)
              .eq("note_id", noteId)
              .gt("id", after)
              .order("id", { ascending: true })
              .limit(limit),
        });
      let updRes = await readLog("id, client_id, client_seq, update_b64, origin, actor_key_id");
      if (updRes.error && (updRes.error as { code?: string }).code === "42703") {
        updRes = await readLog("id, client_id, client_seq, update_b64");
      }
      if (updRes.error) throw new DbError(updRes.error);
      const updates = mapKnownRows(updRes.rows, mapNoteUpdateRow);

      // Every snapshot change (compaction, seed) bumps doc_version, so an
      // unchanged version means the snapshot adds nothing to what we hold.
      if (knownDocVersion != null) {
        const ver = await supabaseClient
          .from("notes")
          .select("doc_version")
          .eq("id", noteId)
          .eq("workspace_id", workspaceId)
          .single();
        if (!ver.error && ver.data?.doc_version === knownDocVersion) {
          return { snapshotB64: null, docVersion: knownDocVersion, updates };
        }
      }

      const noteRes = await supabaseClient
        .from("notes")
        .select("doc_state, doc_version")
        .eq("id", noteId)
        .eq("workspace_id", workspaceId)
        .single();
      if (noteRes.error) {
        if (noteRes.error.code !== "42703") throw new DbError(noteRes.error);
        // Pre-migration there is no doc_version column — degrade to the
        // legacy snapshot-only shape rather than breaking the open note.
        const legacy = await supabaseClient
          .from("notes")
          .select("doc_state")
          .eq("id", noteId)
          .eq("workspace_id", workspaceId)
          .single();
        if (legacy.error) throw new DbError(legacy.error);
        return { snapshotB64: legacy.data?.doc_state ?? null, docVersion: 0, updates: [] };
      }
      return {
        snapshotB64: noteRes.data?.doc_state ?? null,
        docVersion: noteRes.data?.doc_version ?? 0,
        updates,
      };
    },

    async create({ workspaceId, id, parentId, title, position, icon }) {
      const data = await runRpc(
        supabaseClient.rpc("notes_op_create", {
          p_workspace_id: workspaceId,
          p_id: id ?? null,
          p_parent_id: parentId ?? null,
          p_title: title ?? "",
          p_position: position ?? "",
          p_icon: icon ?? null,
        }),
      );
      return mapNoteRow(firstRow(data, "notes_op_create"));
    },

    async rename({ workspaceId, noteId, title }) {
      const data = await runRpc(
        supabaseClient.rpc("notes_op_rename", {
          p_workspace_id: workspaceId,
          p_note_id: noteId,
          p_title: title,
        }),
      );
      return mapNoteRow(firstRow(data, "notes_op_rename"));
    },

    async move({ workspaceId, noteId, parentId, position, followParent }) {
      const args = {
        p_workspace_id: workspaceId,
        p_note_id: noteId,
        p_parent_id: parentId ?? null,
        p_position: position ?? "",
      };
      // p_follow_parent goes only when asked, so a plain move works on a
      // database without it. Not in prod's types until 20261020141000 ships:
      // untyped until then, then `bun run db:types` and drop untypedDb.
      const follow = Boolean(followParent && parentId);
      const { data, error } = await untypedDb(supabaseClient).rpc(
        "notes_op_move",
        follow ? { ...args, p_follow_parent: true } : args,
      );
      if (!error) return mapNoteRow(firstRow(data, "notes_op_move"));
      if (!follow || !isMissingFunctionError(error, "notes_op_move")) throw new DbError(error);
      // Before the migration: the move, then the sharing change, in order.
      const moved = await runRpc(supabaseClient.rpc("notes_op_move", args));
      const shared = await supabaseClient.rpc("share_op_follow_parent", { p_note_id: noteId });
      if (shared.error)
        throw new DbError({
          ...shared.error,
          message: `Moved, but couldn't change who can see it: ${shared.error.message}`,
        });
      return {
        ...mapNoteRow(firstRow(moved, "notes_op_move")),
        shareMode: "inherit",
        workspaceShared: false,
      };
    },

    async setMeta({ workspaceId, noteId, patch }) {
      const data = await runRpc(
        supabaseClient.rpc("notes_op_set_meta", {
          p_workspace_id: workspaceId,
          p_note_id: noteId,
          p_patch: patch,
        }),
      );
      return mapNoteRow(firstRow(data, "notes_op_set_meta"));
    },

    async fileNote({ workspaceId, noteId, inInbox, position }) {
      const data = await runRpc(
        supabaseClient.rpc("notes_op_file", {
          p_workspace_id: workspaceId,
          p_note_id: noteId,
          p_in_inbox: inInbox,
          p_position: position ?? "",
        }),
      );
      return mapNoteRow(firstRow(data, "notes_op_file"));
    },

    async listFavorites(workspaceId) {
      const { data, error } = await supabaseClient
        .from("note_favorites")
        .select("note_id, position, created_at")
        .eq("workspace_id", workspaceId)
        .order("position")
        .order("created_at");
      if (error) {
        // Deploy gap (table not created yet) → no favorites, never a wall.
        if (isAnyTableMissing(error)) return [];
        throw new DbError(error);
      }
      return mapKnownRows(data ?? [], (raw) => {
        const r = requireRow(noteFavoriteRowSchema, raw, "note favorite");
        return { noteId: r.note_id, position: r.position, createdAt: r.created_at };
      });
    },

    async setFavorite({ workspaceId, noteId, value, position }) {
      await runRpc(
        supabaseClient.rpc("notes_op_set_favorite", {
          p_workspace_id: workspaceId,
          p_note_id: noteId,
          p_value: value,
          p_position: position ?? null,
        }),
      );
    },

    async duplicate({ workspaceId, sourceNoteId, position }) {
      const data = await runRpc(
        supabaseClient.rpc("notes_op_duplicate", {
          p_workspace_id: workspaceId,
          p_source_note_id: sourceNoteId,
          p_position: position ?? "",
        }),
      );
      return mapNoteRow(firstRow(data, "notes_op_duplicate"));
    },

    async archive({ workspaceId, noteId }) {
      const data = await runRpc(
        supabaseClient.rpc("notes_op_archive", {
          p_workspace_id: workspaceId,
          p_note_id: noteId,
        }),
      );
      return mapNoteRow(firstRow(data, "notes_op_archive"));
    },

    async unarchive({ workspaceId, noteId }) {
      const data = await runRpc(
        supabaseClient.rpc("notes_op_unarchive", {
          p_workspace_id: workspaceId,
          p_note_id: noteId,
        }),
      );
      return mapNoteRow(firstRow(data, "notes_op_unarchive"));
    },

    async trash({ workspaceId, noteId }) {
      const data = jsonObject(
        await runRpc(
          supabaseClient.rpc("notes_op_trash", {
            p_workspace_id: workspaceId,
            p_note_id: noteId,
          }),
        ),
      );
      return {
        trashedIds: (data?.trashed_ids ?? []) as string[],
        count: Number(data?.count ?? 0),
      };
    },

    async restore({ workspaceId, noteId }) {
      const data = jsonObject(
        await runRpc(
          supabaseClient.rpc("notes_op_restore", {
            p_workspace_id: workspaceId,
            p_note_id: noteId,
          }),
        ),
      );
      return {
        restoredIds: (data?.restored_ids ?? []) as string[],
        count: Number(data?.count ?? 0),
      };
    },

    async purge({ workspaceId, noteId }) {
      const data = jsonObject(
        await runRpc(
          supabaseClient.rpc("notes_op_purge", {
            p_workspace_id: workspaceId,
            p_note_id: noteId,
          }),
        ),
      );
      return { count: Number(data?.count ?? 0) };
    },

    async purgeExpired(workspaceId) {
      // Module-load sweep (like tasks catch_up): degrade quietly pre-deploy —
      // a missing RPC must never break opening /notes.
      try {
        const { data, error } = await supabaseClient.rpc("notes_op_purge_expired", {
          p_workspace_id: workspaceId,
        });
        if (error) return { count: 0 };
        return { count: Number(jsonObject(data).count ?? 0) };
      } catch {
        return { count: 0 };
      }
    },

    async publish({ workspaceId, noteId }) {
      const data = await runRpc(
        supabaseClient.rpc("notes_op_publish", {
          p_workspace_id: workspaceId,
          p_note_id: noteId,
        }),
      );
      return mapNoteRow(firstRow(data, "notes_op_publish"));
    },

    async unpublish({ workspaceId, noteId }) {
      const data = await runRpc(
        supabaseClient.rpc("notes_op_unpublish", {
          p_workspace_id: workspaceId,
          p_note_id: noteId,
        }),
      );
      return mapNoteRow(firstRow(data, "notes_op_unpublish"));
    },

    // The public read URL for a published note (NO-9b): the app's own
    // `/p/<token>` route (a public SPA page that renders body_md client-side —
    // Supabase edge functions can't serve HTML). On web, window.location.origin
    // is correct wherever served; desktop (tauri://) needs PUBLIC_WEB_ORIGIN set
    // to the deployed web origin.
    publishedUrl(token) {
      const configured = publicConfig().webOrigin.replace(/\/+$/, "");
      const origin = configured || (typeof window !== "undefined" ? window.location.origin : "");
      return `${origin}/p/${encodeURIComponent(token)}`;
    },

    async recent({ workspaceId, limit }) {
      const { data, error } = await supabaseClient
        .from("notes")
        .select("id, title, body_text, updated_at, is_archived, published_at, deleted_at")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(limit ?? 8);
      // Pre-migration the v2 columns 42703 — degrade to no rows (a widget must
      // never wall), like listMeta/search.
      if (error) {
        if (error.code === "42703") return [];
        throw new DbError(error);
      }
      return (Array.isArray(data) ? data : []).map((r: any) => ({
        id: r.id as string,
        title: (r.title as string) ?? "",
        bodyText: (r.body_text as string) ?? "",
        updatedAt: (r.updated_at as string) ?? "",
        isArchived: Boolean(r.is_archived),
        publishedAt: (r.published_at as string | null) ?? null,
      }));
    },

    async pushUpdates({ workspaceId, noteId, clientId, updates, bodyText, bodyMd }) {
      const data = jsonObject(
        await runRpc(
          supabaseClient.rpc("notes_op_apply_updates", {
            p_workspace_id: workspaceId,
            p_note_id: noteId,
            p_client_id: clientId,
            p_updates: updates,
            p_body_text: bodyText ?? null,
            p_body_md: bodyMd ?? null,
          }),
        ),
      );
      return {
        inserted: Number(data?.inserted ?? 0),
        duplicates: Number(data?.duplicates ?? 0),
        maxUpdateId: data?.max_update_id == null ? null : Number(data.max_update_id),
      };
    },

    async saveSnapshot({
      workspaceId,
      noteId,
      snapshotB64,
      uptoUpdateId,
      bodyText,
      bodyMd,
      expectedDocVersion,
    }) {
      const data = jsonObject(
        await runRpc(
          supabaseClient.rpc("notes_op_save_snapshot", {
            p_workspace_id: workspaceId,
            p_note_id: noteId,
            p_snapshot_b64: snapshotB64,
            p_upto_update_id: uptoUpdateId,
            p_body_text: bodyText ?? null,
            p_body_md: bodyMd ?? null,
            p_expected_doc_version: expectedDocVersion ?? undefined,
          }),
        ),
      );
      return {
        folded: Number(data?.folded ?? 0),
        docVersion: Number(data?.doc_version ?? 0),
        refused: data?.refused === true,
      };
    },

    async seedDoc({ workspaceId, noteId, docStateB64, bodyText, bodyMd }) {
      const data = jsonObject(
        await runRpc(
          supabaseClient.rpc("notes_op_seed_doc", {
            p_workspace_id: workspaceId,
            p_note_id: noteId,
            p_doc_state_b64: docStateB64,
            p_body_text: bodyText ?? null,
            p_body_md: bodyMd ?? null,
          }),
        ),
      );
      return {
        seeded: Boolean(data?.seeded),
        reason: (data?.reason as string | undefined) ?? null,
        docVersion: data?.doc_version == null ? null : Number(data.doc_version),
      };
    },

    async listUnmaterialized({ workspaceId, limit }) {
      const { data, error } = await supabaseClient.rpc("notes_list_unmaterialized", {
        p_workspace_id: workspaceId,
        p_limit: limit ?? 200,
      });
      // The repair sweep is opportunistic — it must never wall the module
      // between merging this code and deploying the migration (the recorded
      // new-RPC deploy-gap trap). But degrade LOUDLY for anything that is not
      // that gap: a silent [] on, say, a renamed param would make the whole
      // backfill a permanent no-op nobody ever notices.
      if (error) {
        const undeployed = error.code === "42883" || error.code === "PGRST202";
        if (!undeployed) {
          console.warn("[notes] listUnmaterialized failed", error.code, error.message);
        }
        return [];
      }
      return (data ?? []).map((r: any) => ({
        id: String(r.o_id),
        bodyMd: String(r.o_body_md ?? ""),
      }));
    },

    async importNotes({ workspaceId, rows }) {
      const payload = rows.map((r) => ({
        id: r.id ?? null,
        parentId: r.parentId ?? null,
        title: r.title ?? "",
        icon: r.icon ?? null,
        position: r.position ?? "",
        docStateB64: r.docStateB64 ?? null,
        bodyText: r.bodyText ?? "",
        bodyMd: r.bodyMd ?? "",
        // Omitted (undefined → dropped by JSON) lets the server decide.
        inInbox: r.inInbox,
      }));
      const data = jsonObject(
        await runRpc(
          supabaseClient.rpc("notes_op_import", {
            p_workspace_id: workspaceId,
            p_rows: payload,
          }),
        ),
      );
      return {
        imported: Number(data?.imported ?? 0),
        skipped: Number(data?.skipped ?? 0),
      };
    },

    async mention({ workspaceId, noteId, mentionedUserIds }) {
      await runRpc(
        supabaseClient.rpc("notes_op_mention", {
          p_workspace_id: workspaceId,
          p_note_id: noteId,
          p_mentioned_user_ids: mentionedUserIds,
        }),
      );
    },

    async search({ workspaceId, query, limit }) {
      const q = query.trim();
      if (!q) return [];
      const { data, error } = await supabaseClient
        .from("notes")
        .select("id, title, body_text, is_archived, deleted_at")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .textSearch("search_tsv", q, { type: "websearch", config: "simple" })
        .limit(limit ?? 30);
      // Pre-migration the v2 columns (search_tsv/body_text/is_archived) 42703 —
      // degrade to no results rather than an error, like listMeta.
      if (error) {
        if (error.code === "42703") return [];
        throw new DbError(error);
      }
      return (Array.isArray(data) ? data : []).map((r: any) => ({
        id: r.id as string,
        title: (r.title as string) ?? "",
        bodyText: (r.body_text as string) ?? "",
        isArchived: Boolean(r.is_archived),
        deletedAt: (r.deleted_at as string | null) ?? null,
      }));
    },

    async fetchExportDocs({ workspaceId, ids }) {
      if (ids.length === 0) return [];
      const { data, error } = await supabaseClient
        .from("notes")
        .select("id, title, body_md")
        .eq("workspace_id", workspaceId)
        .in("id", ids);
      if (error) {
        if (error.code === "42703") return [];
        throw new DbError(error);
      }
      return (Array.isArray(data) ? data : []).map((r: any) => ({
        id: r.id as string,
        title: (r.title as string) ?? "",
        bodyMd: (r.body_md as string) ?? "",
      }));
    },

    joinLive(input) {
      return joinNoteLive(supabaseClient, input);
    },
  },
};
