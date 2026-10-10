// The reads behind references (RF-1, tasks-v3 §11, Assumptions #13). Each is
// one batched select per kind on the module's own table, under that table's
// row-level security, which is `can_access` (PERM-1…9). So a row the reader
// can't open never comes back, and the reference reads "Private item" with no
// title; nothing here ever reads the registry label of an item first. Deleted
// rows the reader could open come back with `deleted_at` ("Deleted task").
// Card-level extras (a project's name, subtask counts, progress) ride the same
// rules. Split out of runtime.web.ts so it stays testable with a fake client.

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ContactPreviewRow,
  EmailPreviewRow,
  EventPreviewRow,
  NotePreviewRow,
  ProjectPreviewRow,
  ReferencePreviewApi,
  TagPreviewRow,
  TaskPreviewRow,
} from "../features/spine/references/rows";
import { handleWithCurrentKey } from "./task-handle";
import { dueOnToLocalInstant, isMissingColumnError } from "./task-rows";

/** PostgREST rows are untyped here; each is mapped below. */
type Row = Record<string, any>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const unique = (values: Array<string | null | undefined>): string[] =>
  Array.from(new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0)));

/** A note's text, cut to about two card lines (whole words, no trailing space). */
function excerptOf(text: string | null): string | null {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (flat.length <= 240) return flat;
  const cut = flat.slice(0, 240);
  const space = cut.lastIndexOf(" ");
  return `${(space > 160 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** A typed `%` or `_` is a character, not a LIKE wildcard. */
const likeEscape = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Statuses that count towards progress: Backlog and Won't do sit out (53b). */
const COUNTED = ["todo", "in_progress", "done"];

export function createReferencePreviews(client: SupabaseClient): ReferencePreviewApi {
  const fail = (error: { message: string } | null) => {
    if (error) throw new Error(error.message);
  };

  return {
    async tasks({ workspaceId, ids, card }) {
      if (!ids.length) return [];
      const read = (extra: string) =>
        client
          .from("tasks")
          .select(`id, title, status, due_date, bucket_id, assignee_id, deleted_at${extra}`)
          .eq("workspace_id", workspaceId)
          .in("id", ids);
      let { data, error } = await read(", number, status_category, due_on");
      // A database before TV-D9 has no status category or due_on (a backlog
      // task's legacy status reads "todo"); before TV-D8, no task numbers.
      if (isMissingColumnError(error, "status_category") || isMissingColumnError(error, "due_on"))
        ({ data, error } = await read(", number"));
      if (isMissingColumnError(error, "number")) ({ data, error } = await read(""));
      fail(error);
      const rows: TaskPreviewRow[] = ((data ?? []) as Row[]).map((r) => ({
        id: r.id,
        title: str(r.title) ?? "",
        // The category when the row has one (TV-D9): Backlog and Won't do by name.
        status: str(r.status_category) ?? str(r.status) ?? "todo",
        // The due date is a date since TV-D9: its local midnight here.
        dueDate: typeof r.due_on === "string" ? dueOnToLocalInstant(r.due_on) : str(r.due_date),
        bucketId: str(r.bucket_id),
        assigneeId: str(r.assignee_id),
        number: typeof r.number === "number" ? r.number : r.number ? Number(r.number) : null,
        deletedAt: str(r.deleted_at),
      }));
      if (!card || rows.length === 0) return rows;

      const bucketIds = unique(rows.map((r) => r.bucketId));
      const [buckets, subtasks] = await Promise.all([
        bucketIds.length
          ? client
              .from("buckets")
              .select("id, name, is_system")
              .eq("workspace_id", workspaceId)
              .in("id", bucketIds)
          : Promise.resolve({ data: [] as Row[], error: null }),
        client
          .from("tasks")
          .select("parent_id, status")
          .eq("workspace_id", workspaceId)
          .in(
            "parent_id",
            rows.map((r) => r.id),
          )
          .is("deleted_at", null),
      ]);
      fail(buckets.error);
      fail(subtasks.error);
      const bucketById = new Map(((buckets.data ?? []) as Row[]).map((b) => [b.id as string, b]));
      const counts = new Map<string, { done: number; total: number }>();
      for (const s of (subtasks.data ?? []) as Row[]) {
        const c = counts.get(s.parent_id) ?? { done: 0, total: 0 };
        c.total += 1;
        if (s.status === "done") c.done += 1;
        counts.set(s.parent_id, c);
      }
      return rows.map((r) => {
        const bucket = r.bucketId ? bucketById.get(r.bucketId) : undefined;
        return {
          ...r,
          projectName: bucket ? (str(bucket.name) ?? "") : null,
          projectIsInbox: bucket ? bucket.is_system === true : false,
          subtasks: counts.get(r.id) ?? null,
        };
      });
    },

    async projects({ workspaceId, ids, card }) {
      if (!ids.length) return [];
      const { data, error } = await client
        .from("buckets")
        .select("id, name, is_system, deleted_at")
        .eq("workspace_id", workspaceId)
        .in("id", ids);
      fail(error);
      const rows: ProjectPreviewRow[] = ((data ?? []) as Row[]).map((r) => ({
        id: r.id,
        name: str(r.name) ?? "",
        isSystem: r.is_system === true,
        deletedAt: str(r.deleted_at),
      }));
      if (!card) return rows;
      // Two counts per project (head requests: no rows travel).
      const count = async (bucketId: string, statuses: string[]) => {
        const res = await client
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .eq("bucket_id", bucketId)
          .is("deleted_at", null)
          .is("parent_id", null)
          .in("status", statuses);
        fail(res.error);
        return res.count ?? 0;
      };
      return Promise.all(
        rows.map(async (r) => {
          if (r.deletedAt) return r;
          const [done, total] = await Promise.all([count(r.id, ["done"]), count(r.id, COUNTED)]);
          return { ...r, progress: { done, total } };
        }),
      );
    },

    async notes({ workspaceId, ids, card }) {
      if (!ids.length) return [];
      const { data, error } = await client
        .from("notes")
        .select(`id, title, icon, updated_at, deleted_at${card ? ", body_text" : ""}`)
        .eq("workspace_id", workspaceId)
        .in("id", ids);
      fail(error);
      return ((data ?? []) as Row[]).map(
        (r): NotePreviewRow => ({
          id: r.id,
          title: str(r.title) ?? "",
          icon: str(r.icon),
          updatedAt: str(r.updated_at) ?? "",
          deletedAt: str(r.deleted_at),
          excerpt: card ? excerptOf(str(r.body_text)) : undefined,
        }),
      );
    },

    async events({ workspaceId, ids }) {
      if (!ids.length) return [];
      const { data, error } = await client
        .from("calendar_events")
        .select("id, title, start_time, end_time, all_day, attendees, deleted_at")
        .eq("workspace_id", workspaceId)
        .in("id", ids);
      fail(error);
      return ((data ?? []) as Row[]).map(
        (r): EventPreviewRow => ({
          id: r.id,
          title: str(r.title) ?? "",
          startsAt: str(r.start_time) ?? "",
          endsAt: str(r.end_time) ?? "",
          allDay: r.all_day === true,
          attendeeCount: Array.isArray(r.attendees) ? r.attendees.length : 0,
          deletedAt: str(r.deleted_at),
        }),
      );
    },

    async contacts({ workspaceId, ids, kind }) {
      if (!ids.length) return [];
      if (kind === "company") {
        const { data, error } = await client
          .from("companies")
          .select("id, name, avatar_url, website, deleted_at")
          .eq("workspace_id", workspaceId)
          .in("id", ids);
        fail(error);
        return ((data ?? []) as Row[]).map(
          (r): ContactPreviewRow => ({
            id: r.id,
            kind: "company",
            name: str(r.name) ?? "",
            role: null,
            companyName: null,
            email: str(r.website),
            avatarUrl: str(r.avatar_url),
            deletedAt: str(r.deleted_at),
          }),
        );
      }
      const { data, error } = await client
        .from("contacts")
        .select("id, name, title, email, avatar_url, company_id, deleted_at")
        .eq("workspace_id", workspaceId)
        .in("id", ids);
      fail(error);
      const rows = (data ?? []) as Row[];
      const companyIds = unique(rows.map((r) => str(r.company_id)));
      const companies = companyIds.length
        ? await client
            .from("companies")
            .select("id, name")
            .eq("workspace_id", workspaceId)
            .in("id", companyIds)
        : { data: [] as Row[], error: null };
      fail(companies.error);
      const companyName = new Map(
        ((companies.data ?? []) as Row[]).map((c) => [c.id as string, str(c.name)]),
      );
      return rows.map(
        (r): ContactPreviewRow => ({
          id: r.id,
          kind: "contact",
          name: str(r.name) ?? "",
          role: str(r.title),
          companyName: r.company_id ? (companyName.get(r.company_id) ?? null) : null,
          email: str(r.email),
          avatarUrl: str(r.avatar_url),
          deletedAt: str(r.deleted_at),
        }),
      );
    },

    async emails({ workspaceId, ids }) {
      if (!ids.length) return [];
      const { data, error } = await client
        .from("email_refs")
        .select(
          "id, subject, from_name, from_addr, snippet, sent_at, follow_up_at, follow_up_cleared_at, deleted_at",
        )
        .eq("workspace_id", workspaceId)
        .in("id", ids);
      fail(error);
      return ((data ?? []) as Row[]).map(
        (r): EmailPreviewRow => ({
          id: r.id,
          subject: str(r.subject) ?? "",
          fromName: str(r.from_name),
          fromAddr: str(r.from_addr),
          snippet: str(r.snippet),
          sentAt: str(r.sent_at),
          waitingOnReply: !!r.follow_up_at && !r.follow_up_cleared_at,
          deletedAt: str(r.deleted_at),
        }),
      );
    },

    async tags({ workspaceId, ids }) {
      if (!ids.length) return [];
      const { data, error } = await client
        .from("tags")
        .select("id, name, color, deleted_at")
        .eq("workspace_id", workspaceId)
        .in("id", ids);
      fail(error);
      return ((data ?? []) as Row[]).map(
        (r): TagPreviewRow => ({
          id: r.id,
          name: str(r.name) ?? "",
          color: str(r.color),
          deletedAt: str(r.deleted_at),
        }),
      );
    },

    async searchProjects({ workspaceId, query, limit }) {
      let q = client
        .from("buckets")
        .select("id, name, is_system")
        .eq("workspace_id", workspaceId)
        .eq("is_system", false)
        .is("deleted_at", null);
      const trimmed = query.trim();
      if (trimmed) q = q.ilike("name", `%${likeEscape(trimmed)}%`);
      const { data, error } = await q.order("name").limit(limit ?? 5);
      fail(error);
      return ((data ?? []) as Row[]).map((r) => ({
        id: r.id,
        name: str(r.name) ?? "",
        isSystem: r.is_system === true,
      }));
    },

    async searchTags({ workspaceId, query, limit }) {
      let q = client
        .from("tags")
        .select("id, name, color")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null);
      const trimmed = query.trim();
      if (trimmed) q = q.ilike("name", `%${likeEscape(trimmed)}%`);
      const { data, error } = await q.order("name").limit(limit ?? 8);
      fail(error);
      return ((data ?? []) as Row[]).map((r) => ({
        id: r.id,
        name: str(r.name) ?? "",
        color: str(r.color),
      }));
    },

    async resolveHandle({ workspaceId, handle }) {
      const typed = handle.trim().toUpperCase();
      if (!/^[A-Z]{2,5}-\d{1,9}$/.test(typed)) return null;
      // A handle typed with an earlier key of this workspace means the same task.
      const { data: ws } = await client
        .from("workspaces")
        .select("task_key, task_key_aliases")
        .eq("id", workspaceId)
        .maybeSingle();
      const current = handleWithCurrentKey(
        typed,
        str(ws?.task_key),
        Array.isArray(ws?.task_key_aliases) ? ws.task_key_aliases : [],
      );
      const { data, error } = await client
        .from("entities")
        .select("entity_id")
        .eq("workspace_id", workspaceId)
        .eq("entity_type", "task")
        .eq("handle", current)
        .limit(1);
      if (isMissingColumnError(error, "handle")) return null;
      fail(error);
      const row = ((data ?? []) as Row[])[0];
      return row ? (str(row.entity_id) ?? null) : null;
    },
  };
}
