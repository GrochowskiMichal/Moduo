// Google Calendar calls for a stored refresh token. Client id/secret must be the
// same OAuth client the desktop app used (MODUO_CALENDAR_GOOGLE_CLIENT_ID),
// because refresh tokens are bound to that client.

export type GoogleAuth = { accessToken: string; refreshToken: string; expiresAt: string | null };

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
};

export async function refreshGoogleAccess(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{ accessToken: string; expiresAt: string; refreshToken: string }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as TokenResponse & { error?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error || "google_refresh_failed");
  }
  const expiresAt = new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString();
  return {
    accessToken: json.access_token,
    expiresAt,
    refreshToken: json.refresh_token || input.refreshToken,
  };
}

export async function exchangeGoogleCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  /** PKCE verifier, when the consent URL carried a code_challenge. */
  codeVerifier?: string;
}): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
  });
  if (input.codeVerifier) body.set("code_verifier", input.codeVerifier);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as TokenResponse & { error?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error || "google_exchange_failed");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString(),
  };
}

export async function googleFreeBusy(
  accessToken: string,
  timeMin: string,
  timeMax: string,
): Promise<{ start: string; end: string }[]> {
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: [{ id: "primary" }],
    }),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    calendars?: { primary?: { busy?: { start: string; end: string }[] } };
  };
  return json.calendars?.primary?.busy ?? [];
}

export async function googleUserEmail(accessToken: string): Promise<string | null> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { email?: string };
  return json.email?.trim() || null;
}

export async function createGoogleMeetEvent(input: {
  accessToken: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  timeZone: string;
  hostEmail: string;
  guestEmail: string;
  guestName: string;
  guestEmails?: string[];
  requestId: string;
  /** A meeting made elsewhere (Zoom). The event points at it instead of adding a Meet. */
  externalLink?: string;
}): Promise<{ eventId: string; meetLink: string }> {
  const url = input.externalLink
    ? "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all"
    : "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.start, timeZone: input.timeZone },
      end: { dateTime: input.end, timeZone: input.timeZone },
      attendees: [
        { email: input.hostEmail, responseStatus: "accepted" },
        { email: input.guestEmail, displayName: input.guestName },
        ...(input.guestEmails ?? [])
          .map((email) => email.trim().toLowerCase())
          .filter(
            (email) =>
              email.length > 0 &&
              email !== input.hostEmail.trim().toLowerCase() &&
              email !== input.guestEmail.trim().toLowerCase(),
          )
          .map((email) => ({ email })),
      ],
      ...(input.externalLink
        ? { location: input.externalLink }
        : {
            conferenceData: {
              createRequest: {
                requestId: input.requestId,
                conferenceSolutionKey: { type: "hangoutsMeet" },
              },
            },
          }),
    }),
  });
  const json = (await res.json()) as {
    id?: string;
    hangoutLink?: string;
    error?: { message?: string };
    conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  };
  if (!res.ok || !json.id) {
    throw new Error(json.error?.message || "google_event_failed");
  }
  const meet =
    input.externalLink ||
    json.hangoutLink ||
    json.conferenceData?.entryPoints?.find((point) => point.entryPointType === "video")?.uri ||
    "";
  if (!meet) throw new Error("google_meet_missing");
  return { eventId: json.id, meetLink: meet };
}

/** accessRole is Google's (owner · writer · reader · freeBusyReader); '' when absent. */
export type GoogleCalendarInfo = { id: string; summary: string; primary: boolean; accessRole: string };

export async function listGoogleCalendars(accessToken: string): Promise<GoogleCalendarInfo[]> {
  const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("google_calendars_failed");
  const json = (await res.json()) as {
    items?: { id?: string; summary?: string; primary?: boolean; accessRole?: string }[];
  };
  return (json.items ?? [])
    .filter((item) => typeof item.id === "string" && item.id.length > 0)
    .map((item) => ({
      id: item.id as string,
      summary: item.summary?.trim() || (item.id as string),
      primary: Boolean(item.primary),
      accessRole: item.accessRole ?? "",
    }));
}

export async function listGoogleEvents(input: {
  accessToken: string;
  calendarId: string;
  timeMin: string;
  timeMax: string;
}): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];
  let pageToken = "";
  for (let page = 0; page < 20; page++) {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`,
    );
    url.searchParams.set("timeMin", input.timeMin);
    url.searchParams.set("timeMax", input.timeMax);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("showDeleted", "false");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { authorization: `Bearer ${input.accessToken}` } });
    if (!res.ok) throw new Error("google_events_failed");
    const json = (await res.json()) as { items?: Record<string, unknown>[]; nextPageToken?: string };
    events.push(...(json.items ?? []));
    pageToken = json.nextPageToken ?? "";
    if (!pageToken) break;
  }
  return events;
}

export async function insertGoogleEvent(input: {
  accessToken: string;
  calendarId: string;
  summary: string;
  description: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  recurrence?: string[];
  location?: string;
  attendees?: { email: string; displayName?: string }[];
  visibility?: "private" | "default";
  conferenceData?: Record<string, unknown>;
  sendUpdates?: "all" | "none";
}): Promise<Record<string, unknown>> {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`,
  );
  if (input.conferenceData) url.searchParams.set("conferenceDataVersion", "1");
  if (input.sendUpdates) url.searchParams.set("sendUpdates", input.sendUpdates);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      start: input.start,
      end: input.end,
      recurrence: input.recurrence,
      location: input.location,
      attendees: input.attendees,
      visibility: input.visibility,
      conferenceData: input.conferenceData,
    }),
  });
  const json = (await res.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok || typeof json.id !== "string") {
    throw new Error(json.error?.message || "google_event_failed");
  }
  return json;
}

