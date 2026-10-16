/**
 * Tasks — module #1 on the Moduo MCP connector (docs/moduo-mcp-connector.md).
 *
 * Read tools mirror the manifest's resources (src/features/tasks/
 * ops-manifest.ts — keep the descriptions in sync); write tools are the
 * agent-meaningful intent ops, calling the same RPCs the app uses
 * (docs/moduo-module-contract.md), so every gate the app has holds here:
 * a task or project the key's person can't see reads exactly like one that
 * isn't there, and nothing counts hidden items. Where an op needs occurrence
 * math the connector runs the engine port (../recurrence.ts) first — agents
 * are never asked to compute rrule pointers. `tasks.catch_up` is deliberately
 * not exposed: it is an app-lifecycle batch pass, not an agent intent.
 *
 * TV-D16 (specs/tasks-v3.md §12, §Assumptions #14): projects, sections,
 * areas, statuses, teams and templates; status by category or name; teams,
 * claims, hand-offs, comments when asked, work sessions, reminders, repeats;
 * the agent's session status; imports with "imported from" keys, re-runs and
 * Undo; every task argument takes a handle (MOD-142) or a uuid. The older
 * names (tasks_today, tasks_commit, tasks_uncommit, tasks_skip_today,
 * tasks_list_buckets) are deprecated and stay until TV-D7.
 *
 * Every tool's RPC is named literally (`callOp(ctx, "…"` or `.rpc("…"`) so
 * src/features/settings/api-keys.test.ts can walk it to the key lanes it hits.
 */

import { ATTACHMENTS_BUCKET, ATTACHMENT_LINK_TTL_SECONDS } from "../../_shared/contracts/attachments.ts";
import {
  AGENT_SESSION_STATES,
  ENERGY_LEVELS,
  PRIORITY_LEVELS,
  PROJECT_STATES,
  TASK_REMINDER_KINDS,
  TASK_STATUS_CATEGORIES,
  TASK_STATUSES,
  TEMPLATE_KINDS,
  isTaskStatus,
  normalizeTaskStatusCategory,
} from "../../_shared/contracts/vocabularies.ts";
import { keyCanSeeEntityType, keyScopeAllows } from "../../_shared/contracts/mcp-key-scopes.ts";
import {
  dateMarkdown,
  defuseReferences,
  descriptionTokens,
  escapeMarkdownText,
  guardMarkdownStart,
  htmlToMarkdown,
  isHtmlDescription,
  referenceMarkdown,
} from "../../_shared/description-markdown.ts";
import { assigneeCandidates, resolveAssigneeArg } from "../../_shared/task-people.ts";
import {
  LIST_PAGE,
  MAX_PAGE,
  type SummaryNames,
  filterByAssignee,
  focusSettingsFrom,
  isDrifted,
  orderByBucket,
  pageOf,
  parseAssignee,
  rowTaskState,
  shapeComment,
  shapeTask,
  shapeTaskSummary,
  TASK_GET_COMMENTS,
  topLevelOnly,
} from "../../_shared/tasks-connector.ts";
import type { ConnectorModule, ToolContext } from "../registry.ts";
import { assertReach, entityComments, reachOrNull, visibleIds } from "../share.ts";
import {
  pointerOnStatusChange,
  skipOccurrenceTargets,
  type RecurringTaskRow,
} from "../recurrence.ts";
import {
  HANDLE,
  NOTIFICATION_ONLY_OP,
  archivedBucketIds,
  callOp,
  clampLimit,
  colourBareTags,
  dayOrThrow,
  fetchProject,
  fetchTask,
  isRowClosed,
  isoOrThrow,
  loadWorkspace,
  recurrenceFromArg,
  resolveTaskRef,
  rows,
  shapeOne,
  shapedQueue,
  str,
  unwrap,
  workspaceMembers,
  type Row,
} from "../tasks-helpers.ts";

const DEPRECATED = "Deprecated (kept until TV-D7):";

/**
 * A description is Markdown, read and written (call #15, MOD-120): what the
 * app's editor types and saves, and what an older (HTML) description reads
 * as. References keep no title (RF-1), only the item's kind.
 */
const DESCRIPTION_MARKDOWN =
  'Markdown: **bold**, *italic*, `code`, ``` fenced code ```, [links](https://…), "- " bullets, "1. " numbers, "- [ ] " checkboxes, "> " quotes (HTML is converted). Reference an item as [task](moduo://task/<uuid or handle, e.g. MOD-12>) (or note, contact, company, email_thread, event, project; it shows by name to whoever can open it, an item you cannot reach stays as its words, and with Links at Edit each one is linked from the task), a date as [Oct 17](moduo://date/2026-10-17).';

/** How many different items one description written through the connector may reference. */
const MAX_DESCRIPTION_REFERENCES = 50;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A description reference's type as the reach check knows it (the app also says project and email). */
function reachType(type: string): string {
  return type === "project" ? "bucket" : type === "email" ? "email_thread" : type;
}

/**
 * A description written through the connector, as the app stores it (call
 * #15). HTML sent by an agent is read as Markdown first (the converter the
 * reads use), so whatever it can turn into a reference is checked like the
 * rest. Then the Markdown is read for references once (`descriptionTokens`,
 * the pattern the editor reads them with) and written back from that one
 * reading:
 * - a reference is resolved and checked for the key (`reachOrNull`, assertReach's check: the key's
 *   scope, the item live in this workspace, its person able to see it); a
 *   task's handle (`moduo://task/MOD-12`) becomes its uuid; only a reference
 *   that passed is written as one (labelled with its kind, RF-1), and only
 *   those are answered as the items to link (one inside code, shown as
 *   code, links nothing); a failed lookup fails the write;
 * - anything else (an item the key can't reach or that isn't there, a kind
 *   agents can't point at, a tag, past MAX_DESCRIPTION_REFERENCES) goes back
 *   to its label as plain words;
 * - every word between them passes through `defuseReferences`, so no word,
 *   label or join of the two reads as a reference later;
 * - words that would read as HTML keep their first `<` escaped.
 */
async function describeForWrite(
  ctx: ToolContext,
  value: string,
): Promise<{ markdown: string; refs: Array<{ type: string; id: string }> }> {
  const tokens = descriptionTokens(isHtmlDescription(value) ? htmlToMarkdown(value) : value);
  const checked = new Map<string, string | null>();
  for (const token of tokens) {
    if (token.kind !== "link" || token.type === "date") continue;
    const key = `${token.type}\u0000${token.id}`;
    if (checked.has(key)) continue;
    if (checked.size >= MAX_DESCRIPTION_REFERENCES) {
      checked.set(key, null);
      continue;
    }
    // assertReach's check; a refusal is words, a failed lookup fails the write.
    checked.set(key, await reachOrNull(ctx, reachType(token.type), token.id));
  }
  const refs: Array<{ type: string; id: string }> = [];
  const linked = new Set<string>();
  let out = "";
  let words = "";
  const live = (markdown: string) => {
    out += defuseReferences(words) + markdown;
    words = "";
  };
  for (const token of tokens) {
    if (token.kind === "text") {
      words += token.text;
    } else if (token.type === "date") {
      if (ISO_DAY.test(token.id)) live(dateMarkdown(token.id, token.label));
      else words += escapeMarkdownText(token.label);
    } else {
      const uuid = checked.get(`${token.type}\u0000${token.id}`) ?? null;
      if (!uuid) {
        words += escapeMarkdownText(token.label);
        continue;
      }
      // Written the same in code or out of it (as checked, never the agent's
      // own spelling); one in code is shown as code, so it links nothing.
      live(referenceMarkdown(token.type, uuid, token.display));
      if (token.inCode) continue;
      const target = reachType(token.type);
      if (!linked.has(`${target}:${uuid}`)) {
        linked.add(`${target}:${uuid}`);
        refs.push({ type: target, id: uuid });
      }
    }
  }
  live("");
  return { markdown: guardMarkdownStart(out), refs };
}

/**
 * Link a task to what its description references, as quick capture does
 * (`mentions`, origin `mention`), through the links op. Only a key with Links
 * at Edit makes links; the references were checked by `describeForWrite`.
 * Quiet: the reference is in the text either way.
 */
async function linkDescribed(
  ctx: ToolContext,
  taskId: string,
  refs: ReadonlyArray<{ type: string; id: string }>,
): Promise<void> {
  if (!keyScopeAllows(ctx.key.scopes, "links", "edit")) return;
  for (const ref of refs) {
    if (ref.type === "task" && ref.id === taskId) continue;
    try {
      // An error comes back in the answer (not thrown) and is let go.
      await ctx.db.rpc("links_op_create", {
        p_workspace_id: ctx.key.workspaceId,
        p_source_type: "task",
        p_source_id: taskId,
        p_target_type: ref.type,
        p_target_id: ref.id,
        p_relation_kind: "mentions",
        p_origin: "mention",
      });
    } catch {
      // Quiet, as above.
    }
  }
}

/** The fields tasks_create / tasks_update take, as the ops want them. */
function taskFieldsFromArgs(args: Row): Row {
  const fields: Row = {};
  if (typeof args.title === "string") fields.title = str(args, "title");
  // The description is prepared apart (`describeForWrite`): it reads the database.
  if ("due_on" in args) fields.due_on = args.due_on === null ? null : dayOrThrow(str(args, "due_on"), "due_on");
  if ("due_time" in args) fields.due_time = args.due_time ?? null;
  for (const name of ["due_date", "scheduled_at"]) {
    if (!(name in args)) continue;
    // TV-D9: a due date given as a date alone is that date for everyone.
    if (name === "due_date" && typeof args[name] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args[name] as string)) {
      fields.due_on = args[name];
      continue;
    }
    fields[name] = args[name] === null ? null : isoOrThrow(str(args, name), name);
  }
  if ("duration_minutes" in args) fields.duration_minutes = args.duration_minutes ?? null;
  if ("estimate_minutes" in args) fields.estimate_minutes = args.estimate_minutes ?? null;
  if ("priority" in args) fields.priority = args.priority ?? null;
  if ("energy_level" in args) fields.energy_level = args.energy_level ?? null;
  if ("status" in args && typeof args.status === "string") fields.status = str(args, "status");
  if ("section_id" in args) fields.section_id = args.section_id ?? null;
  if ("team_id" in args) fields.team_id = args.team_id ?? null;
  if ("repeat" in args) fields.recurrence = recurrenceFromArg(args.repeat);
  return fields;
}

/**
 * Call 87, as the app does: finishing a top-level task that isn't a repeat
 * finishes its open subtasks, the ones the key's person can edit (a refused
 * one stays open and isn't counted). `finish` sends one subtask's status
 * (the tool names its RPC, so the key-lane check sees it).
 */
