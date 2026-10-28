/**
 * Google Calendar for the web app. The browser cannot read the desktop
 * keychain, so sync and create use the refresh token stored at connect.
 * Deploy with verify_jwt = false and check the user JWT here (the gateway
 * only understands legacy JWT keys).
 *
 * POST { action: "status" }
 * POST { action: "events", externalAccountId, timeMin, timeMax }
 * POST { action: "push", externalAccountId, title, startsAt, endsAt, allDay, description, rrule, timeZone,
 *        location?, attendees?, isPrivate?, meet?: "add" }
 * POST { action: "update", externalAccountId, calendarId, eventId, patch, timeZone } → { event }
 * POST { action: "delete", externalAccountId, calendarId, eventId } → { ok }
 *
 * Google refusing a write (no writer access, …) answers 409 { error: Google's reason }.
 * A login whose token Google revoked is marked reauth (calendar_op__google_reauth)
 * and its account actions answer 409 { error: "google_reauth" }; a working token clears it.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import {
  googleCalendarTarget,
  googleEventBody,
  type GoogleEventPatch,
  GoogleRefusal,
  googleSendUpdates,
  googleUserEmail,
  insertGoogleEvent,
  listGoogleCalendars,
  listGoogleEvents,
  patchGoogleEvent,
  removeGoogleEvent,
  ymdInZone,
} from "../_shared/google-calendar.ts";
import { APP_TOKEN_REFUSAL, verifiedPerson } from "../_shared/app-token.ts";
import { googleAccessOutcome, googleClients } from "../_shared/google-token.ts";
import { getDefaultSecretKey } from "../_shared/secret-keys.ts";
import { recordGoogleAccess, type StatusCalendar, statusCalendars } from "./accounts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SECRET = getDefaultSecretKey();
const ENC = Deno.env.get("MODUO_TOKEN_ENCRYPTION_SECRET") ?? "";
const GOOGLE_CLIENTS = googleClients((name) => Deno.env.get(name));

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type TokenRow = {
  id: string;
  account_key: string;
  refresh_token_enc: string | null;
  access_token_enc: string | null;
  token_expiry: string | null;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

/** Google refusing a write is the caller's to hear (409 with Google's reason); anything else is 502. */
function writeFailure(err: unknown, fallback: string): Response {
  if (err instanceof GoogleRefusal) return json({ error: err.message }, 409);
  return json({ error: err instanceof Error ? err.message : fallback }, 502);
}

/** Guests as the app sends them ({email, name}) → Google's ({email, displayName?}). */
function guestList(value: unknown): { email: string; name?: string }[] | null {
  if (!Array.isArray(value)) return null;
  const out: { email: string; name?: string }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const person = item as Record<string, unknown>;
    if (typeof person.email !== "string" || !person.email.trim()) return null;
    out.push({
      email: person.email.trim(),
      name: typeof person.name === "string" ? person.name : undefined,
    });
  }
  return out;
}

/** One field reader: the value, `undefined` to skip it, or `INVALID`. */
const INVALID = Symbol("invalid");
type FieldReader = (value: unknown) => unknown;
const asString: FieldReader = (v) => (typeof v === "string" ? v : INVALID);
const asBoolean: FieldReader = (v) => (typeof v === "boolean" ? v : INVALID);
const PATCH_FIELDS: Record<keyof GoogleEventPatch, FieldReader> = {
  title: asString,
  description: asString,
  startsAt: asString,
  endsAt: asString,
  location: (v) => (v === null || typeof v === "string" ? v : INVALID),
  allDay: asBoolean,
  isPrivate: asBoolean,
  attendees: (v) => guestList(v) ?? INVALID,
  meet: (v) => (v === "add" || v === "remove" ? v : INVALID),
};

/** The app's patch, keeping only the keys Google takes; null when one has the wrong type. */
function readPatch(value: unknown): GoogleEventPatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  // A key this action can't send (repeats, another calendar, a kind) is a
  // refusal, never a silent no-op the app would read as saved.
  if (Object.keys(raw).some((key) => raw[key] !== undefined && !(key in PATCH_FIELDS))) return null;
  const patch: Record<string, unknown> = {};
  for (const [key, read] of Object.entries(PATCH_FIELDS)) {
    if (raw[key] === undefined) continue;
    const field = read(raw[key]);
    if (field === INVALID) return null;
    patch[key] = field;
  }
  return patch as GoogleEventPatch;
}

