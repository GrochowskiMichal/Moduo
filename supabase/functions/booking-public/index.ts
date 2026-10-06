/**
 * Public booking API. Deploy with verify_jwt = false — guests have no session.
 * The slug (and the cancel token) are the capability. Writes go through
 * service_role and booking_op_commit / booking_op_release.
 *
 * POST { action: "preview", slug, timeZone }
 * POST { action: "book", slug, start, timeZone, name, email, note, guests, answers, video }
 *
 * A link's video_provider is google_meet, zoom, or guest_choice. The guest only
 * ever sees platforms the host has connected (Google refresh token / Zoom login).
 * POST { action: "cancel-preview", token }
 * POST { action: "cancel", token }
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import {
  createGoogleMeetEvent,
  deleteGoogleEvent,
  googleFreeBusy,
  googleUserEmail,
  refreshGoogleAccess,
} from "../_shared/google-calendar.ts";
import { getDefaultSecretKey } from "../_shared/secret-keys.ts";
import {
  createZoomMeeting,
  deleteZoomMeeting,
  zoomAccess,
  zoomConfigured,
  zoomConnected,
  zoomMeetingIdFromLink,
} from "../_shared/zoom.ts";
import { decryptToken, encryptToken } from "../_shared/token-cipher.ts";
import { parseGuestEmails } from "../../../src/features/calendar/booking/guests.ts";
import {
  computeOpenSlots,
  normalizeWeeklyHours,
  type Interval,
} from "../../../src/features/calendar/booking/slots.ts";
import {
  pickVideo,
  VIDEO_LABEL,
  type VideoProvider,
  videoOptions,
  videoSetting,
} from "../../../src/features/calendar/booking/video.ts";

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
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "Moduo <noreply@moduo.app>";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type LinkRow = {
  id: string;
  slot_id: string;
  slug: string;
  name: string;
  description: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  date_range_days: number;
  min_notice_minutes: number;
  host_timezone: string;
  weekly_hours: unknown;
  busy_calendar_ids: unknown;
  note_enabled: boolean;
  guests_enabled: boolean;
  questions_json: unknown;
  paused: boolean;
  video_provider: string | null;
  owner_user_id: string;
  owner_email: string | null;
  owner_display_name: string | null;
  owner_avatar_url: string | null;
  workspace_id: string | null;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function busyIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ["moduo"];
  return raw.filter((id): id is string => typeof id === "string" && id.length > 0);
}

async function loadLink(db: SupabaseClient, slug: string): Promise<LinkRow | null> {
  const res = await db
    .from("exposed_slot_links")
    .select("*")
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle();
  if (res.error || !res.data) return null;
  return res.data as LinkRow;
}

async function googleAccess(
  db: SupabaseClient,
  userId: string,
): Promise<{ accessToken: string; email: string | null } | null> {
  if (!ENC || GOOGLE_CLIENTS.length === 0) return null;
  const row = await db
    .from("user_integrations")
    .select("refresh_token_enc, access_token_enc, token_expiry")
    .eq("user_id", userId)
    .eq("provider", "google_calendar")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const refreshEnc = row.data?.refresh_token_enc as string | null | undefined;
  if (!refreshEnc) return null;
  let refresh: string;
  try {
    refresh = await decryptToken(refreshEnc, ENC, userId);
  } catch {
    return null;
  }
  const expiry = row.data?.token_expiry ? Date.parse(String(row.data.token_expiry)) : 0;
  let access = "";
  if (expiry > Date.now() + 60_000 && row.data?.access_token_enc) {
    try {
      access = await decryptToken(String(row.data.access_token_enc), ENC, userId);
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
      fresh.refreshToken === refresh ? refreshEnc : await encryptToken(fresh.refreshToken, ENC, userId);
    await db
      .from("user_integrations")
      .update({
        access_token_enc: accessEnc,
        refresh_token_enc: refreshOut,
        token_expiry: fresh.expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("provider", "google_calendar");
  }
  const email = await googleUserEmail(access);
  return { accessToken: access, email };
}

async function busyIntervals(
  db: SupabaseClient,
  link: LinkRow,
  from: Date,
  to: Date,
  accessToken: string | null,
): Promise<Interval[]> {
  const ids = new Set(busyIds(link.busy_calendar_ids));
  const events = await db
    .from("calendar_events")
    .select("start_time, end_time, source_account_id, calendar_id")
    .eq("workspace_id", link.workspace_id)
    // PERM-0: only the host's own calendar decides their availability —
    // a teammate's events must neither block slots nor be inferable here.
    .eq("owner_id", link.owner_user_id)
    .is("deleted_at", null)
    .lt("start_time", to.toISOString())
    .gt("end_time", from.toISOString());
  const intervals: Interval[] = [];
  for (const row of events.data ?? []) {
    const account = (row.source_account_id as string | null) ?? null;
    const calendarId = (row.calendar_id as string | null) ?? "moduo";
    const isModuo = account == null && (calendarId === "moduo" || calendarId === "");
    const selected = (account != null && ids.has(account)) || (isModuo && ids.has("moduo"));
    if (!selected) continue;
    intervals.push({
      start: new Date(String(row.start_time)),
      end: new Date(String(row.end_time)),
    });
  }

  const bookings = await db
    .from("slot_bookings")
    .select("start_at, end_at, status, updated_at")
    .eq("slot_id", link.slot_id)
    .in("status", ["pending", "confirmed"])
    .lt("start_at", to.toISOString())
    .gt("end_at", from.toISOString());
  const staleBefore = Date.now() - 5 * 60_000;
  for (const row of bookings.data ?? []) {
    if (row.status === "pending" && Date.parse(String(row.updated_at)) < staleBefore) continue;
    intervals.push({
      start: new Date(String(row.start_at)),
      end: new Date(String(row.end_at)),
    });
  }

  if (accessToken && link.workspace_id) {
    const accounts = await db
      .from("calendar_accounts")
      .select("id, provider")
      .eq("workspace_id", link.workspace_id)
      .is("deleted_at", null);
    const wantsGoogle = (accounts.data ?? []).some(
      (account) => account.provider === "google" && ids.has(String(account.id)),
    );
    if (wantsGoogle) {
      const live = await googleFreeBusy(accessToken, from.toISOString(), to.toISOString());
      for (const block of live) {
        intervals.push({ start: new Date(block.start), end: new Date(block.end) });
      }
    }
  }
  return intervals;
}

/** The host's calendar account row that mirrors their primary Google calendar. */
async function googleMirrorAccount(
  db: SupabaseClient,
  link: LinkRow,
  email: string,
): Promise<{ id: string; calendarId: string } | null> {
  if (!link.workspace_id) return null;
  const address = email.toLowerCase();
  const primary = `google:${address}:${address}`;
  const res = await db
    .from("calendar_accounts")
    .select("id, external_id")
    .eq("workspace_id", link.workspace_id)
    .eq("owner_id", link.owner_user_id)
    .eq("provider", "google")
    .is("deleted_at", null)
    .in("external_id", [primary, `google:${address}`]);
  const rows = (res.data ?? []) as { id: string; external_id: string }[];
  const row = rows.find((item) => item.external_id === primary) ?? rows[0];
  return row ? { id: String(row.id), calendarId: primary } : null;
}

