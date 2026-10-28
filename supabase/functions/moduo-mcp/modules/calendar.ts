/**
 * Calendar — module #4 on the Moduo MCP connector (docs/moduo-mcp-connector.md;
 * block CAL-7, AC14).
 *
 * Connector-side mirror of the app's calendar manifest (src/features/calendar/
 * ops-manifest.ts — keep descriptions in sync). Reads expose events in a range
 * and the composed day (events + task blocks + the unfinished-from-earlier
 * strip); writes are native-event CRUD plus the loop verbs, which ride the
 * shipped Tasks ops (the lens model: a task block IS the task row). Workspace
 * scoping comes from the key, never from tool args. Reads run as service_role
 * (RLS bypassed), so every query MUST filter on ctx.key.workspaceId.
 *
 * External (mirrored) events are structurally read-only — there is no
 * update/delete path for them (the ops reject them); the connector only exposes
 * native-event writes.
 *
 * Reads (CALR-21) are two paged RPCs joined by event id: the masked read
 * (calendar_events_visible: a teammate's private event arrives as "Busy", focus
 * time as "Focus time") and calendar_event_occurrences (every occurrence in the
 * window, repeats expanded). Each event says whose it is (`mine`), its place,
 * link, people and privacy. Offers (calendar_offer_times / calendar_release_offer)
 * and who-sees (calendar_who_sees) run through their own RPCs, as the key.
 *
 * Task blocks ARE tasks, so they follow the key's Tasks scope: calendar_day
 * leaves them out for a key without Tasks View, and the four task-block tools
 * also need Tasks Edit (MCP_TOOL_NEEDS in contracts/mcp-key-scopes.ts).
 */

import { CANONICAL_BOOKING_ORIGIN } from "../../_shared/app-origin.ts";
import { keyScopeAllows } from "../../_shared/contracts/mcp-key-scopes.ts";
import { readAllPages } from "../../_shared/tasks-connector.ts";
import type { ConnectorModule, ToolContext } from "../registry.ts";
import { visibleIds } from "../share.ts";
import { workspaceMembers } from "../tasks-helpers.ts";

type Row = Record<string, any>;

function str(args: Row, name: string, required = true): string {
  const v = args?.[name];
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (!required) return "";
  throw new Error(`Missing required argument: ${name}`);
}

function bool(args: Row, name: string): boolean {
  return args?.[name] === true || args?.[name] === "true";
}

function clampLimit(args: Row, fallback: number, max: number): number {
  const v = Number(args?.limit);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(Math.floor(v), max);
}