/** The row's token and login; "revoked" (marked reauth) when Google revoked it; null when unavailable. */
async function accessForRow(
  db: SupabaseClient,
  userId: string,
  row: TokenRow,
): Promise<{ accessToken: string; email: string } | "revoked" | null> {
  const outcome = await googleAccessOutcome({ db, encSecret: ENC, clients: GOOGLE_CLIENTS }, userId, row);
  if (outcome.kind === "revoked") {
    await recordGoogleAccess(db, userId, row.account_key, outcome);
    return "revoked";
  }
  if (outcome.kind !== "ok") return null;
  const access = outcome.accessToken;
  const email = (await googleUserEmail(access))?.toLowerCase() ?? row.account_key;
  if (!email) return null;
  if (row.account_key !== email) {
    await db.from("user_integrations").update({ account_key: email }).eq("id", row.id);
  }
  await recordGoogleAccess(db, userId, email, outcome);
  return { accessToken: access, email };
}

async function tokensForUser(db: SupabaseClient, userId: string): Promise<TokenRow[]> {
  const res = await db
    .from("user_integrations")
    .select("id, account_key, refresh_token_enc, access_token_enc, token_expiry")
    .eq("user_id", userId)
    .eq("provider", "google_calendar");
  return (res.data ?? []) as TokenRow[];
}

async function accessForEmail(
  db: SupabaseClient,
  userId: string,
  email: string,
): Promise<string | "revoked" | null> {
  const rows = await tokensForUser(db, userId);
  const wanted = email.toLowerCase();
  for (const row of rows) {
    const access = await accessForRow(db, userId, row);
    if (access === "revoked") {
      if (row.account_key === wanted) return "revoked";
    } else if (access && access.email === wanted) return access.accessToken;
  }
  // A token saved before account_key existed: one row, email still blank until refresh.
  if (rows.length === 1 && !rows[0].account_key) {
    const access = await accessForRow(db, userId, rows[0]);
    if (access && access !== "revoked") return access.accessToken;
  }
  return null;
}

/** What every action after the account check works with. */
type AccountCtx = {
  body: Record<string, unknown>;
  accessToken: string;
  email: string;
  /** The account's own Google calendar id (`google:<email>:<calId>`), or null for a whole login. */
  calendarId: string | null;
};

async function statusAction(db: SupabaseClient, userId: string): Promise<Response> {
  const rows = await tokensForUser(db, userId);
  const calendars: StatusCalendar[] = [];
  const reauth: string[] = [];
  for (const row of rows) {
    const access = await accessForRow(db, userId, row);
    if (access === "revoked") {
      if (row.account_key) reauth.push(row.account_key);
      continue;
    }
    if (!access) continue;
    let listed: Awaited<ReturnType<typeof listGoogleCalendars>> = [];
    try {
      listed = await listGoogleCalendars(access.accessToken);
    } catch {
      listed = [];
    }
    calendars.push(...statusCalendars(access.email, listed));
  }
  return json({ calendars, reauth });
}

async function eventsAction({ body, accessToken, email, calendarId }: AccountCtx): Promise<Response> {
  const timeMin = typeof body.timeMin === "string" ? body.timeMin : "";
  const timeMax = typeof body.timeMax === "string" ? body.timeMax : "";
  if (!timeMin || !timeMax) return json({ error: "bad_window" }, 400);
  let calendars = calendarId ? [{ id: calendarId }] : [];
  if (!calendarId) {
    try {
      calendars = await listGoogleCalendars(accessToken);
    } catch {
      return json({ error: "google_calendars_failed" }, 502);
    }
  }
  const events: Record<string, unknown>[] = [];
  try {
    for (const cal of calendars) {
      const items = await listGoogleEvents({
        accessToken,
        calendarId: cal.id,
        timeMin,
        timeMax,
      });
      for (const item of items) {
        events.push({ ...item, calendarId: `google:${email}:${cal.id}` });
      }
    }
  } catch {
    return json({ error: "google_events_failed" }, 502);
  }
  return json({ events });
}

/** A non-empty string from the body, else the fallback. */
function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

type PushEvent = {
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  description: string;
  rrule: string | null;
  timeZone: string;
  location?: string;
  guests?: { email: string; name?: string }[];
};

/** The `push` body as an event to create; null when it is missing what it needs. */
function readPushEvent(body: Record<string, unknown>): PushEvent | null {
  const title = text(body.title).trim();
  const startsAt = text(body.startsAt);
  const endsAt = text(body.endsAt);
  if (!title || !startsAt || !endsAt) return null;
  const guests = body.attendees === undefined ? undefined : guestList(body.attendees);
  if (guests === null) return null;
  return {
    title,
    startsAt,
    endsAt,
    allDay: body.allDay === true,
    description: text(body.description),
    rrule: text(body.rrule) || null,
    timeZone: text(body.timeZone, "UTC"),
    location: text(body.location) || undefined,
    guests,
  };
}

