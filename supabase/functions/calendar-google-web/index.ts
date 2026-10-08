/**
 * Google Calendar for the web app. The browser cannot read the desktop
 * keychain, so sync and create use the refresh token stored at connect.
 * Deploy with verify_jwt = false and check the user JWT here (the gateway
 * only understands legacy JWT keys).
 *
 * POST { action: "status" }
 * POST { action: "events", externalAccountId, timeMin, timeMax }
 * POST { action: "push", externalAccountId, title, startsAt, endsAt, allDay, description, rrule, timeZone }
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import {
  googleUserEmail,
  insertGoogleEvent,
  listGoogleCalendars,
  listGoogleEvents,
  refreshGoogleAccess,
} from "../_shared/google-calendar.ts";
import { getDefaultSecretKey } from "../_shared/secret-keys.ts";
import { decryptToken, encryptToken } from "../_shared/token-cipher.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SECRET = getDefaultSecretKey();
const ENC = Deno.env.get("MODUO_TOKEN_ENCRYPTION_SECRET") ?? "";
const GOOGLE_CLIENTS = [
  {
    id: Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID") ?? "",
    secret: Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET") ?? "",
  },
  {
    id: Deno.env.get("GOOGLE_CALENDAR_WEB_CLIENT_ID") ?? "",
    secret: Deno.env.get("GOOGLE_CALENDAR_WEB_CLIENT_SECRET") ?? "",
  },
].filter((client) => client.id.length > 0 && client.secret.length > 0);

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

function ymdInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

async function accessForRow(
  db: SupabaseClient,
  userId: string,
  row: TokenRow,
): Promise<{ accessToken: string; email: string } | null> {
  if (!ENC || !row.refresh_token_enc || GOOGLE_CLIENTS.length === 0) return null;
  let refresh: string;
  try {
    refresh = await decryptToken(row.refresh_token_enc, ENC, userId);
  } catch {
    return null;
  }
  const expiry = row.token_expiry ? Date.parse(row.token_expiry) : 0;
  let access = "";
  if (expiry > Date.now() + 60_000 && row.access_token_enc) {
    try {
      access = await decryptToken(row.access_token_enc, ENC, userId);
    } catch {
      access = "";
    }
  }
  if (!access) {
    let fresh: { accessToken: string; expiresAt: string; refreshToken: string } | null = null;
    for (const client of GOOGLE_CLIENTS) {
      try {
        fresh = await refreshGoogleAccess({
          clientId: client.id,
          clientSecret: client.secret,
          refreshToken: refresh,
        });
        break;
      } catch {
        fresh = null;
      }
    }
    if (!fresh) return null;
    access = fresh.accessToken;
    const accessEnc = await encryptToken(fresh.accessToken, ENC, userId);
    const refreshOut =
      fresh.refreshToken === refresh
        ? row.refresh_token_enc
        : await encryptToken(fresh.refreshToken, ENC, userId);
    await db
      .from("user_integrations")
      .update({
        access_token_enc: accessEnc,
        refresh_token_enc: refreshOut,
        token_expiry: fresh.expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
  }
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

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "unauthorized" }, 401);
  const db = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false } });
  const user = await db.auth.getUser(jwt);
  if (user.error || !user.data.user) return json({ error: "unauthorized" }, 401);
  const userId = user.data.user.id;

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
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "google_event_failed";
      return json({ error: message }, 502);
    }
    const writtenId = calendarId ? `google:${email}:${calendarId}` : `google:${email}:primary`;
    return json({ event: { ...created, calendarId: writtenId } });
  }

  return json({ error: "unknown_action" }, 400);
});