async function finishOpenSubtasks(
  ctx: ToolContext,
  before: Row,
  after: Row,
  finish: (subtaskId: string) => PromiseLike<{ error: unknown }>,
): Promise<number> {
  if (after?.status_category !== "done" || isRowClosed(before) || before.parent_id || before.recurrence) {
    return 0;
  }
  const data = await loadWorkspace(ctx);
  let finished = 0;
  // Subtasks in an archived project finish too, as in the app.
  const all = [...data.tasks, ...data.archivedTasks];
  for (const sub of all.filter((t) => t.parent_id === before.id && !isRowClosed(t))) {
    const res = await finish(sub.id as string);
    if (!res.error) finished += 1;
  }
  return finished;
}

/** The project an agent names: `project_id`, or the older `bucket_id`. */
function projectArg(args: Row): string {
  return str(args, "project_id", false) || str(args, "bucket_id", false);
}

const taskIdSchema = {
  type: "object",
  properties: { task_id: { type: "string", description: "Task handle (MOD-142) or uuid." } },
  required: ["task_id"],
} as const;

const TASK_ID = { type: "string", description: "Task handle (MOD-142) or uuid." } as const;

/** Statuses a list filters on: a category, open (to do + in progress) or closed. */
const LIST_CATEGORIES = ["open", "closed", ...TASK_STATUS_CATEGORIES] as const;

/** The legacy status words read as their category (Backlog isn't "todo"). */
function categoryOfStatusWord(word: string): string {
  if (word === "archived") return "wont_do";
  return word;
}

function matchesCategory(t: Row, category: string): boolean {
  const state = rowTaskState(t);
  const cat = state.statusCategory ?? normalizeTaskStatusCategory(t.status === "archived" ? "wont_do" : t.status);
  if (category === "open") return cat === "todo" || cat === "in_progress";
  if (category === "closed") return cat === "done" || cat === "wont_do";
  return cat === category;
}

/** Areas the key's person can see (as `areas__visible`): workspace areas,
 *  their own, and the ones a project they see is filed in. */