function openSlots(link: LinkRow, busy: Interval[], now: Date): Date[] {
  return computeOpenSlots({
    now,
    hostTimeZone: link.host_timezone || "UTC",
    weeklyHours: normalizeWeeklyHours(link.weekly_hours),
    durationMinutes: link.duration_minutes,
    bufferBeforeMinutes: link.buffer_before_minutes,
    bufferAfterMinutes: link.buffer_after_minutes,
    horizonDays: link.date_range_days,
    minNoticeMinutes: link.min_notice_minutes,
    busy,
  });
}

function publicAvatar(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (url.startsWith("https://")) return url;
  if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) return url;
  return null;
}

/** The name and photo on the profile right now, not the copy saved with the link. */
async function hostIdentity(
  db: SupabaseClient,
  link: LinkRow,
): Promise<{ name: string; avatarUrl: string | null }> {
  const fallbackName = link.owner_display_name?.trim() || "Moduo";
  const fallbackAvatar = publicAvatar(link.owner_avatar_url);
  if (!link.owner_user_id) return { name: fallbackName, avatarUrl: fallbackAvatar };
  const profile = await db
    .from("profiles")
    .select("display_name, avatar_url")
    .eq("id", link.owner_user_id)
    .maybeSingle();
  const liveName =
    typeof profile.data?.display_name === "string" ? profile.data.display_name.trim() : "";
  return {
    name: liveName || fallbackName,
    avatarUrl: publicAvatar(profile.data?.avatar_url) || fallbackAvatar,
  };
}

