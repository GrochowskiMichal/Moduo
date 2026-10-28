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
import { googleAccessForRow, googleClients } from "../_shared/google-token.ts";
import { getDefaultSecretKey } from "../_shared/secret-keys.ts";

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

/** The app's patch, keeping only keys of the right type; null when one is wrong. */
function readPatch(value: unknown): GoogleEventPatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const patch: GoogleEventPatch = {};
  for (const key of ["title", "description", "startsAt", "endsAt"] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "string") return null;
    patch[key] = raw[key] as string;
  }
  if (raw.location !== undefined) {
    if (raw.location !== null && typeof raw.location !== "string") return null;
    patch.location = raw.location as string | null;
  }
  for (const key of ["allDay", "isPrivate"] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "boolean") return null;
    patch[key] = raw[key] as boolean;
  }
  if (raw.attendees !== undefined) {
    const guests = guestList(raw.attendees);
    if (!guests) return null;
    patch.attendees = guests;
  }
  if (raw.meet !== undefined) {
    if (raw.meet !== "add" && raw.meet !== "remove") return null;
    patch.meet = raw.meet;
  }
  return patch;
}

async function accessForRow(
  db: SupabaseClient,
  userId: string,
  row: TokenRow,
): Promise<{ accessToken: string; email: string } | null> {
  const access = await googleAccessForRow({ db, encSecret: ENC, clients: GOOGLE_CLIENTS }, userId, row);
  if (!access) return null;
  const email = (await googleUserEmail(access))?.toLowerCase() ?? row.account_key;
  if (!email) return null;
  if (row.account_key !== email) {
    await db.from("user_integrations").update({ account_key: email }).eq("id", row.id);
  }
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
): Promise<string | null> {
  const rows = await tokensForUser(db, userId);
  const wanted = email.toLowerCase();
  for (const row of rows) {
    const access = await accessForRow(db, userId, row);
    if (access && access.email === wanted) return access.accessToken;
  }
  // A token saved before account_key existed: one row, email still blank until refresh.
  if (rows.length === 1 && !rows[0].account_key) {
    const access = await accessForRow(db, userId, rows[0]);
    if (access) return access.accessToken;
  }
  return null;
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

  if (action === "status") {
    const rows = await tokensForUser(db, userId);
    const calendars: {
      email: string;
      accountId: string;
      summary: string;
      googleCalendarId: string;
    }[] = [];
    for (const row of rows) {
      const access = await accessForRow(db, userId, row);
      if (!access) continue;
      let listed: { id: string; summary: string; primary: boolean }[] = [];
      try {
        listed = await listGoogleCalendars(access.accessToken);
      } catch {
        listed = [];
      }
      if (listed.length === 0) {
        calendars.push({
          email: access.email,
          accountId: `google:${access.email}:primary`,
          summary: access.email,
          googleCalendarId: "primary",
        });
        continue;
      }
      for (const cal of listed) {
        calendars.push({
          email: access.email,
          accountId: `google:${access.email}:${cal.id}`,
          summary: cal.summary,
          googleCalendarId: cal.id,
        });
      }
    }
    return json({ calendars });
  }

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
  if (!accessToken) return json({ error: "google_not_connected" }, 409);

  if (action === "events") {
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

  if (action === "push") {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const startsAt = typeof body.startsAt === "string" ? body.startsAt : "";
    const endsAt = typeof body.endsAt === "string" ? body.endsAt : "";
    const allDay = body.allDay === true;
    const description = typeof body.description === "string" ? body.description : "";
    const rrule = typeof body.rrule === "string" && body.rrule.length > 0 ? body.rrule : null;
    const timeZone =
      typeof body.timeZone === "string" && body.timeZone.length > 0 ? body.timeZone : "UTC";
    if (!title || !startsAt || !endsAt) return json({ error: "bad_event" }, 400);
    const location = typeof body.location === "string" && body.location ? body.location : undefined;
    const guests = body.attendees === undefined ? undefined : guestList(body.attendees);
    if (guests === null) return json({ error: "bad_event" }, 400);
    const extras = googleEventBody(
      { attendees: guests, isPrivate: body.isPrivate === true ? true : undefined, meet: body.meet === "add" ? "add" : undefined },
      { timeZone, requestId: crypto.randomUUID() },
    );
    const targetCalendar = calendarId || "primary";
    let created: Record<string, unknown>;
    try {
      created = await insertGoogleEvent({
        accessToken,
        calendarId: targetCalendar,
        summary: title,
        description,
        start: allDay
          ? { date: ymdInZone(startsAt, timeZone) }
          : { dateTime: startsAt, timeZone },
        end: allDay ? { date: ymdInZone(endsAt, timeZone) } : { dateTime: endsAt, timeZone },
        recurrence: rrule ? [`RRULE:${rrule}`] : undefined,
        location,
        attendees: extras.attendees as { email: string; displayName?: string }[] | undefined,
        visibility: extras.visibility as "private" | undefined,
        conferenceData: extras.conferenceData as Record<string, unknown> | undefined,
        sendUpdates: guests && guests.length > 0 ? "all" : undefined,
      });
    } catch (err) {
      return writeFailure(err, "google_event_failed");
    }
    const writtenId = calendarId ? `google:${email}:${calendarId}` : `google:${email}:primary`;
    return json({ event: { ...created, calendarId: writtenId } });
  }

  if (action === "update" || action === "delete") {
    const eventId = typeof body.eventId === "string" ? body.eventId : "";
    if (!eventId) return json({ error: "bad_event" }, 400);
    const target = googleCalendarTarget(typeof body.calendarId === "string" ? body.calendarId : null);
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

  return json({ error: "unknown_action" }, 400);
});
