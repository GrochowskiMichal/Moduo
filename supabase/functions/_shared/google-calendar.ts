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
}): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
  });
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

export type GoogleCalendarInfo = { id: string; summary: string; primary: boolean };

export async function listGoogleCalendars(accessToken: string): Promise<GoogleCalendarInfo[]> {
  const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("google_calendars_failed");
  const json = (await res.json()) as {
    items?: { id?: string; summary?: string; primary?: boolean }[];
  };
  return (json.items ?? [])
    .filter((item) => typeof item.id === "string" && item.id.length > 0)
    .map((item) => ({
      id: item.id as string,
      summary: item.summary?.trim() || (item.id as string),
      primary: Boolean(item.primary),
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
}): Promise<Record<string, unknown>> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`;
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
    }),
  });
  const json = (await res.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok || typeof json.id !== "string") {
    throw new Error(json.error?.message || "google_event_failed");
  }
  return json;
}

export async function deleteGoogleEvent(accessToken: string, eventId: string): Promise<void> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`;
  await fetch(url, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } });
}