function publicLink(
  link: LinkRow,
  host: { name: string; avatarUrl: string | null },
  video: VideoProvider[],
) {
  return {
    slug: link.slug,
    name: link.name,
    description: link.description,
    durationMinutes: link.duration_minutes,
    hostName: host.name,
    hostAvatarUrl: host.avatarUrl,
    hostTimeZone: link.host_timezone || "UTC",
    noteEnabled: link.note_enabled,
    guestsEnabled: link.guests_enabled === true,
    questions: Array.isArray(link.questions_json) ? link.questions_json : [],
    video: video[0] ?? null,
    videoOptions: video,
    paused: link.paused || video.length === 0,
  };
}

async function sendGuestEmail(input: {
  to: string;
  hostName: string;
  when: string;
  meetLink: string;
  platform: string;
  cancelUrl: string;
}): Promise<void> {
  if (!RESEND_API_KEY) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: input.to,
      subject: `Booked with ${input.hostName}`,
      text: [
        `You're booked with ${input.hostName}.`,
        input.when,
        `${input.platform}: ${input.meetLink}`,
        `Cancel: ${input.cancelUrl}`,
      ].join("\n"),
    }),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const action = typeof body.action === "string" ? body.action : "";
  const db = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false } });

  if (action === "cancel-preview" || action === "cancel") {
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) return json({ error: "not_found" }, 404);
    const booking = await db
      .from("slot_bookings")
      .select("*")
      .eq("cancel_token", token)
      .maybeSingle();
    if (booking.error || !booking.data) return json({ error: "not_found" }, 404);
    const row = booking.data as {
      id: string;
      status: string;
      start_at: string;
      end_at: string;
      slot_id: string;
      meeting_id: string | null;
      meeting_link: string | null;
      calendar_event_id: string | null;
      attendee_name: string;
    };
    const linkRes = await db
      .from("exposed_slot_links")
      .select("*")
      .eq("slot_id", row.slot_id)
      .maybeSingle();
    const link = (linkRes.data as LinkRow | null) ?? null;
    const host = link ? await hostIdentity(db, link) : { name: "Moduo", avatarUrl: null };
    if (action === "cancel-preview") {
      return json({
        status: row.status,
        start: row.start_at,
        end: row.end_at,
        hostName: host.name,
        name: link?.name || "Meeting",
      });
    }
    if (row.status !== "confirmed") return json({ ok: true, status: row.status });
    const access = link ? await googleAccess(db, link.owner_user_id).catch(() => null) : null;
    if (access && row.meeting_id) {
      await deleteGoogleEvent(access.accessToken, row.meeting_id).catch(() => {});
    }
    const zoomId = zoomMeetingIdFromLink(row.meeting_link);
    if (link && zoomId) {
      const zoomToken = await zoomAccess(db, link.owner_user_id, ENC).catch(() => null);
      if (zoomToken) await deleteZoomMeeting(zoomToken, zoomId).catch(() => {});
    }
    if (link?.workspace_id && row.calendar_event_id) {
      await db.rpc("booking_op_release", {
        p_workspace_id: link.workspace_id,
        p_owner_id: link.owner_user_id,
        p_event_id: row.calendar_event_id,
      });
    }
    await db
      .from("slot_bookings")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", row.id);
    return json({ ok: true, status: "cancelled" });
  }

  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const link = slug ? await loadLink(db, slug) : null;
  if (!link || !link.workspace_id) return json({ error: "not_found" }, 404);
  const host = await hostIdentity(db, link);
  const setting = videoSetting(link.video_provider);
  if (link.paused) return json({ ...publicLink(link, host, []), paused: true, slots: [] });

  const now = new Date();
  const horizonEnd = new Date(now.getTime() + Math.max(1, link.date_range_days) * 86_400_000);
  await db
    .from("slot_bookings")
    .delete()
    .eq("slot_id", link.slot_id)
    .eq("status", "pending")
    .lt("updated_at", new Date(now.getTime() - 5 * 60_000).toISOString());

  const access = await googleAccess(db, link.owner_user_id).catch(() => null);
  const zoomOn =
    setting === "google_meet" || !zoomConfigured()
      ? false
      : await zoomConnected(db, link.owner_user_id).catch(() => false);
  const video = videoOptions(setting, { google_meet: access != null, zoom: zoomOn });
  if (video.length === 0) return json({ ...publicLink(link, host, video), slots: [] });
  const busy = await busyIntervals(db, link, now, horizonEnd, access?.accessToken ?? null);
  const slots = openSlots(link, busy, now);

  if (action === "preview") {
    return json({
      ...publicLink(link, host, video),
      slots: slots.map((slot) => slot.toISOString()),
    });
  }

  if (action !== "book") return json({ error: "unknown_action" }, 400);
  const platform = pickVideo(video, body.video);
  if (!platform) return json({ error: "host_unavailable" }, 409);

  const startRaw = typeof body.start === "string" ? body.start : "";
  const start = new Date(startRaw);
  if (Number.isNaN(start.getTime())) return json({ error: "bad_slot" }, 400);
  const offered = slots.some((slot) => Math.abs(slot.getTime() - start.getTime()) < 1000);
  if (!offered) return json({ error: "slot_taken" }, 409);

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!name || !email.includes("@")) return json({ error: "bad_guest" }, 400);
  const note = link.note_enabled && typeof body.note === "string" ? body.note.trim() : "";
  const guests = link.guests_enabled
    ? parseGuestEmails(body.guests, email)
    : { ok: true as const, emails: [] as string[] };
  if (!guests.ok) return json({ error: "bad_guest" }, 400);
  const hostAddress = (access?.email || link.owner_email || "").trim().toLowerCase();
  const invitedEmails = guests.emails.filter((address) => address !== hostAddress);
  const answersIn = Array.isArray(body.answers) ? body.answers : [];
  const questions = Array.isArray(link.questions_json)
    ? (link.questions_json as { id?: string; label?: string; required?: boolean }[])
    : [];
  const answers: { id: string; label: string; value: string }[] = [];
  for (const question of questions) {
    const id = typeof question.id === "string" ? question.id : "";
    const label = typeof question.label === "string" ? question.label : "";
    const found = answersIn.find(
      (item) => item && typeof item === "object" && (item as { id?: string }).id === id,
    ) as { value?: string } | undefined;
    const value = typeof found?.value === "string" ? found.value.trim() : "";
    if (question.required && !value) return json({ error: "missing_answer", id }, 400);
    if (id && value) answers.push({ id, label, value });
  }

  const end = new Date(start.getTime() + link.duration_minutes * 60_000);
  const cancelToken = crypto.randomUUID();
  const guestZone = typeof body.timeZone === "string" ? body.timeZone : "UTC";
  const pending = await db
    .from("slot_bookings")
    .insert({
      slot_id: link.slot_id,
      slot_slug: link.slug,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      timezone: guestZone,
      attendee_name: name,
      attendee_email: email,
      attendee_notes: note || null,
      guest_emails: invitedEmails,
      status: "pending",
      answers_json: answers,
      cancel_token: cancelToken,
    })
    .select("id")
    .single();
  if (pending.error || !pending.data) {
    const taken = pending.error?.code === "23505";
    return json({ error: taken ? "slot_taken" : "book_failed" }, taken ? 409 : 500);
  }
  const bookingId = String((pending.data as { id: string }).id);

  const fail = async (error: string, status = 500) => {
    await db.from("slot_bookings").delete().eq("id", bookingId);
    return json({ error }, status);
  };

  const hostEmail = access?.email || link.owner_email || "";
  if (!hostEmail) return fail("host_unavailable", 409);
  const lines = [
    `Guest: ${name} <${email}>`,
    invitedEmails.length > 0 ? `Also invited: ${invitedEmails.join(", ")}` : "",
    note ? `Note: ${note}` : "",
    ...answers.map((answer) => `${answer.label}: ${answer.value}`),
  ].filter(Boolean);

  // Zoom first (when chosen), then the Google event that invites everyone.
  let zoom: { token: string; meetingId: string; joinUrl: string } | null = null;
  if (platform === "zoom") {
    const zoomToken = await zoomAccess(db, link.owner_user_id, ENC).catch(() => null);
    if (!zoomToken) return fail("host_unavailable", 409);
    try {
      const created = await createZoomMeeting({
        accessToken: zoomToken,
        topic: `${link.name || "Meeting"} with ${name}`,
        agenda: lines.join("\n"),
        start: start.toISOString(),
        durationMinutes: link.duration_minutes,
        timeZone: link.host_timezone || "UTC",
      });
      zoom = { token: zoomToken, ...created };
    } catch {
      return fail("zoom_failed", 502);
    }
  }

  let meet: { eventId: string | null; meetLink: string };
  if (access) {
    try {
      meet = await createGoogleMeetEvent({
        accessToken: access.accessToken,
        summary: link.name || "Meeting",
        description: lines.join("\n"),
        start: start.toISOString(),
        end: end.toISOString(),
        timeZone: link.host_timezone || "UTC",
        hostEmail,
        guestEmail: email,
        guestName: name,
        guestEmails: invitedEmails,
        requestId: bookingId,
        externalLink: zoom?.joinUrl,
      });
    } catch {
      if (!zoom) return fail("meet_failed", 502);
      // The Zoom meeting stands; the guest still gets it by email.
      meet = { eventId: null, meetLink: zoom.joinUrl };
    }
  } else if (zoom) {
    meet = { eventId: null, meetLink: zoom.joinUrl };
  } else {
    return fail("host_unavailable", 409);
  }
  const undoMeeting = async () => {
    if (access && meet.eventId) await deleteGoogleEvent(access.accessToken, meet.eventId).catch(() => {});
    if (zoom) await deleteZoomMeeting(zoom.token, zoom.meetingId).catch(() => {});
  };

  const answerHtml = answers
    .map((answer) => `<p><strong>${escapeHtml(answer.label)}</strong><br>${escapeHtml(answer.value)}</p>`)
    .join("");
  const description = [
    `<p>Booked with ${escapeHtml(name)} (${escapeHtml(email)})</p>`,
    invitedEmails.length > 0
      ? `<p>Also invited: ${invitedEmails.map((address) => escapeHtml(address)).join(", ")}</p>`
      : "",
    `<p><a href="${escapeHtml(meet.meetLink)}">Join ${VIDEO_LABEL[platform]}</a></p>`,
    note ? `<p>${escapeHtml(note)}</p>` : "",
    answerHtml,
  ].join("");

  // Saved as the Google event's own mirror row, so the next sync updates it
  // instead of adding a second copy.
  const mirror = meet.eventId && access?.email
    ? await googleMirrorAccount(db, link, access.email)
    : null;
  const committed = await db.rpc("booking_op_commit", {
    p_workspace_id: link.workspace_id,
    p_owner_id: link.owner_user_id,
    p_title: link.name || "Meeting",
    p_description: description,
    p_starts_at: start.toISOString(),
    p_ends_at: end.toISOString(),
    p_location: meet.meetLink,
    p_attendee_name: name,
    p_attendee_email: email,
    p_host_email: hostEmail,
    p_source_account_id: mirror?.id ?? null,
    p_external_event_id: mirror ? meet.eventId : null,
    p_calendar_id: mirror?.calendarId ?? null,
  });
  if (committed.error || !committed.data) {
    await undoMeeting();
    return fail("book_failed");
  }
  const ids = committed.data as { event_id?: string; contact_id?: string };

  await db
    .from("slot_bookings")
    .update({
      status: "confirmed",
      meeting_id: meet.eventId,
      meeting_link: meet.meetLink,
      calendar_event_id: ids.event_id ?? null,
      contact_id: ids.contact_id ?? null,
      calendar_synced: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId);

  const origin = typeof body.origin === "string" ? body.origin.replace(/\/$/, "") : "";
  const cancelUrl = origin ? `${origin}/book/cancel?token=${cancelToken}` : "";
  const when = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: guestZone,
  }).format(start);
  if (cancelUrl) {
    await sendGuestEmail({
      to: email,
      hostName: host.name,
      when,
      meetLink: meet.meetLink,
      platform: VIDEO_LABEL[platform],
      cancelUrl,
    }).catch(() => {});
  }

  return json({
    ok: true,
    start: start.toISOString(),
    end: end.toISOString(),
    meetLink: meet.meetLink,
    video: platform,
    guests: invitedEmails,
    cancelToken,
  });
});