async function pushAction({ body, accessToken, email, calendarId }: AccountCtx): Promise<Response> {
  const event = readPushEvent(body);
  if (!event) return json({ error: "bad_event" }, 400);
  const { allDay, timeZone, guests } = event;
  const extras = googleEventBody(
    {
      attendees: guests,
      isPrivate: body.isPrivate === true ? true : undefined,
      meet: body.meet === "add" ? "add" : undefined,
    },
    { timeZone, requestId: crypto.randomUUID() },
  );
  const targetCalendar = calendarId || "primary";
  let created: Record<string, unknown>;
  try {
    created = await insertGoogleEvent({
      accessToken,
      calendarId: targetCalendar,
      summary: event.title,
      description: event.description,
      start: allDay
        ? { date: ymdInZone(event.startsAt, timeZone) }
        : { dateTime: event.startsAt, timeZone },
      end: allDay
        ? { date: ymdInZone(event.endsAt, timeZone) }
        : { dateTime: event.endsAt, timeZone },
      recurrence: event.rrule ? [`RRULE:${event.rrule}`] : undefined,
      location: event.location,
      attendees: extras.attendees as { email: string; displayName?: string }[] | undefined,
      visibility: extras.visibility as "private" | undefined,
      conferenceData: extras.conferenceData as Record<string, unknown> | undefined,
      sendUpdates: guests && guests.length > 0 ? "all" : undefined,
    });
  } catch (err) {
    return writeFailure(err, "google_event_failed");
  }
  return json({ event: { ...created, calendarId: `google:${email}:${targetCalendar}` } });
}

/**
 * The Google calendar an event write goes to: the event's own (`google:<email>:<calId>`),
 * else the account's, else primary. An event tagged with another login is refused
 * (its token would answer 404, which a delete would read as already gone).
 */
function writeTarget(body: Record<string, unknown>, email: string, calendarId: string | null): string | null {
  const tag = typeof body.calendarId === "string" ? body.calendarId : "";
  if (tag.startsWith(`google:${email}:`)) return googleCalendarTarget(tag);
  if (tag.startsWith("google:") && tag.includes(":", "google:".length)) return null;
  return calendarId || "primary";
}

async function writeAction(
  action: "update" | "delete",
  { body, accessToken, email, calendarId }: AccountCtx,
): Promise<Response> {
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  if (!eventId) return json({ error: "bad_event" }, 400);
  const target = writeTarget(body, email, calendarId);
  if (!target) return json({ error: "bad_account" }, 400);
  if (action === "delete") {
    try {
      await removeGoogleEvent({ accessToken, calendarId: target, eventId, sendUpdates: "all" });
    } catch (err) {
      return writeFailure(err, "google_delete_failed");
    }
    return json({ ok: true });
  }
  const patch = readPatch(body.patch);
  if (!patch) return json({ error: "bad_patch" }, 400);
  const timeZone =
    typeof body.timeZone === "string" && body.timeZone.length > 0 ? body.timeZone : "UTC";
  let saved: Record<string, unknown>;
  try {
    saved = await patchGoogleEvent({
      accessToken,
      calendarId: target,
      eventId,
      body: googleEventBody(patch, { timeZone, requestId: crypto.randomUUID() }),
      sendUpdates: googleSendUpdates(patch),
    });
  } catch (err) {
    return writeFailure(err, "google_update_failed");
  }
  return json({ event: { ...saved, calendarId: `google:${email}:${target}` } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!ENC) return json({ error: "google_not_configured" }, 503);

  const db = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false } });
  const caller = await verifiedPerson(db.auth, req.headers.get("Authorization"));
  if (caller.kind === "app") return json(APP_TOKEN_REFUSAL, 403);
  if (caller.kind !== "person") return json({ error: "unauthorized" }, 401);
  const userId = caller.user.id;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const action = typeof body.action === "string" ? body.action : "status";

  if (action === "status") return statusAction(db, userId);

  if (action === "disconnect") {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email) return json({ error: "bad_account" }, 400);
    const removed = await db
      .from("user_integrations")
      .delete()
      .eq("user_id", userId)
      .eq("provider", "google_calendar")
      .eq("account_key", email);
    if (removed.error) return json({ error: "disconnect_failed" }, 500);
    return json({ ok: true });
  }

  const externalAccountId = typeof body.externalAccountId === "string" ? body.externalAccountId : "";
  if (!externalAccountId.startsWith("google:")) return json({ error: "bad_account" }, 400);
  const rest = externalAccountId.slice("google:".length);
  const colon = rest.indexOf(":");
  const email = (colon < 0 ? rest : rest.slice(0, colon)).toLowerCase();
  const calendarId = colon < 0 ? null : rest.slice(colon + 1);
  if (!email) return json({ error: "bad_account" }, 400);
  const accessToken = await accessForEmail(db, userId, email);
  if (accessToken === "revoked") return json({ error: "google_reauth" }, 409);
  if (!accessToken) return json({ error: "google_not_connected" }, 409);

  const ctx: AccountCtx = { body, accessToken, email, calendarId };
  if (action === "events") return eventsAction(ctx);
  if (action === "push") return pushAction(ctx);
  if (action === "update" || action === "delete") return writeAction(action, ctx);
  return json({ error: "unknown_action" }, 400);
});