async function visibleAreas(ctx: ToolContext): Promise<Row[]> {
  const ws = ctx.key.workspaceId;
  const [areas, buckets, seen] = await Promise.all([
    rows(ctx.db.from("areas").select("id, name, color, position, shared, created_by")
      .eq("workspace_id", ws).is("deleted_at", null)),
    rows(ctx.db.from("buckets").select("id, area_id").eq("workspace_id", ws).is("deleted_at", null)),
    visibleIds(ctx, "bucket"),
  ]);
  const filed = new Set(buckets.filter((b) => b.area_id && seen.has(b.id)).map((b) => b.area_id));
  return areas
    .filter((a) => a.shared || a.created_by === ctx.key.createdBy || filed.has(a.id))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/** A project's client as the key may see it (MOD-155), keyed `type:id`. */
type ClientNames = ReadonlyMap<string, Row>;
const NO_CLIENTS: ClientNames = new Map();

function clientKeyOf(b: Row): string | null {
  if (typeof b.client_company_id === "string") return `company:${b.client_company_id}`;
  if (typeof b.client_contact_id === "string") return `contact:${b.client_contact_id}`;
  return null;
}

/**
 * MOD-155: the clients of these projects, a person or a company, named only
 * for a key with Contacts at View and only when the key's person can open
 * them (the service role bypasses RLS, so the check is here). Anything else
 * is left out: a key without Contacts never learns who a client is.
 */
async function projectClients(ctx: ToolContext, buckets: readonly Row[]): Promise<ClientNames> {
  if (!keyCanSeeEntityType(ctx.key.scopes, "contact") || !keyCanSeeEntityType(ctx.key.scopes, "company")) {
    return NO_CLIENTS;
  }
  const ids = (column: string) => [
    ...new Set(buckets.map((b) => b[column]).filter((v): v is string => typeof v === "string")),
  ];
  const kinds = [
    { type: "contact", table: "contacts", ids: ids("client_contact_id") },
    { type: "company", table: "companies", ids: ids("client_company_id") },
  ].filter((k) => k.ids.length > 0);
  const out = new Map<string, Row>();
  await Promise.all(
    kinds.map(async (k) => {
      const [seen, found] = await Promise.all([
        visibleIds(ctx, k.type),
        rows(ctx.db.from(k.table).select("id, name")
          .eq("workspace_id", ctx.key.workspaceId).in("id", k.ids).is("deleted_at", null)),
      ]);
      for (const r of found) {
        if (!seen.has(r.id)) continue;
        const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : null;
        out.set(`${k.type}:${r.id}`, {
          type: k.type,
          id: r.id,
          name: name ?? (k.type === "company" ? "Untitled company" : "Unnamed contact"),
        });
      }
    }),
  );
  return out;
}

/**
 * The client a create or update names, checked for the key (MOD-155): the
 * key needs Contacts at View, the person or company must be one its person
 * can open (a private one reads as missing), and it's one or the other.
 * Answers the fields to send, with the ids as found.
 */
async function clientFields(ctx: ToolContext, args: Row, clearing: boolean): Promise<Row> {
  const out: Row = {};
  const given = (["client_contact_id", "client_company_id"] as const).filter((k) =>
    clearing ? k in args : typeof args[k] === "string",
  );
  if (!given.length) return out;
  if (typeof args.client_contact_id === "string" && typeof args.client_company_id === "string") {
    throw new Error("A project's client is a person or a company, not both.");
  }
  // Clearing one too: a key that can't see clients doesn't touch them.
  if (!keyCanSeeEntityType(ctx.key.scopes, "contact")) {
    throw new Error("This API key has no access to Contacts.");
  }
  for (const k of given) {
    const value = args[k];
    out[k] = typeof value === "string"
      ? await assertReach(ctx, k === "client_company_id" ? "company" : "contact", value)
      : null;
  }
  return out;
}

function shapeProject(b: Row, names: ReadonlyMap<string, string>, clients: ClientNames = NO_CLIENTS): Row {
  const clientKey = clientKeyOf(b);
  const client = clientKey ? clients.get(clientKey) : undefined;
  return {
    id: b.id,
    name: b.name,
    ...(b.is_system ? { is_inbox: true } : {}),
    ...(b.status ? { status: b.status } : {}),
    ...(b.area_id ? { area_id: b.area_id } : {}),
    ...(b.color ? { color: b.color } : {}),
    ...(b.starts_on ? { starts_on: b.starts_on } : {}),
    ...(b.target_on ? { target_on: b.target_on } : {}),
    ...(b.lead_id ? { lead: { id: b.lead_id, name: names.get(b.lead_id) ?? "Former member" } } : {}),
    // MOD-155: a person or a company, only when the key may see it.
    ...(client ? { client } : {}),
    // TV-U16's description (plain text, '' for none); TV-U13b carries it.
    ...(typeof b.description === "string" && b.description.trim()
      ? { description: b.description }
      : {}),
    ...(b.archived_at && !b.is_system ? { archived: true } : {}),
  };
}

/** A template as agents see it: never its body or what it was made from. */
function shapeTemplate(t: Row, kind: "task" | "project", me: string): Row {
  const s = (t.summary ?? {}) as Row;
  return {
    id: t.id,
    kind,
    name: t.name,
    shared: t.shared === true,
    mine: t.owner_id === me,
    tasks: typeof s.tasks === "number" ? s.tasks : null,
    ...(kind === "project" && typeof s.sections === "number" ? { sections: s.sections } : {}),
    dated: s.dated === true,
  };
}

export const tasksConnectorModule: ConnectorModule = {
  module: "tasks",
  tools: [
    // ── reads (view scope) ───────────────────────────────────────────────
    {
      name: "projects_list",
      description:
        "The projects the key's person can see, in sidebar order: their Inbox (is_inbox), status (active · on_hold · done), area, colour, start and target dates, lead, client (a person or a company, {type: contact | company, id, name}; only with Contacts access, and only one the person can open), and the project's description (plain text) when it has one. Archived projects (and their tasks) are left out unless include_archived is true; then they carry archived: true.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          include_archived: { type: "boolean", description: "Also list archived projects. Default false." },
        },
      },
      handler: async (args, ctx) => {
        const [buckets, visible, members] = await Promise.all([
          rows(ctx.db.from("buckets").select("*")
            .eq("workspace_id", ctx.key.workspaceId).is("deleted_at", null).order("position")),
          visibleIds(ctx, "bucket"),
          workspaceMembers(ctx),
        ]);
        const archived = archivedBucketIds(buckets);
        const names = new Map(members.map((m) => [m.user_id, m.name]));
        const shown = buckets
          .filter((b) => visible.has(b.id) && (args?.include_archived === true || !archived.has(b.id)))
          .sort((a, b) => Number(!!b.is_system) - Number(!!a.is_system));
        const clients = await projectClients(ctx, shown);
        return shown.map((b) => shapeProject(b, names, clients));
      },
    },
    {
      name: "tasks_list_buckets",
      description: `${DEPRECATED} use projects_list. The workspace's projects ("buckets"; the reserved Inbox is is_system), with area_id and colour. Archived projects (and their tasks) are left out unless include_archived is true; then they carry archived: true.`,
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          include_archived: {
            type: "boolean",
            description: "Also list archived projects, marked archived: true. Default false.",
          },
        },
      },
      handler: async (args, ctx) => {
        // select("*"): a database without TV-U6's columns still answers.
        const buckets = await rows(
          ctx.db.from("buckets")
            .select("*")
            .eq("workspace_id", ctx.key.workspaceId).is("deleted_at", null)
            .order("position"),
        );
        const visible = await visibleIds(ctx, "bucket");
        const archived = archivedBucketIds(buckets);
        const withArchived = args?.include_archived === true;
        return buckets
          .filter((b) => visible.has(b.id) && (withArchived || !archived.has(b.id)))
          .map((b) => ({
            id: b.id,
            name: b.name,
            is_system: b.is_system,
            // The old answer stays the same until TV-D7 (its group label), plus the area.
            ...(b.group_label ? { group: b.group_label } : {}),
            ...(b.area_id ? { area_id: b.area_id } : {}),
            ...(b.color ? { color: b.color } : {}),
            ...(archived.has(b.id) ? { archived: true } : {}),
          }));
      },
    },
    {
      name: "areas_list",
      description: "The areas the sidebar groups projects under, as the key's person sees them.",
      access: "view",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, ctx) =>
        (await visibleAreas(ctx)).map((a) => ({ id: a.id, name: a.name, ...(a.color ? { color: a.color } : {}) })),
    },
    {
      name: "sections_list",
      description: "A project's sections, in order, with their optional start and end dates (an end alone is a milestone).",
      access: "view",
      inputSchema: {
        type: "object",
        properties: { project_id: { type: "string", description: "Project uuid (see projects_list)." } },
        required: ["project_id"],
      },
      handler: async (args, ctx) => {
        const project = await fetchProject(ctx, str(args, "project_id"));
        const found = await rows(
          ctx.db.from("sections").select("id, name, position, starts_on, ends_on")
            .eq("workspace_id", ctx.key.workspaceId).eq("project_id", project.id).is("deleted_at", null)
            .order("position"),
        );
        return found.map((s) => ({
          id: s.id,
          name: s.name,
          ...(s.starts_on ? { starts_on: s.starts_on } : {}),
          ...(s.ends_on ? { ends_on: s.ends_on } : {}),
        }));
      },
    },
    {
      name: "statuses_list",
      description:
        "A project's statuses, each in its category (backlog · todo · in_progress · done · wont_do), in order; without a project, the workspace's default set (which the Inbox uses). tasks_set_status and tasks_create take a category word, a status's name or its id.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: { project_id: { type: "string", description: "Project uuid. Default: the workspace's default statuses." } },
      },
      handler: async (args, ctx) => {
        const projectId = str(args, "project_id", false);
        let query = ctx.db.from("project_statuses").select("id, name, category, position")
          .eq("workspace_id", ctx.key.workspaceId).is("deleted_at", null);
        if (projectId) {
          const project = await fetchProject(ctx, projectId);
          query = project.is_system ? query.is("project_id", null) : query.eq("project_id", project.id);
        } else {
          query = query.is("project_id", null);
        }
        const found = await rows(query.order("position"));
        const rank = (c: string) => (TASK_STATUS_CATEGORIES as readonly string[]).indexOf(c);
        return found
          .sort((a, b) => rank(a.category) - rank(b.category) || (a.position ?? 0) - (b.position ?? 0))
          .map((s) => ({ id: s.id, name: s.name, category: s.category }));
      },
    },
    {
      name: "teams_list",
      description:
        "The workspace's teams: name, colour, members (with is_me) and their default project when the key's person can see it. tasks_route_team routes a task to one.",
      access: "view",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, ctx) => {
        const ws = ctx.key.workspaceId;
        const [teams, memberRows, members, visible] = await Promise.all([
          rows(ctx.db.from("teams").select("id, name, color, default_project_id")
            .eq("workspace_id", ws).is("deleted_at", null)),
          rows(ctx.db.from("team_members").select("team_id, user_id")
            .eq("workspace_id", ws).is("deleted_at", null)),
          workspaceMembers(ctx),
          visibleIds(ctx, "bucket"),
        ]);
        const names = new Map(members.map((m) => [m.user_id, m.name]));
        return teams.map((t) => ({
          id: t.id,
          name: t.name,
          ...(t.color ? { color: t.color } : {}),
          ...(t.default_project_id && visible.has(t.default_project_id)
            ? { default_project_id: t.default_project_id }
            : {}),
          members: memberRows
            .filter((m) => m.team_id === t.id)
            .map((m) => ({ id: m.user_id, name: names.get(m.user_id) ?? "Former member", is_me: m.user_id === ctx.key.createdBy })),
        }));
      },
    },
    {
      name: "templates_list",
      description:
        "Task and project templates the key's person can use: their own and the ones shared with the workspace. templates_apply makes a task or project from one. Agents can't share, edit or delete templates.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: { kind: { type: "string", enum: [...TEMPLATE_KINDS], description: "Only this kind. Default: both." } },
      },
      handler: async (args, ctx) => {
        const ws = ctx.key.workspaceId;
        const me = ctx.key.createdBy;
        const kind = typeof args.kind === "string" ? args.kind : null;
        const columns = "id, owner_id, name, shared, summary, updated_at";
        const read = async (table: string, k: "task" | "project") => {
          if (kind && kind !== k) return [];
          const found = await rows(ctx.db.from(table).select(columns).eq("workspace_id", ws).is("deleted_at", null));
          return found.filter((t) => t.owner_id === me || t.shared === true).map((t) => shapeTemplate(t, k, me));
        };
        const [tasks, projects] = await Promise.all([read("task_templates", "task"), read("project_templates", "project")]);
        return [...projects, ...tasks].sort((a, b) => String(a.name).localeCompare(String(b.name)));
      },
    },
    {
      name: "tasks_list",
      description:
        "Tasks, a short row each (fields: summary, the default): handle, id, title, status (its category; status_name when the project calls it something else), priority, assignee's name (none = Unassigned), project (when the list spans projects), section, tags, due (YYYY-MM-DD, with HH:MM when timed), and blocked, drifted, queued_by_me, subtasks (a count) and parent only when they apply. fields: full gives each task's full shape instead (ids, people, description excerpt, dates, estimate, repeat, …); tasks_get reads one in full. Defaults to open tasks (to do + in progress), ordered by project then position. Filters: category (or a legacy status word), project, section, area, team, assignee, completed range. Pages with offset.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Only this project." },
          bucket_id: { type: "string", description: "Older name for project_id." },
          section_id: { type: "string", description: "Only this section." },
          area_id: { type: "string", description: "Only projects filed in this area." },
          team_id: { type: "string", description: "Only tasks routed to this team." },
          category: {
            type: "string",
            enum: [...LIST_CATEGORIES],
            description: "open (default: to do + in progress), closed (done + won't do), or one category.",
          },
          status: {
            type: "string",
            enum: ["open", ...TASK_STATUSES],
            description: "Older filter: a legacy status word, read as its category (todo leaves Backlog out; archived = won't do).",
          },
          assignee: {
            type: "string",
            enum: ["me", "anyone"],
            description: "'me' = tasks assigned to the key's creator (not ones they only created; Unassigned tasks are nobody's); 'anyone' (default) = every task you can see.",
          },
          completed_from: { type: "string", description: "Finished on or after this date (YYYY-MM-DD); implies closed tasks." },
          completed_to: { type: "string", description: "Finished on or before this date (YYYY-MM-DD)." },
          top_level: {
            type: "boolean",
            description: "Only top-level tasks (no parent in the result); subtasks are summarised in subtask_count. Default false.",
          },
          include_archived: {
            type: "boolean",
            description: "Also tasks in archived projects, marked project_archived: true. Default false.",
          },
          fields: {
            type: "string",
            enum: ["summary", "full"],
            description: "summary (default): the short row. full: every task's full shape (much longer; default page 25).",
          },
          limit: {
            type: "number",
            description: `Max tasks per page (default ${LIST_PAGE.summary}, or ${LIST_PAGE.full} with fields: full; max ${MAX_PAGE}).`,
          },
          offset: { type: "number", description: "Skip this many tasks (default 0). A page shorter than limit is the last." },
        },
      },
      handler: async (args, ctx) => {
        const data = await loadWorkspace(ctx);
        const now = new Date();
        const from = str(args, "completed_from", false);
        const to = str(args, "completed_to", false);
        const category = typeof args.category === "string"
          ? args.category
          : typeof args.status === "string"
            ? (args.status === "open" ? "open" : categoryOfStatusWord(args.status))
            : from || to ? "closed" : "open";
        const projectId = projectArg(args);
        const archivedIds = new Set(data.archivedTasks.map((t) => t.id));
        const pool = args.include_archived === true ? [...data.tasks, ...data.archivedTasks] : data.tasks;
        let list = filterByAssignee(pool, parseAssignee(args.assignee), ctx.key.createdBy);
        if (projectId) list = list.filter((t) => t.bucket_id === projectId);
        const sectionId = str(args, "section_id", false);
        if (sectionId) list = list.filter((t) => t.section_id === sectionId);
        const teamId = str(args, "team_id", false);
        if (teamId) list = list.filter((t) => t.team_id === teamId);
        list = list.filter((t) => matchesCategory(t, category));
        if (from) {
          const day = dayOrThrow(from, "completed_from");
          list = list.filter((t) => t.completed_at && String(t.completed_at).slice(0, 10) >= day);
        }
        if (to) {
          const day = dayOrThrow(to, "completed_to");
          list = list.filter((t) => t.completed_at && String(t.completed_at).slice(0, 10) <= day);
        }
        if (args.top_level === true) list = topLevelOnly(list, new Set(list.map((t) => t.id)));
        const buckets = await rows(
          ctx.db.from("buckets").select("*")
            .eq("workspace_id", ctx.key.workspaceId).is("deleted_at", null),
        );
        const areaId = str(args, "area_id", false);
        if (areaId) {
          const inArea = new Set(buckets.filter((b) => b.area_id === areaId).map((b) => b.id));
          list = list.filter((t) => inArea.has(t.bucket_id));
        }
        const full = args.fields === "full";
        list = pageOf(
          orderByBucket(list, buckets),
          args.offset,
          clampLimit(args, full ? LIST_PAGE.full : LIST_PAGE.summary, MAX_PAGE),
        );
        const archivedMark = (t: Row) => (archivedIds.has(t.id) ? { project_archived: true } : {});
        if (full) return list.map((t) => ({ ...shapeTask(t, data, now), ...archivedMark(t) }));
        // MOD-113: names for the short rows, read only for what's on the page,
        // and only from projects the person can see (a task shared on its own
        // doesn't name its project, as in tasks_time_report).
        const sectionIds = [...new Set(list.map((t) => t.section_id).filter(Boolean))];
        const statusIds = [...new Set(list.map((t) => t.status_id).filter(Boolean))];
        const [seenProjects, sections, statuses] = await Promise.all([
          visibleIds(ctx, "bucket"),
          sectionIds.length
            ? rows(ctx.db.from("sections").select("id, name, project_id")
              .eq("workspace_id", ctx.key.workspaceId).in("id", sectionIds))
            : Promise.resolve([] as Row[]),
          statusIds.length
            ? rows(ctx.db.from("project_statuses").select("id, name, project_id")
              .eq("workspace_id", ctx.key.workspaceId).in("id", statusIds))
            : Promise.resolve([] as Row[]),
        ]);
        const named = (x: Row) => !x.project_id || seenProjects.has(x.project_id);
        const names: SummaryNames = {
          sections: new Map(sections.filter(named).map((x) => [x.id, x.name])),
          statuses: new Map(statuses.filter(named).map((x) => [x.id, x.name])),
          ...(projectId
            ? {}
            : { projects: new Map(buckets.filter((b) => seenProjects.has(b.id)).map((b) => [b.id, b.name])) }),
        };
        return list.map((t) => ({ ...shapeTaskSummary(t, data, now, names), ...archivedMark(t) }));
      },
    },
    {
      name: "tasks_focus_settings",
      description:
        "The key creator's Focus (pomodoro) settings from Moduo, with the app's defaults filled in: work/break lengths in minutes, long-break rhythm, auto-start and chime.",
      access: "view",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, ctx) => {
        const found = await rows(
          ctx.db.from("user_preferences").select("focus").eq("user_id", ctx.key.createdBy),
        );
        return focusSettingsFrom(found[0]?.focus);
      },
    },
    {
      name: "tasks_queue",
      description:
        "Your queue: the tasks the key's creator lined up to do next, in order. It's personal (other people's queues are theirs) and not tied to a date; completing, archiving or deleting a task takes it out.",
      access: "view",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, ctx) => ({ queue: await shapedQueue(ctx) }),
    },
    {
      name: "tasks_today",
      description: `${DEPRECATED} use tasks_queue. The key creator's queue. The queue isn't tied to a day any more, so date is accepted but doesn't filter.`,
      access: "view",
      inputSchema: {
        type: "object",
        properties: { date: { type: "string", description: "Ignored (YYYY-MM-DD; echoed back). Default: today, UTC." } },
      },
      handler: async (args, ctx) => {
        const date = args.date
          ? dayOrThrow(str(args, "date"), "date")
          : new Date().toISOString().slice(0, 10);
        return { date, queue: await shapedQueue(ctx) };
      },
    },
    {
      name: "tasks_drift",
      description:
        "Open tasks whose scheduled time has passed (ambient drift — factual, never an 'overdue' wall). Sorted oldest first.",
      access: "view",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, ctx) => {
        const data = await loadWorkspace(ctx);
        const now = new Date();
        return data.tasks
          .filter((t) => isDrifted(t, now))
          .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
          .map((t) => shapeTask(t, data, now));
      },
    },
    {
      name: "tasks_list_tags",
      description: "Workspace-level tags with how many of the tasks you can see use each (tags are shared across modules).",
      access: "view",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, ctx) => {
        const data = await loadWorkspace(ctx);
        const counts = new Map<string, number>();
        for (const names of data.taskTags.values()) {
          for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
        }
        return data.tags.map((t) => ({ id: t.id, name: t.name, color: t.color, task_count: counts.get(t.name) ?? 0 }));
      },
    },
    {
      name: "tasks_search",
      description:
        "Search tasks by words in the title and description, by handle (MOD-142) or by an import's key (ENG-123). Tasks in archived projects are found too, marked project_archived: true.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string", description: "Search text, a handle or an imported key." },
          limit: { type: "number", description: "Max results (default 25, max 100)." },
        },
        required: ["q"],
      },
      handler: async (args, ctx) => {
        const q = str(args, "q");
        const limit = clampLimit(args, 25, 100);
        // The server's search reads the title, the description and the
        // import key ("ENG-123"), and gates every match on its person.
        const [data, words] = await Promise.all([
          loadWorkspace(ctx),
          unwrap<string[] | null>(ctx.db.rpc("tasks_search", {
            p_workspace_id: ctx.key.workspaceId,
            p_query: q,
            p_limit: limit,
          })),
        ]);
        const ids: string[] = [];
        if (HANDLE.test(q)) {
          try {
            ids.push(await resolveTaskRef(ctx, q));
          } catch {
            // Not a handle here: the words still search.
          }
        }
        ids.push(...(words ?? []));
        const now = new Date();
        const archived = new Map(data.archivedTasks.map((t) => [t.id, t]));
        const out: Row[] = [];
        for (const id of [...new Set(ids)]) {
          const live = data.byId.get(id);
          if (live) out.push(shapeTask(live, data, now));
          else if (archived.has(id)) out.push({ ...shapeTask(archived.get(id)!, data, now), project_archived: true });
          if (out.length >= limit) break;
        }
        return out;
      },
    },
    {
      name: "tasks_get",
      description:
        "One task in full: properties (its description as Markdown, references as moduo:// links), tags, dependency edges (blockers and blocked), subtasks, work sessions, your reminders, what it waits on, agent sessions you can see, with Links: View its latest comments (up to 20, the newest last; earlier_comments counts the rest, which comments_list reads), and its recent attributed activity trail.",
      access: "view",
      inputSchema: taskIdSchema,
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        const taskId = task.id as string;
        const ws = ctx.key.workspaceId;
        const [data, activity, sessions, reminders, waiting, agents, comments] = await Promise.all([
          loadWorkspace(ctx),
          rows(
            ctx.db.from("module_activity")
              .select("op, actor_type, actor_label, payload, created_at")
              .eq("workspace_id", ws).eq("module", "tasks")
              .eq("entity_type", "task").eq("entity_id", taskId)
              .neq("op", NOTIFICATION_ONLY_OP)
              .order("created_at", { ascending: false }).limit(10),
          ),
          rows(ctx.db.from("task_sessions").select("id, user_id, starts_at, ends_at")
            .eq("workspace_id", ws).eq("task_id", taskId).is("deleted_at", null).order("starts_at")),
          rows(ctx.db.from("task_reminders").select("id, kind, at, fired_at, suspended_at")
            .eq("workspace_id", ws).eq("task_id", taskId).eq("user_id", ctx.key.createdBy).is("deleted_at", null)),
          rows(ctx.db.from("task_waiting").select("id, kind, ref, label, since")
            .eq("workspace_id", ws).eq("task_id", taskId).is("deleted_at", null)),
          unwrap<Row[] | null>(ctx.db.rpc("tasks_agent_sessions", { p_workspace_id: ws, p_task_id: taskId })),
          // Comments are the Links module's (the key card says so): none without
          // it. A failed comment read leaves them out instead of failing the task.
          keyScopeAllows(ctx.key.scopes, "links", "view")
            ? entityComments(ctx, "task", taskId, TASK_GET_COMMENTS).catch(() => null)
            : null,
        ]);
        const now = new Date();
        const titled = (id: string) => {
          const t = data.byId.get(id);
          return t ? { id, title: t.title, status: t.status } : null;
        };
        const person = (id: string) => ({ id, name: data.names.get(id) ?? "Former member" });
        return {
          ...shapeTask(task, data, now, true),
          blockers: data.relations
            .filter((r) => r.blocked_task_id === taskId).map((r) => titled(r.blocker_task_id))
            .filter(Boolean),
          blocking: data.relations
            .filter((r) => r.blocker_task_id === taskId).map((r) => titled(r.blocked_task_id))
            .filter(Boolean),
          subtasks: data.tasks
            .filter((t) => t.parent_id === taskId)
            .map((t) => ({ id: t.id, title: t.title, status: t.status, status_category: t.status_category })),
          work_sessions: sessions.map((s) => ({ id: s.id, person: person(s.user_id), starts_at: s.starts_at, ends_at: s.ends_at })),
          my_reminders: reminders,
          waiting_on: waiting.map((w) => ({
            id: w.id,
            kind: w.kind,
            ...(w.kind === "person" && w.ref ? { person: person(w.ref) } : {}),
            ...(w.label ? { label: w.label } : {}),
            since: w.since,
          })),
          agent_sessions: agents ?? [],
          // MOD-94: what people answered here (the trail has no comments).
          ...(comments
            ? {
                comments: comments.comments.map((c) => shapeComment(c, data.names)),
                ...(comments.total > comments.comments.length
                  ? { earlier_comments: comments.total - comments.comments.length }
                  : {}),
              }
            : {}),
          activity,
        };
      },
    },
    {
      name: "tasks_history",
      description: "A repeating task's past cycles: when each was done (and by whom) or skipped, newest first.",
      access: "view",
      inputSchema: taskIdSchema,
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        return unwrap(ctx.db.rpc("tasks_op_history", { p_workspace_id: ctx.key.workspaceId, p_task_id: task.id }));
      },
    },
    {
      name: "tasks_time_report",
      description:
        "Tracked time for a period (up to a year), by task or by day, with the total: the key person's own entries, plus teammates' who share their time with the workspace owner when the person is the owner. Only tasks they can see; a project they can't see has no name. Optional: one project.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "First day, YYYY-MM-DD." },
          to: { type: "string", description: "Last day, YYYY-MM-DD." },
          project_id: { type: "string", description: "Only this project." },
          by: { type: "string", enum: ["task", "day"], description: "Group by task (default) or by day." },
        },
        required: ["from", "to"],
      },
      handler: async (args, ctx) => {
        const from = dayOrThrow(str(args, "from"), "from");
        const to = dayOrThrow(str(args, "to"), "to");
        const projectId = str(args, "project_id", false);
        const project = projectId ? await fetchProject(ctx, projectId) : null;
        const found = await unwrap<Row[] | null>(ctx.db.rpc("tasks_time_report", {
          p_workspace_id: ctx.key.workspaceId,
          p_from: from,
          p_to: to,
          p_project_ids: project ? [project.id] : null,
          p_client_contact_id: null,
          p_zone: null,
          p_limit: 5001,
        }));
        const cut = (found ?? []).length > 5000;
        const entries = (found ?? []).slice(0, 5000);
        const total = entries.reduce((sum, e) => sum + Number(e.seconds ?? 0), 0);
        const groups = new Map<string, Row>();
        for (const e of entries) {
          const key = args.by === "day" ? String(e.entry_day) : String(e.task_id);
          const g = groups.get(key)
            ?? (args.by === "day"
              ? { day: e.entry_day, seconds: 0 }
              : { task_id: e.task_id, title: e.task_title, project: e.project_name ?? null, seconds: 0 });
          g.seconds = Number(g.seconds) + Number(e.seconds ?? 0);
          groups.set(key, g);
        }
        return {
          from,
          to,
          total_seconds: total,
          ...(cut ? { cut: true } : {}),
          rows: [...groups.values()],
        };
      },
    },
    {
      name: "tasks_attachments_list",
      description:
        "A task's files (AT-1): name, type, size, when added, and a download link that works for 5 minutes. Links are made for the key's creator; ask again for fresh ones.",
      access: "view",
      inputSchema: taskIdSchema,
      handler: async (args, ctx) => {
        const taskId = (await fetchTask(ctx, str(args, "task_id"))).id as string;
        const files = await rows(
          ctx.db.from("attachments")
            .select("id, file_name, mime, size_bytes, width, height, created_at, object_path")
            .eq("workspace_id", ctx.key.workspaceId).eq("entity_type", "task")
            .eq("entity_id", taskId).eq("status", "ready").is("deleted_at", null)
            .order("created_at", { ascending: true }),
        );
        const urls = new Map<string, string>();
        if (files.length) {
          const { data, error } = await ctx.db.storage
            .from(ATTACHMENTS_BUCKET)
            .createSignedUrls(files.map((f) => f.object_path as string), ATTACHMENT_LINK_TTL_SECONDS.mcp);
          if (error) throw new Error(error.message);
          for (const link of data ?? []) {
            if (link.path && link.signedUrl) urls.set(link.path, link.signedUrl);
          }
        }
        return {
          task_id: taskId,
          link_lifetime_seconds: ATTACHMENT_LINK_TTL_SECONDS.mcp,
          attachments: files.map((f) => ({
            id: f.id,
            name: f.file_name,
            mime: f.mime,
            size_bytes: Number(f.size_bytes),
            width: f.width ?? null,
            height: f.height ?? null,
            added_at: f.created_at,
            url: urls.get(f.object_path) ?? null,
          })),
        };
      },
    },
    {
      name: "tasks_activity",
      description:
        "The attributed intent-op trail (who did what; an agent's rows read \"Alex · via <key name>\"): one task's trail, or the workspace's most recent activity. Comments aren't in it: read them with comments_list (or tasks_get).",
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Limit to one task (handle or uuid; optional)." },
          limit: { type: "number", description: "Max entries (default 25, max 100)." },
        },
      },
      handler: async (args, ctx) => {
        let query = ctx.db.from("module_activity")
          .select("entity_type, entity_id, op, actor_type, actor_label, payload, created_at")
          .eq("workspace_id", ctx.key.workspaceId).eq("module", "tasks")
          .neq("op", NOTIFICATION_ONLY_OP)
          .order("created_at", { ascending: false });
        const taskRef = str(args, "task_id", false);
        if (taskRef) {
          const task = await fetchTask(ctx, taskRef); // not shared with you → not found
          query = query.eq("entity_type", "task").eq("entity_id", task.id);
        }
        // Over-fetch, then keep only trail rows about things you can see
        // (titles live in the payloads). Notices hung on someone's Inbox
        // (reminders, agent states) stay theirs.
        const limit = clampLimit(args, 25, 100);
        const [fetched, tasks, buckets] = await Promise.all([
          rows(query.limit(limit * 4)),
          visibleIds(ctx, "task"),
          visibleIds(ctx, "bucket"),
        ]);
        return fetched
          .filter((r) => (r.entity_type === "task" && tasks.has(r.entity_id))
            || (r.entity_type === "bucket" && buckets.has(r.entity_id) && !r.payload?.notify_user_ids))
          .slice(0, limit)
          .map(({ entity_type: _type, ...rest }) => rest);
      },
    },
    {
      name: "tasks_list_assignees",
      description:
        "Who a task can be assigned to: the workspace's members with is_me for the key's creator. Only people with can_be_assigned (they can work on tasks) are accepted by tasks_assign.",
      access: "view",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, ctx) => {
        const [members, workspace] = await Promise.all([
          workspaceMembers(ctx),
          rows(ctx.db.from("workspaces").select("owner_id").eq("id", ctx.key.workspaceId)),
        ]);
        return assigneeCandidates({
          members,
          ownerId: (workspace[0]?.owner_id as string | undefined) ?? null,
          names: new Map(members.map((m) => [m.user_id, m.name])),
          me: ctx.key.createdBy,
        });
      },
    },

    // ── writes (edit scope) — intent ops, never raw row writes ───────────
    {
      name: "tasks_queue_add",
      description:
        "Add a task to your queue (the key creator's): at the end, or at the top. A task already queued stays where it is unless you ask for the top. Done and archived tasks can't be queued. Returns your queue.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: TASK_ID,
          at: { type: "string", enum: ["end", "top"], description: "Where it goes: 'end' (default) or 'top'." },
        },
        required: ["task_id"],
      },
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        await unwrap(ctx.db.rpc("tasks_op_queue_add", {
          p_workspace_id: ctx.key.workspaceId,
          p_task_id: task.id,
          p_at: args.at === "top" ? "top" : "end",
        }));
        return { queue: await shapedQueue(ctx) };
      },
    },
    {
      name: "tasks_queue_remove",
      description: "Take a task out of your queue. Doing it twice is fine. Returns your queue.",
      access: "edit",
      inputSchema: taskIdSchema,
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        await unwrap(ctx.db.rpc("tasks_op_queue_remove", { p_workspace_id: ctx.key.workspaceId, p_task_id: task.id }));
        return { queue: await shapedQueue(ctx) };
      },
    },
    {
      name: "tasks_queue_reorder",
      description:
        "Move a task that's in your queue: to the top, to the end, or right after another task in your queue. Moving never counts as a reschedule. Returns your queue.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task handle or uuid (must be in your queue)." },
          position: {
            type: "string",
            enum: ["top", "end", "after"],
            description: "'top', 'end', or 'after' (then give after_task_id).",
          },
          after_task_id: {
            type: "string",
            description: "With position 'after': the queued task it should follow.",
          },
        },
        required: ["task_id", "position"],
      },
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        const position = str(args, "position");
        const ws = ctx.key.workspaceId;
        if (position === "end") {
          await unwrap(ctx.db.rpc("tasks_op_queue_move_to_end", { p_workspace_id: ws, p_task_id: task.id }));
        } else if (position === "top") {
          await unwrap(ctx.db.rpc("tasks_op_queue_reorder", { p_workspace_id: ws, p_task_id: task.id, p_after_task_id: null }));
        } else if (position === "after") {
          const after = await fetchTask(ctx, str(args, "after_task_id"));
          await unwrap(ctx.db.rpc("tasks_op_queue_reorder", { p_workspace_id: ws, p_task_id: task.id, p_after_task_id: after.id }));
        } else {
          throw new Error("position must be 'top', 'end' or 'after'.");
        }
        return { queue: await shapedQueue(ctx) };
      },
    },
    {
      name: "tasks_commit",
      description: `${DEPRECATED} use tasks_queue_add. Puts the task at the end of your queue (again: moves it there) and marks it for the day in app versions from before personal queues.`,
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: TASK_ID,
          for_date: { type: "string", description: "Queue date YYYY-MM-DD (default: today, UTC)." },
        },
        required: ["task_id"],
      },
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        return callOp(ctx, "tasks_op_commit", {
          p_task_id: task.id,
          p_for: args.for_date
            ? dayOrThrow(str(args, "for_date"), "for_date")
            : new Date().toISOString().slice(0, 10),
        });
      },
    },
    {
      name: "tasks_uncommit",
      description: `${DEPRECATED} use tasks_queue_remove. Takes the task out of your queue (and off the day in older app versions). Doing it twice is fine.`,
      access: "edit",
      inputSchema: taskIdSchema,
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        return callOp(ctx, "tasks_op_uncommit", { p_task_id: task.id });
      },
    },
    {
      name: "tasks_skip_today",
      description: `${DEPRECATED} use tasks_queue_remove. Takes the task out of your queue (and off the day in older app versions). It no longer counts as a reschedule.`,
      access: "edit",
      inputSchema: taskIdSchema,
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        return callOp(ctx, "tasks_op_skip_today", { p_task_id: task.id });
      },
    },
    {
      name: "tasks_create",
      description:
        "Create a task in one go: filed into a project and section (default: the key creator's Inbox), with a status (a category word, the project's status name or id), assignee (a member, \"me\", or null; default the key's creator), team, due date and time, estimate, priority, tags (by name; new ones are made and coloured as the app colours them), a repeat (RRULE), reminders, work sessions and a parent (one level). With imported_from {source, key} it remembers where it came from; sending a key you already used on a live task of yours updates that task instead (a re-run). Inside an import run (import_id), it is recorded for imports_undo. Nothing is written if any part is refused. It gets its handle (e.g. MOD-142), shows in search at once, and the trail reads \"<person> · via <key name>\".",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "What the task is." },
          project_id: { type: "string", description: "Project uuid (see projects_list). Default: the key creator's Inbox." },
          bucket_id: { type: "string", description: "Older name for project_id." },
          section_id: { type: "string", description: "Section uuid in that project (see sections_list)." },
          parent_id: { type: "string", description: "Make it a subtask of this task (handle or uuid; one level only)." },
          description: { type: "string", description: `Longer notes. ${DESCRIPTION_MARKDOWN}` },
          status: { type: "string", description: "backlog · todo · in_progress · done · wont_do, or the project's status name or id. Default: to do." },
          assignee_id: { type: ["string", "null"], description: "Member uuid (see tasks_list_assignees), \"me\", or null for Unassigned." },
          team_id: { type: ["string", "null"], description: "Route it to this team (see teams_list); nobody's until someone takes it." },
          due_on: { type: ["string", "null"], description: "Due date, YYYY-MM-DD (the same date for everyone)." },
          due_time: { type: ["string", "null"], description: "Due time, HH:MM (the assignee's clock)." },
          due_date: { type: ["string", "null"], description: "Older due field: a date (YYYY-MM-DD) or ISO 8601." },
          scheduled_at: { type: ["string", "null"], description: "Older field: when to work on it, ISO 8601 (prefer sessions)." },
          duration_minutes: { type: ["number", "null"], description: "Older name for estimate_minutes." },
          estimate_minutes: { type: ["number", "null"], description: "Estimate in minutes." },
          priority: { type: ["string", "null"], enum: [...PRIORITY_LEVELS, null], description: "Priority." },
          energy_level: { type: ["string", "null"], enum: [...ENERGY_LEVELS, null], description: "Energy it takes." },
          repeat: { type: ["string", "object", "null"], description: "An RRULE like FREQ=WEEKLY;BYDAY=TU, or {rrule, mode: \"after_completion\"}." },
          tags: { type: "array", items: { type: "string" }, description: "Tag names (at most 20)." },
          reminders: {
            type: "array",
            items: { type: "object" },
            description: "Your reminders: {kind: at | day_before | hour_before, at?: ISO 8601 (for at)}; at most 10.",
          },
          sessions: {
            type: "array",
            items: { type: "object" },
            description: "Work sessions: {starts_at, ends_at} (ISO 8601); yours, at most 10.",
          },
          imported_from: { type: "object", description: "{source, key}: where an import brought it from (e.g. {source: \"linear\", key: \"ENG-123\"})." },
          import_id: { type: "string", description: "The run from imports_begin, so imports_undo can take it back." },
        },
        required: ["title"],
      },
      handler: async (args, ctx) => {
        const task: Row = { ...taskFieldsFromArgs(args) };
        const described =
          typeof args.description === "string" ? await describeForWrite(ctx, args.description) : null;
        if (described) task.description = described.markdown;
        const projectId = projectArg(args);
        if (projectId) task.bucket_id = (await fetchProject(ctx, projectId)).id;
        const parent = str(args, "parent_id", false);
        if (parent) task.parent_id = (await fetchTask(ctx, parent)).id;
        if ("assignee_id" in args) task.assignee_id = resolveAssigneeArg(args.assignee_id, ctx.key.createdBy);
        if (args.imported_from && typeof args.imported_from === "object") task.imported_from = args.imported_from;
        const extras: Row = {};
        if (Array.isArray(args.tags)) extras.tags = args.tags;
        if (Array.isArray(args.reminders)) extras.reminders = args.reminders;
        if (Array.isArray(args.sessions)) extras.sessions = args.sessions;
        if (typeof args.import_id === "string") extras.import_id = args.import_id;
        const out = await unwrap<Row>(ctx.db.rpc("tasks_op_create_with", {
          p_workspace_id: ctx.key.workspaceId,
          p_task: task,
          p_with: extras,
        }));
        // A tag name new to the workspace became a tag with no colour (MOD-93).
        if (Array.isArray(extras.tags) && extras.tags.length) await colourBareTags(ctx);
        // What the description references links from the task (call #15).
        const createdId = (out.task as Row | undefined)?.id;
        if (described?.refs.length && typeof createdId === "string") {
          await linkDescribed(ctx, createdId, described.refs);
        }
        return {
          action: out.action,
          ...(await shapeOne(ctx, out.task as Row)),
          ...(out.reminders_added ? { reminders_added: out.reminders_added } : {}),
          ...(out.sessions_added ? { sessions_added: out.sessions_added } : {}),
        };
      },
    },
    {
      name: "tasks_update",
      description:
        "Edit a task's fields: title, description, project (its subtasks you can edit move with it), section, parent, status (category word or the project's name), team, due date and time, estimate, priority, energy, repeat (null stops it), and tags (tags_add / tags_remove by name). Pass only what changes; null clears. The assignee has its own tool (tasks_assign).",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: TASK_ID,
          title: { type: "string", description: "New title." },
          project_id: { type: "string", description: "Move to this project." },
          bucket_id: { type: "string", description: "Older name for project_id." },
          section_id: { type: ["string", "null"], description: "Section uuid in its project, or null." },
          parent_id: { type: ["string", "null"], description: "Parent task (handle or uuid), or null for top level." },
          description: { type: "string", description: `New description (replaces it whole). ${DESCRIPTION_MARKDOWN}` },
          status: { type: "string", description: "A category word, or the project's status name or id." },
          team_id: { type: ["string", "null"], description: "Team uuid, or null." },
          due_on: { type: ["string", "null"], description: "YYYY-MM-DD, or null to clear." },
          due_time: { type: ["string", "null"], description: "HH:MM, or null." },
          due_date: { type: ["string", "null"], description: "Older due field: a date or ISO 8601, or null." },
          scheduled_at: { type: ["string", "null"], description: "Older field: ISO 8601, or null to clear." },
          duration_minutes: { type: ["number", "null"], description: "Older name for estimate_minutes." },
          estimate_minutes: { type: ["number", "null"], description: "Estimate in minutes, or null." },
          priority: { type: ["string", "null"], enum: [...PRIORITY_LEVELS, null], description: "Priority, or null." },
          energy_level: { type: ["string", "null"], enum: [...ENERGY_LEVELS, null], description: "Energy, or null." },
          repeat: { type: ["string", "object", "null"], description: "An RRULE or {rrule, mode}; null stops the repeat." },
          tags_add: { type: "array", items: { type: "string" }, description: "Tag names to add." },
          tags_remove: { type: "array", items: { type: "string" }, description: "Tag names to take off." },
        },
        required: ["task_id"],
      },
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        const patch: Row = taskFieldsFromArgs(args);
        const described =
          typeof args.description === "string" ? await describeForWrite(ctx, args.description) : null;
        if (described) patch.description = described.markdown;
        const projectId = projectArg(args);
        if (projectId) patch.bucket_id = (await fetchProject(ctx, projectId)).id;
        if ("parent_id" in args) {
          patch.parent_id = args.parent_id === null ? null : (await fetchTask(ctx, str(args, "parent_id"))).id;
        }
        const extras: Row = {};
        if (Array.isArray(args.tags_add) && args.tags_add.length) extras.tags_add = args.tags_add;
        if (Array.isArray(args.tags_remove) && args.tags_remove.length) extras.tags_remove = args.tags_remove;
        if (Object.keys(patch).length === 0 && Object.keys(extras).length === 0) throw new Error("Nothing to change.");
        const ws = ctx.key.workspaceId;
        const answered = await unwrap<Row[] | Row | null>(ctx.db.rpc("tasks_op_update_with", {
          p_workspace_id: ws,
          p_task_id: task.id,
          p_patch: patch,
          p_with: extras,
        }));
        if (extras.tags_add) await colourBareTags(ctx); // MOD-93, as in tasks_create
        const row = Array.isArray(answered) ? answered[0] : answered;
        if (!row) throw new Error("The operation returned nothing.");
        if (described?.refs.length) await linkDescribed(ctx, task.id as string, described.refs);
        // Finishing through an edit finishes its open subtasks too (call 87).
        const also =
          typeof patch.status === "string"
            ? await finishOpenSubtasks(ctx, task, row, (subId) =>
                ctx.db.rpc("tasks_op_set_status", {
                  p_workspace_id: ws,
                  p_task_id: subId,
                  p_status: "done",
                  p_recurrence: null,
                  p_position: null,
                }),
              )
            : 0;
        return { ...(await shapeOne(ctx, row)), ...(also ? { also_finished: also } : {}) };
      },
    },
    {
      name: "tasks_set_status",
      description:
        "Change a task's status: a category word (backlog · todo · in_progress · done · wont_do; the older archived = won't do), or the project's own status name (any case) or id; see statuses_list. Finishing a task finishes its open subtasks you can edit too (also_finished counts them); a repeat moves to its next occurrence instead (the server keeps the pointer; missed occurrences don't exist).",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: TASK_ID,
          status: { type: "string", description: "Category word, status name or status id." },
        },
        required: ["task_id", "status"],
      },
      handler: async (args, ctx) => {
        const status = str(args, "status");
        const before = await fetchTask(ctx, str(args, "task_id"));
        const ws = ctx.key.workspaceId;
        // The server's engine moves the pointer (TV-D8); the port's pointer
        // only serves a legacy word on a rule the server can't read.
        const recurrence = isTaskStatus(status)
          ? pointerOnStatusChange(before as RecurringTaskRow, status, new Date())
          : null;
        const row = await unwrap<Row>(ctx.db.rpc("tasks_op_set_status", {
          p_workspace_id: ws,
          p_task_id: before.id,
          p_status: status,
          p_recurrence: recurrence,
          p_position: null,
        }));
        const also = await finishOpenSubtasks(ctx, before, row, (subId) =>
          ctx.db.rpc("tasks_op_set_status", {
            p_workspace_id: ws,
            p_task_id: subId,
            p_status: "done",
            p_recurrence: null,
            p_position: null,
          }),
        );
        return { ...(await shapeOne(ctx, row)), ...(also ? { also_finished: also } : {}) };
      },
    },
    {
      name: "tasks_reschedule",
      description:
        "Move a scheduled task's time (drift triage). Does not touch the reschedule counter.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: TASK_ID,
          scheduled_at: { type: "string", description: "New scheduled datetime, ISO 8601." },
        },
        required: ["task_id", "scheduled_at"],
      },
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        return callOp(ctx, "tasks_op_reschedule", {
          p_task_id: task.id,
          p_scheduled_at: isoOrThrow(str(args, "scheduled_at"), "scheduled_at"),
          p_days: null,
        });
      },
    },
    {
      name: "tasks_unschedule",
      description:
        "Clear a task's stale scheduled time, keeping the task (drift-triage Ignore).",
      access: "edit",
      inputSchema: taskIdSchema,
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        return callOp(ctx, "tasks_op_unschedule", { p_task_id: task.id });
      },
    },
    {
      name: "tasks_assign",
      description:
        "Assign a task to a member who can work on tasks, or unassign it with null. \"me\" is the key's creator. Someone else being assigned gets one \"assigned to you\" notification; an unfiled task given to someone goes into their Inbox.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: TASK_ID,
          assignee_id: {
            type: ["string", "null"],
            description: "Member uuid (see tasks_list_assignees), \"me\", or null to unassign.",
          },
        },
        required: ["task_id", "assignee_id"],
      },
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        return callOp(ctx, "tasks_op_assign", {
          p_task_id: task.id,
          p_assignee_id: resolveAssigneeArg(args.assignee_id, ctx.key.createdBy),
        });
      },
    },
    {
      name: "tasks_route_team",
      description:
        "Route a task to a team (see teams_list), or take it off its team with null. Routing doesn't unassign: to hand your own task to a team, unassign it too. A task in an Inbox goes to the team's default project.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: TASK_ID,
          team_id: { type: ["string", "null"], description: "Team uuid, or null." },
        },
        required: ["task_id", "team_id"],
      },
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        return callOp(ctx, "tasks_op_update", { p_task_id: task.id, p_patch: { team_id: args.team_id ?? null } });
      },
    },
    {
      name: "tasks_claim",
      description:
        "Take a task routed to one of your teams: it becomes the key creator's. Needs edit access to it; \"Someone already took this task.\" when another member was first.",
      access: "edit",
      inputSchema: taskIdSchema,
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        return callOp(ctx, "tasks_op_claim", { p_task_id: task.id });
      },
    },
    {
      name: "tasks_handoff",
      description:
        "Hand a task off: it now waits on a member (person_id) or on what you name (label, e.g. \"the client's sign-off\"). The assignee stays; the entry clears itself when that person comments. tasks_waiting_clear removes one.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: TASK_ID,
          person_id: { type: "string", description: "Member uuid it waits on." },
          label: { type: "string", description: "Or what it waits on, in words (at most 200 characters)." },
        },
        required: ["task_id"],
      },
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        const person = str(args, "person_id", false);
        const label = str(args, "label", false);
        if (!person === !label) throw new Error("Give person_id or label (one of them).");
        const entry = person ? { kind: "person", ref: person } : { kind: "text", label };
        const waiting = await unwrap<Row[] | null>(ctx.db.rpc("tasks_op_waiting_add", {
          p_workspace_id: ctx.key.workspaceId,
          p_task_id: task.id,
          p_entry: entry,
        }));
        return { task_id: task.id, waiting_on: waiting ?? [] };
      },
    },
    {
      name: "tasks_waiting_clear",
      description: "Remove one \"waiting on\" entry from a task (its id is in tasks_get's waiting_on).",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: { entry_id: { type: "string", description: "The waiting entry's id." } },
        required: ["entry_id"],
      },
      handler: async (args, ctx) => {
        const left = await unwrap<Row[] | null>(ctx.db.rpc("tasks_op_waiting_remove", {
          p_workspace_id: ctx.key.workspaceId,
          p_entry_id: str(args, "entry_id"),
        }));
        return { waiting_on: left ?? [] };
      },
    },
    {
      name: "tasks_comment",
      description:
        "Add a comment to a task — only when a person asked you to (your own changes are already in the trail). It reads as written by this key's app. Needs Links: Edit too.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: TASK_ID,
          body: { type: "string", description: "The comment (plain text or Markdown)." },
          mentioned_user_ids: { type: "array", items: { type: "string" }, description: "Members to notify (only people who can see the task hear)." },
        },
        required: ["task_id", "body"],
      },
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        const comment = await unwrap<Row>(ctx.db.rpc("comments_op_add", {
          p_workspace_id: ctx.key.workspaceId,
          p_entity_type: "task",
          p_entity_id: task.id,
          p_body: str(args, "body"),
          p_mentioned_user_ids: Array.isArray(args.mentioned_user_ids) ? args.mentioned_user_ids : [],
        }));
        return { id: comment?.id, task_id: task.id, created_at: comment?.created_at };
      },
    },
    {
      name: "tasks_session_status",
      description:
        "Post your session's status on a task you're working on — status, not conversation: state (working · needs_you · ready · failed), a short note, an optional step n of m, links (e.g. a PR), and with ready an optional hand-back summary. It shows as one line on the task, private to the key's person unless they share their agent work; needs_you, ready and failed notify them once. Reporting working after ready or failed starts a new run.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: TASK_ID,
          state: { type: "string", enum: [...AGENT_SESSION_STATES], description: "Where the work stands." },
          note: { type: "string", description: "One line, at most 280 characters (e.g. \"Writing tests\")." },
          step: { type: "number", description: "Step n (with steps)." },
          steps: { type: "number", description: "Of m steps." },
          links: { type: "array", items: { type: "object" }, description: "Up to 5 {url, label?} (http(s))." },
          summary: { type: "string", description: "The hand-back summary (at most 4,000 characters); its person can post it as a comment." },
          agent: { type: "string", description: "Your name on the line (e.g. \"Claude\"). Default: the key's name." },
        },
        required: ["task_id", "state"],
      },
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        const report: Row = { state: str(args, "state") };
        for (const name of ["note", "step", "steps", "links", "summary", "agent"]) {
          if (args[name] !== undefined) report[name] = args[name];
        }
        const s = await unwrap<Row>(ctx.db.rpc("tasks_op_agent_report", {
          p_workspace_id: ctx.key.workspaceId,
          p_task_id: task.id,
          p_report: report,
        }));
        return {
          session_id: s.id,
          task_id: task.id,
          agent: s.agent,
          state: s.state,
          note: s.note ?? null,
          ...(s.step != null ? { step: s.step, steps: s.steps } : {}),
          links: s.links ?? [],
          started_at: s.started_at,
          updated_at: s.updated_at,
        };
      },
    },
    {
      name: "tasks_reminder_add",
      description:
        "Remind the key's person about a task: at a time (kind at, with at), or a day or an hour before it's due. Reminders are each person's own; they fire as a notice (and an OS / browser notice where allowed).",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: TASK_ID,
          kind: { type: "string", enum: [...TASK_REMINDER_KINDS], description: "at (default), day_before or hour_before." },
          at: { type: "string", description: "With kind at: when, ISO 8601." },
        },
        required: ["task_id"],
      },
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        const kind = str(args, "kind", false) || "at";
        const list = await unwrap<Row[] | null>(ctx.db.rpc("tasks_op_reminder_add", {
          p_workspace_id: ctx.key.workspaceId,
          p_task_id: task.id,
          p_kind: kind,
          p_at: args.at ? isoOrThrow(str(args, "at"), "at") : null,
        }));
        return { task_id: task.id, my_reminders: list ?? [] };
      },
    },
    {
      name: "tasks_reminder_remove",
      description: "Remove one of the key's person's reminders (its id is in tasks_get's my_reminders).",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: { reminder_id: { type: "string", description: "The reminder's id." } },
        required: ["reminder_id"],
      },
      handler: async (args, ctx) => {
        const list = await unwrap<Row[] | null>(ctx.db.rpc("tasks_op_reminder_remove", {
          p_workspace_id: ctx.key.workspaceId,
          p_reminder_id: str(args, "reminder_id"),
        }));
        return { my_reminders: list ?? [] };
      },
    },
    {
      name: "tasks_work_session_add",
      description:
        "Schedule a work session on a task (a block on the calendar): its person is the key's creator, or the task's assignee (person_id). A task can have several.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: TASK_ID,
          starts_at: { type: "string", description: "Start, ISO 8601." },
          ends_at: { type: "string", description: "End, ISO 8601." },
          person_id: { type: "string", description: "The task's assignee, when it's their session. Default: the key's creator." },
        },
        required: ["task_id", "starts_at", "ends_at"],
      },
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        const session: Row = {
          starts_at: isoOrThrow(str(args, "starts_at"), "starts_at"),
          ends_at: isoOrThrow(str(args, "ends_at"), "ends_at"),
        };
        const person = str(args, "person_id", false);
        if (person) session.user_id = person === "me" ? ctx.key.createdBy : person;
        const list = await unwrap<Row[] | null>(ctx.db.rpc("tasks_op_session_add", {
          p_workspace_id: ctx.key.workspaceId,
          p_task_id: task.id,
          p_session: session,
        }));
        return { task_id: task.id, work_sessions: list ?? [] };
      },
    },
    {
      name: "tasks_work_session_update",
      description: "Move or resize a work session (its id is in tasks_get's work_sessions); its person stays.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "The session's id." },
          starts_at: { type: "string", description: "New start, ISO 8601." },
          ends_at: { type: "string", description: "New end, ISO 8601." },
        },
        required: ["session_id"],
      },
      handler: async (args, ctx) => {
        const patch: Row = {};
        if (args.starts_at) patch.starts_at = isoOrThrow(str(args, "starts_at"), "starts_at");
        if (args.ends_at) patch.ends_at = isoOrThrow(str(args, "ends_at"), "ends_at");
        if (!Object.keys(patch).length) throw new Error("Nothing to change.");
        const list = await unwrap<Row[] | null>(ctx.db.rpc("tasks_op_session_update", {
          p_workspace_id: ctx.key.workspaceId,
          p_session_id: str(args, "session_id"),
          p_patch: patch,
        }));
        return { work_sessions: list ?? [] };
      },
    },
    {
      name: "tasks_work_session_remove",
      description: "Remove a work session from a task.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string", description: "The session's id." } },
        required: ["session_id"],
      },
      handler: async (args, ctx) => {
        const list = await unwrap<Row[] | null>(ctx.db.rpc("tasks_op_session_remove", {
          p_workspace_id: ctx.key.workspaceId,
          p_session_id: str(args, "session_id"),
        }));
        return { work_sessions: list ?? [] };
      },
    },
    {
      name: "tasks_skip_occurrence",
      description:
        "Jump an open recurring task past its pending occurrence without done-credit. Forward-only; the connector computes the next occurrence from the task's rule.",
      access: "edit",
      inputSchema: taskIdSchema,
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        const targets = skipOccurrenceTargets(task as RecurringTaskRow, new Date());
        if (!targets) {
          throw new Error("Nothing to skip to — the task must be open and recurring with a next occurrence.");
        }
        return callOp(ctx, "tasks_op_skip_occurrence", {
          p_task_id: task.id,
          p_scheduled_at: targets.scheduledAt,
          p_recurrence: targets.recurrence,
          p_release_commit: targets.releaseCommit,
        });
      },
    },
    {
      name: "tasks_move_occurrence",
      description:
        "Move just this occurrence of a repeating task (\"Move just this one\"): a new due date and/or session start; the pattern stays. To change the pattern, send repeat to tasks_update.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: TASK_ID,
          due_on: { type: "string", description: "This occurrence's due date, YYYY-MM-DD." },
          starts_at: { type: "string", description: "This occurrence's session start, ISO 8601." },
        },
        required: ["task_id"],
      },
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        const dueOn = str(args, "due_on", false);
        const startsAt = str(args, "starts_at", false);
        if (!dueOn && !startsAt) throw new Error("Give due_on, starts_at or both.");
        return callOp(ctx, "tasks_op_move_occurrence", {
          p_task_id: task.id,
          p_due_on: dueOn ? dayOrThrow(dueOn, "due_on") : null,
          p_starts_at: startsAt ? isoOrThrow(startsAt, "starts_at") : null,
        });
      },
    },
    {
      name: "projects_create",
      description:
        "Create a project, owned by the key's creator and seen by the workspace: name, area, status, start and target dates, colour, lead, client (a person or a company; needs Contacts access), description. Inside an import run (import_id) it's recorded for imports_undo. Look for an existing project first (projects_list): a re-run should reuse it.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "The project's name." },
          area_id: { type: "string", description: "File it under this area (see areas_list)." },
          status: { type: "string", enum: [...PROJECT_STATES], description: "Default active." },
          starts_on: { type: "string", description: "Start date, YYYY-MM-DD." },
          target_on: { type: "string", description: "Target date, YYYY-MM-DD." },
          color: { type: "string", description: "Colour name, as the app's picker has them." },
          lead_id: { type: "string", description: "A member who leads it." },
          client_contact_id: {
            type: "string",
            description: "The client, when it's a person: a contact uuid (contacts_search). Not with client_company_id.",
          },
          client_company_id: {
            type: "string",
            description: "The client, when it's a company: a company uuid (contacts_search). Not with client_contact_id.",
          },
          description: { type: "string", description: "What the project is, plain text (up to 20,000 characters)." },
          import_id: { type: "string", description: "The run from imports_begin." },
        },
        required: ["name"],
      },
      handler: async (args, ctx) => {
        const fields: Row = { name: str(args, "name") };
        for (const k of ["area_id", "status", "starts_on", "target_on", "color", "lead_id", "description"]) {
          if (typeof args[k] === "string") fields[k] = args[k];
        }
        Object.assign(fields, await clientFields(ctx, args, false));
        const ws = ctx.key.workspaceId;
        // Inside a run, made and recorded in one transaction (a refused run makes nothing).
        const project =
          typeof args.import_id === "string"
            ? await unwrap<Row>(ctx.db.rpc("imports_op_project_create", {
                p_workspace_id: ws,
                p_import_id: args.import_id,
                p_project: fields,
              }))
            : await unwrap<Row>(ctx.db.rpc("projects_op_create", { p_workspace_id: ws, p_project: fields }));
        const [members, clients] = await Promise.all([workspaceMembers(ctx), projectClients(ctx, [project])]);
        return shapeProject(project, new Map(members.map((m) => [m.user_id, m.name])), clients);
      },
    },
    {
      name: "projects_update",
      description:
        "Edit a project you can edit: name, status (active · on_hold · done), area, start and target dates, colour, lead, client (a person or a company; needs Contacts access; setting one clears the other), description, archived (needs full access). Pass only what changes; null clears a date, the area, the lead, the client or the description.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project uuid." },
          name: { type: "string", description: "New name." },
          status: { type: "string", enum: [...PROJECT_STATES], description: "The project's status." },
          area_id: { type: ["string", "null"], description: "Area uuid, or null." },
          starts_on: { type: ["string", "null"], description: "YYYY-MM-DD, or null." },
          target_on: { type: ["string", "null"], description: "YYYY-MM-DD, or null." },
          color: { type: ["string", "null"], description: "Colour name, or null." },
          lead_id: { type: ["string", "null"], description: "Member uuid, or null." },
          client_contact_id: {
            type: ["string", "null"],
            description: "The client as a person: a contact uuid (it replaces a company client), or null.",
          },
          client_company_id: {
            type: ["string", "null"],
            description: "The client as a company: a company uuid (it replaces a person client), or null.",
          },
          description: {
            type: ["string", "null"],
            description: "What the project is, plain text (up to 20,000 characters), or null to clear it.",
          },
          archived: { type: "boolean", description: "Archive (true) or bring it back (false)." },
        },
        required: ["project_id"],
      },
      handler: async (args, ctx) => {
        const project = await fetchProject(ctx, str(args, "project_id"));
        const patch: Row = {};
        for (const k of ["name", "status", "area_id", "starts_on", "target_on", "color", "lead_id", "description"]) {
          if (k in args) patch[k] = args[k] ?? null;
        }
        Object.assign(patch, await clientFields(ctx, args, true));
        if (typeof args.archived === "boolean") patch.archived_at = args.archived ? new Date().toISOString() : null;
        if (!Object.keys(patch).length) throw new Error("Nothing to change.");
        const ws = ctx.key.workspaceId;
        const updated = await unwrap<Row>(ctx.db.rpc("projects_op_update", {
          p_workspace_id: ws,
          p_project_id: project.id,
          p_patch: patch,
        }));
        const [members, clients] = await Promise.all([workspaceMembers(ctx), projectClients(ctx, [updated])]);
        return shapeProject(updated, new Map(members.map((m) => [m.user_id, m.name])), clients);
      },
    },
    {
      name: "projects_duplicate",
      description:
        "Duplicate a project you can edit (\"Duplicate project…\"): its sections, statuses and open tasks, with dates shifted to a new start; nothing done or tracked is copied. Answers with the new project and how many tasks it has.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "The project to copy." },
          name: { type: "string", description: "The new project's name. Default: the same name." },
          starts_on: { type: "string", description: "The new start date (YYYY-MM-DD); dates shift from it." },
          area_id: { type: "string", description: "File the copy under this area. Default: the source's." },
        },
        required: ["project_id"],
      },
      handler: async (args, ctx) => {
        const project = await fetchProject(ctx, str(args, "project_id"));
        const ws = ctx.key.workspaceId;
        // D15-11: copying needs Edit on the source; ask before copying.
        const can = await unwrap<boolean>(ctx.db.rpc("templates_can_copy", { p_kind: "project", p_id: project.id }));
        if (!can) throw new Error("You need edit access to this project to copy it.");
        const fields: Row = {};
        for (const k of ["name", "starts_on", "area_id"]) {
          if (typeof args[k] === "string") fields[k] = args[k];
        }
        const made = await unwrap<Row>(ctx.db.rpc("projects_op_duplicate", {
          p_workspace_id: ws,
          p_project_id: project.id,
          p_fields: fields,
        }));
        const copy = (made?.buckets as Row[] | undefined)?.[0];
        return {
          project: copy ? { id: copy.id, name: copy.name } : null,
          tasks: Array.isArray(made?.tasks) ? made.tasks.length : 0,
          sections: Array.isArray(made?.sections) ? made.sections.length : 0,
        };
      },
    },
    {
      name: "sections_create",
      description:
        "Add a section to a project you can edit (e.g. \"Week 1\"), with optional start and end dates, after another section or at the end. Inside an import run (import_id) it's recorded for imports_undo. Answers with the project's sections.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project uuid." },
          name: { type: "string", description: "The section's name." },
          starts_on: { type: "string", description: "Start date, YYYY-MM-DD." },
          ends_on: { type: "string", description: "End date, YYYY-MM-DD (an end alone is a milestone)." },
          after: { type: ["string", "null"], description: "Put it after this section (null: first). Default: last." },
          import_id: { type: "string", description: "The run from imports_begin." },
        },
        required: ["project_id", "name"],
      },
      handler: async (args, ctx) => {
        const project = await fetchProject(ctx, str(args, "project_id"));
        const id = crypto.randomUUID();
        const section: Row = { id, name: str(args, "name") };
        for (const k of ["starts_on", "ends_on"]) if (typeof args[k] === "string") section[k] = args[k];
        if ("after" in args) section.after = args.after ?? null;
        const ws = ctx.key.workspaceId;
        // Inside a run, made and recorded in one transaction (a refused run makes nothing).
        const list =
          typeof args.import_id === "string"
            ? await unwrap<Row[] | null>(ctx.db.rpc("imports_op_section_create", {
                p_workspace_id: ws,
                p_import_id: args.import_id,
                p_project_id: project.id,
                p_section: section,
              }))
            : await unwrap<Row[] | null>(ctx.db.rpc("sections_op_create", {
                p_workspace_id: ws,
                p_project_id: project.id,
                p_section: section,
              }));
        return {
          section_id: id,
          sections: (list ?? []).map((s) => ({ id: s.id, name: s.name, starts_on: s.starts_on ?? null, ends_on: s.ends_on ?? null })),
        };
      },
    },
    {
      name: "areas_create",
      description: "Add an area the sidebar groups projects under (everyone in the workspace sees it).",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "The area's name." },
          color: { type: "string", description: "Colour name." },
        },
        required: ["name"],
      },
      handler: async (args, ctx) => {
        const name = str(args, "name");
        const list = await unwrap<Row[] | null>(ctx.db.rpc("areas_op_create", {
          p_workspace_id: ctx.key.workspaceId,
          p_name: name,
          p_color: str(args, "color", false) || null,
        }));
        // The op answers with the areas its caller sees; the new one is theirs.
        const mine = (list ?? []).filter((a) => a.created_by === ctx.key.createdBy && a.name === name);
        const made = mine.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
        return made ? { id: made.id, name: made.name, ...(made.color ? { color: made.color } : {}) } : null;
      },
    },
    {
      name: "templates_apply",
      description:
        "Make a task or a project from a template (see templates_list). A task template: optional title, project and section (default: the template's project if you can add tasks there, else your Inbox) and a date its offsets count from. A project template: optional name, start date (dates shift from it) and area.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          template_id: { type: "string", description: "The template's id." },
          kind: { type: "string", enum: [...TEMPLATE_KINDS], description: "The template's kind." },
          title: { type: "string", description: "Task template: the new task's title." },
          project_id: { type: "string", description: "Task template: where it goes." },
          section_id: { type: "string", description: "Task template: the section there." },
          date: { type: "string", description: "Task template: YYYY-MM-DD its dates count from." },
          name: { type: "string", description: "Project template: the new project's name." },
          starts_on: { type: "string", description: "Project template: its start date (YYYY-MM-DD)." },
          area_id: { type: "string", description: "Project template: file it under this area." },
        },
        required: ["template_id", "kind"],
      },
      handler: async (args, ctx) => {
        const ws = ctx.key.workspaceId;
        const kind = str(args, "kind");
        const fields: Row = {};
        if (kind === "task") {
          for (const k of ["title", "section_id", "date"]) if (typeof args[k] === "string") fields[k] = args[k];
          const projectId = str(args, "project_id", false);
          if (projectId) fields.project_id = (await fetchProject(ctx, projectId)).id;
          const made = await unwrap<Row>(ctx.db.rpc("task_templates_op_apply", {
            p_workspace_id: ws,
            p_template_id: str(args, "template_id"),
            p_fields: fields,
          }));
          await colourBareTags(ctx); // a template's tags come by name (MOD-93)
          const tasks = (made?.tasks as Row[] | undefined) ?? [];
          const top = tasks.find((t) => !t.parent_id) ?? tasks[0];
          return { task: top ? await shapeOne(ctx, top) : null, tasks: tasks.length };
        }
        if (kind !== "project") throw new Error("kind is task or project.");
        for (const k of ["name", "starts_on", "area_id"]) if (typeof args[k] === "string") fields[k] = args[k];
        const made = await unwrap<Row>(ctx.db.rpc("project_templates_op_apply", {
          p_workspace_id: ws,
          p_template_id: str(args, "template_id"),
          p_fields: fields,
        }));
        await colourBareTags(ctx);
        const project = (made?.buckets as Row[] | undefined)?.[0];
        return {
          project: project ? { id: project.id, name: project.name } : null,
          tasks: Array.isArray(made?.tasks) ? made.tasks.length : 0,
        };
      },
    },
    {
      name: "imports_begin",
      description:
        "Begin an import run (\"bring my Todoist / Linear / Trello through your AI\"): name the source (e.g. todoist). Pass the run's id as import_id to projects_create, sections_create and tasks_create, give each task imported_from {source, key} with the source's own id, then imports_finish. Running the same import again (a new run) updates the tasks by key and creates nothing new; imports_undo takes a run back.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string", description: "Where it comes from, e.g. todoist, linear, trello (at most 40 characters)." },
          label: { type: "string", description: "A name for this run, e.g. \"Biology syllabus\"." },
        },
        required: ["source"],
      },
      handler: (args, ctx) =>
        unwrap(ctx.db.rpc("imports_op_begin", {
          p_workspace_id: ctx.key.workspaceId,
          p_source: str(args, "source"),
          p_label: str(args, "label", false) || null,
        })),
    },
    {
      name: "imports_finish",
      description: "Finish an import run: answers what it made and updated. A finished run takes no more rows.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: { import_id: { type: "string", description: "The run's id." } },
        required: ["import_id"],
      },
      handler: (args, ctx) =>
        unwrap(ctx.db.rpc("imports_op_finish", {
          p_workspace_id: ctx.key.workspaceId,
          p_import_id: str(args, "import_id"),
        })),
    },
    {
      name: "imports_undo",
      description:
        "Undo an import run (\"Undo this import\"): what it made and nobody touched since goes to Recently deleted — tasks, then the sections and projects it made that are left empty. Anything edited since stays; rows it only updated stay as they are. Answers the counts.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: { import_id: { type: "string", description: "The run's id." } },
        required: ["import_id"],
      },
      handler: (args, ctx) =>
        unwrap(ctx.db.rpc("imports_op_undo", {
          p_workspace_id: ctx.key.workspaceId,
          p_import_id: str(args, "import_id"),
        })),
    },
  ],
};
