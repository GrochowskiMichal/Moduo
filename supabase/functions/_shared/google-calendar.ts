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
  requestId: string;
}): Promise<{ eventId: string; meetLink: string }> {
  const url =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all";
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
      ],
      conferenceData: {
        createRequest: {
          requestId: input.requestId,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
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
    json.hangoutLink ||
    json.conferenceData?.entryPoints?.find((point) => point.entryPointType === "video")?.uri ||
    "";
  if (!meet) throw new Error("google_meet_missing");
  return { eventId: json.id, meetLink: meet };
}

export async function deleteGoogleEvent(accessToken: string, eventId: string): Promise<void> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`;
  await fetch(url, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } });
}