/** Deletes the event and has Google tell its guests. True when the event is gone (404/410: already gone). */
export async function deleteGoogleEvent(
  accessToken: string,
  eventId: string,
  calendarId = "primary",
): Promise<boolean> {
  const res = await fetch(eventUrl(calendarId, eventId, { sendUpdates: "all" }), {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return res.ok || res.status === 404 || res.status === 410;
}

// ── CALR-8: Google two-way ───────────────────────────────────────────────────

/** Google said no (no writer access, a bad field, …). `message` is Google's reason. */
export class GoogleRefusal extends Error {
  status: number;
  constructor(status: number, message?: string | null) {
    super(message || "Google refused the change.");
    this.name = "GoogleRefusal";
    this.status = status;
  }
}

async function refusal(res: Response): Promise<GoogleRefusal> {
  let message: string | null = null;
  try {
    const json = (await res.json()) as { error?: { message?: unknown } };
    message = typeof json?.error?.message === "string" ? json.error.message : null;
  } catch {
    message = null;
  }
  return new GoogleRefusal(res.status, message);
}

function eventUrl(calendarId: string, eventId: string, params: Record<string, string>): URL {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  );
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

/** The YYYY-MM-DD an instant falls on in `timeZone` (an all-day event's Google date). */
export function ymdInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/**
 * The Google calendar id inside a mirrored event's calendar id
 * (`google:<email>:<calendarId>`; the email has no colon), else "primary".
 */
export function googleCalendarTarget(calendarId: string | null | undefined): string {
  if (!calendarId || !calendarId.startsWith("google:")) return "primary";
  const rest = calendarId.slice("google:".length);
  const colon = rest.indexOf(":");
  const target = colon < 0 ? "" : rest.slice(colon + 1);
  return target || "primary";
}

/** What the app changed on a Google event. Only present keys are sent. */
export type GoogleEventPatch = {
  title?: string;
  description?: string;
  location?: string | null;
  startsAt?: string;
  endsAt?: string;
  allDay?: boolean;
  attendees?: { email: string; name?: string }[];
  isPrivate?: boolean;
  meet?: "add" | "remove";
};

/** The Google events.patch body for a patch: only what changed. */
/** The calendar day after a YYYY-MM-DD date. */
function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Start and end for Google, sent together or not at all. */
function timesBody(patch: GoogleEventPatch, timeZone: string): Record<string, unknown> {
  if (patch.startsAt === undefined || patch.endsAt === undefined) return {};
  if (!patch.allDay) {
    return {
      start: { dateTime: patch.startsAt, timeZone },
      end: { dateTime: patch.endsAt, timeZone },
    };
  }
  // Google's all-day end date is exclusive: a range that ends on its start
  // day (a 9–10 meeting switched to all day) covers that one day.
  const start = ymdInZone(patch.startsAt, timeZone);
  const end = ymdInZone(patch.endsAt, timeZone);
  return { start: { date: start }, end: { date: end <= start ? nextDay(start) : end } };
}

export function googleEventBody(
  patch: GoogleEventPatch,
  options: { timeZone: string; requestId?: string },
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.summary = patch.title;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.location !== undefined) body.location = patch.location ?? "";
  Object.assign(body, timesBody(patch, options.timeZone));
  if (patch.attendees !== undefined) {
    body.attendees = patch.attendees.map((person) =>
      person.name ? { email: person.email, displayName: person.name } : { email: person.email },
    );
  }
  if (patch.isPrivate !== undefined) body.visibility = patch.isPrivate ? "private" : "default";
  if (patch.meet === "add") {
    body.conferenceData = {
      createRequest: {
        requestId: options.requestId ?? crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  } else if (patch.meet === "remove") {
    body.conferenceData = null;
  }
  return body;
}

/** Guests hear about changes they'd notice; a privacy flip (or nothing) stays quiet. */
export function googleSendUpdates(patch: Record<string, unknown>): "all" | "none" {
  const keys = Object.keys(patch).filter((key) => patch[key] !== undefined);
  return keys.every((key) => key === "isPrivate") ? "none" : "all";
}

/** events.patch on the event's own calendar. Returns Google's event; throws GoogleRefusal. */
export async function patchGoogleEvent(input: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  body: Record<string, unknown>;
  sendUpdates: "all" | "none";
}): Promise<Record<string, unknown>> {
  const url = eventUrl(input.calendarId, input.eventId, {
    conferenceDataVersion: "1",
    sendUpdates: input.sendUpdates,
  });
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input.body),
  });
  if (!res.ok) throw await refusal(res);
  return (await res.json()) as Record<string, unknown>;
}

/** events.delete on the event's own calendar. Already gone (404/410) counts as deleted. */
export async function removeGoogleEvent(input: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  sendUpdates: "all" | "none";
}): Promise<void> {
  const res = await fetch(eventUrl(input.calendarId, input.eventId, { sendUpdates: input.sendUpdates }), {
    method: "DELETE",
    headers: { authorization: `Bearer ${input.accessToken}` },
  });
  if (res.ok || res.status === 404 || res.status === 410) return;
  throw await refusal(res);
}