async function rows(
  query: PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Earliest start first. */
function byStart(a: Row, b: Row): number {
  return Date.parse(a.start_time) - Date.parse(b.start_time);
}

/**
 * The fallback before calendar_event_occurrences is deployed: the masked read's
 * rows overlapping [from, to), by start (a series counts only where its first
 * occurrence falls, as before CALR-21).
 */
function inRange(events: Row[], from: string, to: string): Row[] {
  const [fromMs, toMs] = [Date.parse(from), Date.parse(to)];
  return events
    .filter((e) => Date.parse(e.start_time) < toMs && Date.parse(e.end_time) >= fromMs)
    .sort(byStart);
}

/**
 * Every row of a set-returning read RPC, page by page: PostgREST answers at
 * most 1,000 rows a request. `order` names the columns that keep the pages
 * stable (the function's own ORDER BY, stated again for the offset).
 */
function readRpcPages(ctx: ToolContext, fn: string, args: Row, order: string[] = []): Promise<Row[]> {
  return readAllPages<Row>((from, to) => {
    let query = ctx.db.rpc(fn, args);
    // A stand-in database may answer without a query builder: one page, then.
    if (typeof query.range !== "function") return query;
    for (const column of order) query = query.order(column);
    return query.range(from, to);
  });
}

/**
 * The occurrences read has no function behind it yet (PGRST202: a connector
 * deployed before its migration). Any other failure is an error, never a
 * quiet fallback.
 */
function occurrencesReadMissing(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "PGRST202";
}

/**
 * The events in [from, to), one row per occurrence, by start. The masked read
 * (calendar_events_visible, CALR-15: it answers for the key's person) gives the
 * event rows; calendar_event_occurrences gives each occurrence's times. An
 * occurrence whose event the masked read didn't return is dropped.
 */
async function eventsInWindow(ctx: ToolContext, from: string, to: string): Promise<Row[]> {
  const window = { p_workspace_id: ctx.key.workspaceId, p_from: from, p_to: to };
  const [events, occurrences] = await Promise.all([
    readRpcPages(ctx, "calendar_events_visible", window, ["start_time", "id"]),
    readRpcPages(ctx, "calendar_event_occurrences", window, ["starts_at", "event_id"]).catch((err) => {
      if (occurrencesReadMissing(err)) return null;
      throw err;
    }),
  ]);
  if (occurrences === null) return inRange(events, from, to);

  const eventById = new Map(events.map((e) => [e.id, e]));
  const items: Row[] = [];
  for (const occurrence of occurrences) {
    const event = eventById.get(occurrence.event_id);
    if (!event) continue;
    // A repeat keeps its own first times beside the occurrence's: its id is the series.
    const series = event.recurrence_rule ? { series_start_time: event.start_time, series_end_time: event.end_time } : {};
    items.push({ ...event, ...series, start_time: occurrence.starts_at, end_time: occurrence.ends_at });
  }
  return items.sort(byStart);
}

/** Call an op RPC (workspace-scoped) and return its raw result row. */
async function callOp(ctx: ToolContext, fn: string, args: Row): Promise<Row | null> {
  const { data, error } = await ctx.db.rpc(fn, { p_workspace_id: ctx.key.workspaceId, ...args });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

/** An event's people as agents read them; [] when none. */
function shapePeople(attendees: unknown): Row[] {
  if (!Array.isArray(attendees)) return [];
  return attendees.map((a: Row) => ({ email: a.email ?? null, name: a.name ?? null, status: a.status ?? null }));
}

/** The fields only some events carry: one occurrence, focus time, a hold. */
function shapeEventExtras(e: Row): Row {
  return {
    // One occurrence (CALR-11): an override names the occurrence it replaces,
    // and a series the occurrences it skips (deleted or replaced).
    ...(e.series_id ? { series_id: e.series_id, original_start: e.original_start ?? null } : {}),
    ...(Array.isArray(e.exdates) && e.exdates.length > 0 ? { exdates: e.exdates } : {}),
    // One occurrence of a repeat: the series' own first times. Its id is the series,
    // so an update or delete by that id changes every occurrence.
    ...(e.series_start_time ? { series_starts_at: e.series_start_time, series_ends_at: e.series_end_time ?? null } : {}),
    // Focus time (CALR-14): the task it holds, which the masked read nulls for
    // anyone but its owner (a teammate's arrives titled "Focus time").
    ...(e.kind === "focus" ? { focus_task_id: e.focus_task_id ?? null } : {}),
    // A hold (CALR-19) names the offer it is held for.
    ...(e.kind === "hold" ? { offer_id: e.offer_id ?? null } : {}),
  };
}

/** Where and with whom: place, meeting link and people. */
function shapeEventWhere(e: Row): Row {
  return {
    place: e.location ?? null,
    link: e.conference_url ? { url: e.conference_url, provider: e.conference_provider ?? null } : null,
    people: shapePeople(e.attendees),
  };
}

/**
 * Compact event shape for agents — the calendar_events legacy columns mapped.
 * `me` is the key's person, for `mine`. Google's iCalUID and organizer flag
 * stay out.
 */
function shapeEvent(e: Row, me: string): Row {
  return {
    id: e.id,
    title: e.title,
    starts_at: e.start_time,
    ends_at: e.end_time,
    all_day: Boolean(e.all_day),
    recurrence: e.recurrence_rule ?? null,
    status: e.status ?? "confirmed",
    calendar_id: e.calendar_id,
    external: e.source_account_id !== null,
    source_account_id: e.source_account_id ?? null,
    description: e.description ?? "",
    // A teammate's private item says only Busy, never whether it is focus time or a hold.
    kind: e.is_private && e.owner_id !== me ? "event" : (e.kind ?? "event"),
    private: Boolean(e.is_private),
    ...shapeEventWhere(e),
    owner_id: e.owner_id ?? null,
    mine: e.owner_id === me,
    calendar_ref: e.calendar_ref ?? null,
    ...shapeEventExtras(e),
  };
}

/** A scheduled task rendered as a block (the lens) — its own row, no copy. */
function shapeBlock(t: Row): Row {
  return {
    task_id: t.id,
    title: t.title,
    scheduled_at: t.scheduled_at,
    duration_minutes: t.duration_minutes ?? 30,
    status: t.status,
  };
}

const OPEN_STATUSES = ["todo", "in_progress"];

/** The place, link, privacy, calendar and people fields create and update share. */
const EVENT_DETAIL_PROPERTIES = {
  place: { type: "string", description: "Where it happens (a place or address)." },
  link: { type: ["string", "null"], description: "The meeting link (a URL); empty or null removes it." },
  private: {
    type: "boolean",
    description: "Private: teammates see only \"Busy\", whatever they can see of the calendar.",
  },
  calendar_id: {
    type: ["string", "null"],
    description: "The calendar (a calendars id, an event's calendar_ref) to put it on; null for Your calendar.",
  },
  people: {
    type: "array",
    description: "The people on it (replaces the list). Saved on the event; nobody is sent an invite.",
    items: {
      type: "object",
      properties: { email: { type: "string" }, name: { type: "string" } },
      required: ["email"],
    },
  },
};

/** What the people field sends to the ops: email and, when given, name. */
function peopleArg(people: unknown): Row[] {
  if (!Array.isArray(people)) return [];
  return people.map((p: Row) => (p.name ? { email: p.email, name: p.name } : { email: p.email }));
}

/** What the who-sees levels read as in the summary line. */
const SEES_WORDS: Record<string, string> = {
  all: "sees it all",
  busy: "sees “Busy”",
  focus_time: "sees “Focus time”",
  nothing: "sees nothing",
};

/** Resolve a YYYY-MM-DD (or server-today) to UTC day bounds. */
function dayBounds(date: string | null): { startIso: string; endIso: string; startMs: number } {
  const base = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : new Date();
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000);
  return { startIso: start.toISOString(), endIso: end.toISOString(), startMs: start.getTime() };
}

export const calendarConnectorModule: ConnectorModule = {
  module: "calendar",
  tools: [
    // ── reads (view scope) ───────────────────────────────────────────────────
    {
      name: "calendar_list_events",
      description:
        "Events in a date range, one item per occurrence (repeats included; a repeat's item carries series_starts_at, and its id is the whole series): native Moduo events and mirrored-external ones (read-only through MCP, source-attributed). Each says its kind, place, link, people, privacy and whether it is yours; a teammate's private event reads \"Busy\" and their focus time \"Focus time\". Times are ISO 8601; a range spans at most a year.",
      access: "view",
      hints: "read",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "Range start instant (ISO 8601)." },
          to: { type: "string", description: "Range end instant (ISO 8601)." },
          limit: { type: "number", description: "Max events (default 200, max 500)." },
        },
        required: ["from", "to"],
      },
      handler: async (args, ctx) => {
        const from = str(args, "from");
        const to = str(args, "to");
        const events = await eventsInWindow(ctx, from, to);
        const firstEvents = events.slice(0, clampLimit(args, 200, 500));
        return firstEvents.map((e) => shapeEvent(e, ctx.key.createdBy));
      },
    },
    {
      name: "calendar_day",
      description:
        "The composed day: native + external events, scheduled task blocks, and the 'unfinished from earlier' strip (open tasks whose scheduled time passed). Pass `date` (YYYY-MM-DD, UTC) or omit for today.",
      access: "view",
      hints: "read",
      inputSchema: {
        type: "object",
        properties: {
          date: { type: "string", description: "The day to compose (YYYY-MM-DD, UTC). Defaults to today." },
        },
      },
      handler: async (args, ctx) => {
        const { startIso, endIso, startMs } = dayBounds(str(args, "date", false) || null);
        const nowIso = new Date().toISOString();
        const seesTasks = keyScopeAllows(ctx.key.scopes, "tasks", "view");
        const noTasks = Promise.resolve([] as Row[]);
        const [events, blocks, strip] = await Promise.all([
          eventsInWindow(ctx, startIso, endIso),
          seesTasks
            ? rows(
                ctx.db
                  .from("tasks")
                  .select("id, title, scheduled_at, duration_minutes, status")
                  .eq("workspace_id", ctx.key.workspaceId)
                  .is("deleted_at", null)
                  .gte("scheduled_at", startIso)
                  .lt("scheduled_at", endIso)
                  .order("scheduled_at"),
              )
            : noTasks,
          // The strip: open tasks scheduled in the past 7 days whose time passed.
          seesTasks
            ? rows(
                ctx.db
                  .from("tasks")
                  .select("id, title, scheduled_at, duration_minutes, status")
                  .eq("workspace_id", ctx.key.workspaceId)
                  .is("deleted_at", null)
                  .in("status", OPEN_STATUSES)
                  .gte("scheduled_at", new Date(startMs - 7 * 86_400_000).toISOString())
                  .lt("scheduled_at", nowIso)
                  .order("scheduled_at"),
              )
            : noTasks,
        ]);
        // Match the app's strip semantics: unfinished = the block's END passed
        // (start + duration <= now), so an in-progress block isn't "unfinished".
        const nowMsLocal = Date.parse(nowIso);
        const stripEnded = strip.filter((t) => {
          const start = Date.parse(t.scheduled_at);
          const durMs = (Number(t.duration_minutes) > 0 ? Number(t.duration_minutes) : 30) * 60_000;
          return Number.isFinite(start) && start + durMs <= nowMsLocal;
        });
        const tasks = seesTasks ? await visibleIds(ctx, "task") : new Set<string>();
        return {
          date: startIso.slice(0, 10),
          events: events.map((e) => shapeEvent(e, ctx.key.createdBy)),
          blocks: blocks.filter((t) => tasks.has(t.id)).map(shapeBlock),
          strip: stripEnded.filter((t) => tasks.has(t.id)).map(shapeBlock),
          ...(seesTasks
            ? {}
            : { note: "Task blocks are left out: this API key has no access to Tasks." }),
        };
      },
    },

    // ── writes (edit scope) ──────────────────────────────────────────────────
    {
      name: "calendar_create_event",
      description:
        "Create a native Moduo event, optionally with a place, a meeting link, people, privacy and a calendar (Your calendar by default). Times ISO 8601; `rrule` an optional RFC-5545 rule.",
      access: "edit",
      hints: { destructive: false, idempotent: false },
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title." },
          starts_at: { type: "string", description: "Start instant (ISO 8601)." },
          ends_at: { type: "string", description: "End instant (ISO 8601)." },
          all_day: { type: "boolean", description: "All-day event (default false)." },
          rrule: { type: "string", description: "Optional RFC-5545 RRULE for a repeat." },
          description: { type: "string", description: "Optional notes." },
          ...EVENT_DETAIL_PROPERTIES,
        },
        required: ["title", "starts_at", "ends_at"],
      },
      handler: async (args, ctx) => {
        const opArgs: Row = {
          p_title: str(args, "title"),
          p_starts_at: str(args, "starts_at"),
          p_ends_at: str(args, "ends_at"),
          p_all_day: bool(args, "all_day"),
          p_rrule: str(args, "rrule", false) || null,
          p_description: str(args, "description", false),
        };
        // The new arguments go only when set: an older database matches the exact named set.
        if (args.place !== undefined) opArgs.p_location = args.place;
        if (args.link !== undefined) opArgs.p_conference_url = args.link || null;
        if (args.private !== undefined) opArgs.p_is_private = bool(args, "private");
        if (args.calendar_id !== undefined) opArgs.p_calendar_id = args.calendar_id;
        if (args.people !== undefined) opArgs.p_attendees = peopleArg(args.people);
        const event = await callOp(ctx, "calendar_op_event_create", opArgs);
        return event ? shapeEvent(event, ctx.key.createdBy) : null;
      },
    },
    {
      name: "calendar_update_event",
      description:
        "Edit a native event (only the fields you pass change): times, title, place, link, people, privacy, calendar. A repeating event's id is the whole series: new times move every occurrence (give times relative to series_starts_at). External events are read-only through MCP and are rejected.",
      access: "edit",
      hints: { destructive: false, idempotent: true },
      inputSchema: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "The event uuid." },
          title: { type: "string", description: "New title." },
          starts_at: { type: "string", description: "New start (ISO 8601)." },
          ends_at: { type: "string", description: "New end (ISO 8601)." },
          all_day: { type: "boolean", description: "All-day toggle." },
          rrule: { type: "string", description: "New RRULE, or empty to clear the repeat." },
          description: { type: "string", description: "New notes." },
          ...EVENT_DETAIL_PROPERTIES,
        },
        required: ["event_id"],
      },
      handler: async (args, ctx) => {
        // The op takes a camelCase jsonb patch of only-present keys.
        const patch: Row = {};
        if ("title" in args) patch.title = str(args, "title", false);
        if ("starts_at" in args) patch.startsAt = str(args, "starts_at");
        if ("ends_at" in args) patch.endsAt = str(args, "ends_at");
        if ("all_day" in args) patch.allDay = bool(args, "all_day");
        if ("rrule" in args) patch.rrule = str(args, "rrule", false) || null;
        if ("description" in args) patch.description = str(args, "description", false);
        if ("place" in args) patch.location = args.place;
        if ("link" in args) patch.conferenceUrl = args.link || null;
        if ("private" in args) patch.isPrivate = bool(args, "private");
        if ("calendar_id" in args) patch.calendarId = args.calendar_id ?? null;
        if ("people" in args) patch.attendees = peopleArg(args.people);
        const event = await callOp(ctx, "calendar_op_event_update", {
          p_event_id: str(args, "event_id"),
          p_patch: patch,
        });
        return event ? shapeEvent(event, ctx.key.createdBy) : null;
      },
    },
    {
      name: "calendar_delete_event",
      description: "Delete a native event (tombstoned; spine links cascade). A repeating event's id is the whole series: every occurrence goes. External events are rejected.",
      access: "edit",
      hints: { destructive: true, idempotent: true },
      inputSchema: {
        type: "object",
        properties: { event_id: { type: "string", description: "The event uuid." } },
        required: ["event_id"],
      },
      handler: async (args, ctx) => {
        await callOp(ctx, "calendar_op_event_delete", { p_event_id: str(args, "event_id") });
        return { ok: true };
      },
    },
    {
      name: "calendar_offer_times",
      description:
        "Offer up to 10 times from one of your booking links: returns a link the guest picks one time from. The times are held on your calendar (48 hours, released together) unless `hold` is false. Without `link_id`, your first booking link in this workspace is used.",
      access: "edit",
      hints: { destructive: false, idempotent: false },
      inputSchema: {
        type: "object",
        properties: {
          times: {
            type: "array",
            items: { type: "string" },
            description: "The start instants to offer (ISO 8601), 1 to 10.",
          },
          link_id: { type: "string", description: "The booking link to offer from (default: your first one)." },
          hold: { type: "boolean", description: "Hold the times on your calendar until the guest picks (default true)." },
          title: { type: "string", description: "The meeting's title (default: the link's)." },
          duration_minutes: { type: "number", description: "The meeting's length (default: the link's)." },
          video_provider: {
            type: "string",
            enum: ["google_meet", "zoom", "guest_choice"],
            description: "The video call (default: the link's).",
          },
        },
        required: ["times"],
      },
      handler: async (args, ctx) => {
        const times: string[] = Array.isArray(args.times) ? args.times : [];
        if (times.length === 0) throw new Error("Offer at least one time.");

        let linkId = str(args, "link_id", false);
        if (!linkId) {
          const links = await rows(
            ctx.db
              .from("exposed_slot_links")
              .select("id")
              .eq("workspace_id", ctx.key.workspaceId)
              .eq("owner_user_id", ctx.key.createdBy)
              .is("deleted_at", null)
              .order("created_at")
              .limit(1),
          );
          if (links.length === 0) throw new Error("No booking link yet: make one in Calendar first.");
          linkId = links[0]!.id;
        }

        const opArgs: Row = { p_link_id: linkId, p_starts_at: times, p_hold: args.hold !== false };
        if (args.title !== undefined) opArgs.p_title = args.title;
        if (args.duration_minutes !== undefined) opArgs.p_duration_minutes = args.duration_minutes;
        if (args.video_provider !== undefined) opArgs.p_video_provider = args.video_provider;
        const offer = await callOp(ctx, "calendar_op_offer_create", opArgs);
        if (!offer) return null;
        return {
          offer_id: offer.id,
          url: `${CANONICAL_BOOKING_ORIGIN}/book/r/${offer.slug}`,
          status: offer.status,
          expires_at: offer.expires_at,
          held: Array.isArray(offer.hold_event_ids) ? offer.hold_event_ids.length : 0,
          times,
        };
      },
    },
    {
      name: "calendar_release_offer",
      description: "Withdraw an offer of times: its link stops working and every time it held is released.",
      access: "edit",
      hints: { destructive: true, idempotent: true },
      inputSchema: {
        type: "object",
        properties: { offer_id: { type: "string", description: "The offer uuid (offer_id)." } },
        required: ["offer_id"],
      },
      handler: async (args, ctx) => {
        const offerId = str(args, "offer_id");
        const status = await callOp(ctx, "calendar_op_offer_release", { p_offer_id: offerId });
        return { offer_id: offerId, status };
      },
    },
    {
      name: "calendar_who_sees",
      description:
        "Who sees what of your calendars: each teammate's level (all, busy, focus_time or nothing). With `event_id` (one of your own events), what each teammate sees of that event: a private event reads \"Busy\", focus time \"Focus time\".",
      access: "view",
      hints: "read",
      inputSchema: {
        type: "object",
        properties: { event_id: { type: "string", description: "One of your own events (omit for all your calendars)." } },
      },
      handler: async (args, ctx) => {
        const eventId = str(args, "event_id", false) || null;
        const [levels, members] = await Promise.all([
          readRpcPages(ctx, "calendar_who_sees", { p_workspace_id: ctx.key.workspaceId, p_event_id: eventId }, [
            "calendar_name",
            "calendar_id",
            "user_id",
          ]),
          workspaceMembers(ctx),
        ]);
        const nameById = new Map(members.map((m) => [m.user_id, m.name]));
        const person = (r: Row) => ({ user_id: r.user_id, name: nameById.get(r.user_id) ?? "Member", sees: r.sees });

        if (eventId) {
          const people = levels.map(person);
          const summary = people.length === 0
            ? "Only you see it."
            : people.map((p) => `${p.name} ${SEES_WORDS[p.sees] ?? p.sees}`).join(" · ");
          return {
            event_id: eventId,
            calendar_id: levels[0]?.calendar_id ?? null,
            calendar: levels[0]?.calendar_name ?? null,
            people,
            summary,
          };
        }

        // One entry per calendar, in the RPC's order (by calendar name).
        const calendars: Row[] = [];
        for (const r of levels) {
          let entry = calendars.find((c) => c.calendar_id === r.calendar_id);
          if (!entry) {
            entry = { calendar_id: r.calendar_id, name: r.calendar_name, people: [] };
            calendars.push(entry);
          }
          entry.people.push(person(r));
        }
        return { calendars };
      },
    },
    {
      name: "calendar_schedule_task",
      description: "Place a task on the calendar at a clock time — it becomes a task block (the lens).",
      access: "edit",
      hints: { destructive: false, idempotent: true },
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "The task uuid." },
          scheduled_at: { type: "string", description: "The block's start instant (ISO 8601)." },
        },
        required: ["task_id", "scheduled_at"],
      },
      handler: async (args, ctx) => {
        const task = await callOp(ctx, "tasks_op_reschedule", {
          p_task_id: str(args, "task_id"),
          p_scheduled_at: str(args, "scheduled_at"),
          p_days: null,
        });
        return task ? { task_id: task.id, scheduled_at: task.scheduled_at } : null;
      },
    },
    {
      name: "calendar_move_block",
      description: "Move an already-scheduled task block to a new time (duration preserved).",
      access: "edit",
      hints: { destructive: false, idempotent: true },
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "The task uuid." },
          scheduled_at: { type: "string", description: "New start instant (ISO 8601)." },
        },
        required: ["task_id", "scheduled_at"],
      },
      handler: async (args, ctx) => {
        const task = await callOp(ctx, "tasks_op_reschedule", {
          p_task_id: str(args, "task_id"),
          p_scheduled_at: str(args, "scheduled_at"),
          p_days: null,
        });
        return task ? { task_id: task.id, scheduled_at: task.scheduled_at } : null;
      },
    },
    {
      name: "calendar_complete_block",
      description: "Complete a task from its block (recurrence advances) — same as completing in Tasks.",
      access: "edit",
      hints: { destructive: false, idempotent: false },
      inputSchema: {
        type: "object",
        properties: { task_id: { type: "string", description: "The task uuid." } },
        required: ["task_id"],
      },
      handler: async (args, ctx) => {
        const task = await callOp(ctx, "tasks_op_set_status", {
          p_task_id: str(args, "task_id"),
          p_status: "done",
          p_recurrence: null,
          p_position: null,
        });
        return task ? { task_id: task.id, status: task.status } : null;
      },
    },
    {
      name: "calendar_roll_forward",
      description:
        "The strip's Move-to-today: reschedule every open task whose scheduled time passed (last 7 days) onto today, preserving each task's clock time. Returns the moved task ids.",
      access: "edit",
      hints: { destructive: false, idempotent: true },
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, ctx) => {
        const now = new Date();
        const drifted = await rows(
          ctx.db
            .from("tasks")
            .select("id, scheduled_at, duration_minutes")
            .eq("workspace_id", ctx.key.workspaceId)
            .is("deleted_at", null)
            .in("status", OPEN_STATUSES)
            .gte("scheduled_at", new Date(now.getTime() - 7 * 86_400_000).toISOString())
            .lt("scheduled_at", now.toISOString()),
        );
        // Only tasks the key's creator can see: the op would refuse the rest.
        const visibleTasks = await visibleIds(ctx, "task");
        // Unfinished = the block's END passed (the app's strip semantics) — an
        // in-progress block is not rolled out from under the user.
        const ended = drifted.filter((t) => {
          if (!visibleTasks.has(t.id)) return false;
          const start = Date.parse(t.scheduled_at);
          const durMs = (Number(t.duration_minutes) > 0 ? Number(t.duration_minutes) : 30) * 60_000;
          return Number.isFinite(start) && start + durMs <= now.getTime();
        });
        const moved: string[] = [];
        // First placement candidate: never in the past — the next 15-min
        // boundary after now (a rolled task landing behind now would be
        // instantly "unfinished" again). Slots then stack sequentially.
        const STEP = 15 * 60_000;
        let cursor = Math.ceil(now.getTime() / STEP) * STEP;
        for (const t of ended) {
          // Keep the original clock time when it's still ahead today (UTC);
          // otherwise take the next free sequential slot after now.
          const orig = new Date(t.scheduled_at);
          const sameClock = Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
            orig.getUTCHours(),
            orig.getUTCMinutes(),
          );
          let targetMs: number;
          if (sameClock > now.getTime()) {
            targetMs = sameClock;
          } else {
            targetMs = cursor;
            const durMs =
              (Number(t.duration_minutes) > 0 ? Number(t.duration_minutes) : 30) * 60_000;
            cursor = Math.ceil((cursor + durMs) / STEP) * STEP;
          }
          const task = await callOp(ctx, "tasks_op_reschedule", {
            p_task_id: t.id,
            p_scheduled_at: new Date(targetMs).toISOString(),
            p_days: null,
          });
          if (task?.id) moved.push(task.id);
        }
        return { moved: moved.length, task_ids: moved };
      },
    },
  ],
};
