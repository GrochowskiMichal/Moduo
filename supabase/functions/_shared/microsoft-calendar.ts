/**
 * Outlook Calendar through Microsoft Graph, for calendar-microsoft-web: the
 * sign-in endpoints, token exchange and refresh, and the read calls. View only,
 * like the desktop app (Calendars.Read). Pure (fetch only, no esm.sh imports)
 * so Node tests can import it.
 *
 * The Web platform client of the Entra app registration that the desktop app
 * uses as a public client: one app, two platforms. `common` takes work and
 * personal Microsoft accounts.
 */

import { decryptToken, encryptToken } from "./token-cipher.ts";

export const MICROSOFT_AUTHORIZE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
export const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
export const MICROSOFT_SCOPES = "openid email profile offline_access User.Read Calendars.Read";

const GRAPH = "https://graph.microsoft.com/v1.0";

/** What the app's mapper reads (mapOutlookEvent, graphConferenceUrl): no full HTML bodies. */
const EVENT_FIELDS = "id,subject,start,end,isAllDay,isCancelled,bodyPreview,location,recurrence,onlineMeeting";

/** The next page, only on Graph itself: the bearer token never goes anywhere else. */
function nextPage(page: Record<string, unknown>): string | null {
  const link = page["@odata.nextLink"];
  return typeof link === "string" && link.startsWith(`${GRAPH}/`) ? link : null;
}

export type MicrosoftClient = { id: string; secret: string };

export type MicrosoftTokens = { accessToken: string; refreshToken: string | null; expiresAt: string };

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
};

async function tokenRequest(body: URLSearchParams, fallback: string): Promise<MicrosoftTokens> {
  const res = await fetch(MICROSOFT_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token) throw new Error(json.error || fallback);
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString(),
  };
}

export async function exchangeMicrosoftCode(input: {
  client: MicrosoftClient;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<MicrosoftTokens> {
  return await tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      client_id: input.client.id,
      client_secret: input.client.secret,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
      scope: MICROSOFT_SCOPES,
    }),
    "microsoft_exchange_failed",
  );
}

/** A fresh access token; Microsoft rotates the refresh token, so keep the one it returns. Throws `invalid_grant` when revoked. */
export async function refreshMicrosoftAccess(input: {
  client: MicrosoftClient;
  refreshToken: string;
}): Promise<MicrosoftTokens> {
  return await tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      client_id: input.client.id,
      client_secret: input.client.secret,
      scope: MICROSOFT_SCOPES,
    }),
    "microsoft_refresh_failed",
  );
}

async function graphGet(url: string, accessToken: string, fallback: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, prefer: 'outlook.timezone="UTC"' },
  });
  if (!res.ok) throw new Error(`${fallback}:${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** The login's address, lowercased: `mail`, else the user principal name (personal accounts often have no `mail`). */
export async function microsoftUserEmail(accessToken: string): Promise<string | null> {
  const me = await graphGet(`${GRAPH}/me?$select=mail,userPrincipalName`, accessToken, "microsoft_me_failed");
  const mail = typeof me.mail === "string" && me.mail.trim() ? me.mail : me.userPrincipalName;
  return typeof mail === "string" && mail.trim() ? mail.trim().toLowerCase() : null;
}

export type MicrosoftCalendarInfo = { id: string; name: string };

export async function listMicrosoftCalendars(accessToken: string): Promise<MicrosoftCalendarInfo[]> {
  const out: MicrosoftCalendarInfo[] = [];
  let next: string | null = `${GRAPH}/me/calendars?$select=id,name`;
  while (next) {
    const page = await graphGet(next, accessToken, "microsoft_calendars_failed");
    for (const item of Array.isArray(page.value) ? page.value : []) {
      const cal = item as Record<string, unknown>;
      if (typeof cal.id === "string" && cal.id) {
        out.push({ id: cal.id, name: typeof cal.name === "string" ? cal.name : "" });
      }
    }
    next = nextPage(page);
  }
  return out;
}

/** One calendar's events in the window (recurring ones expanded), every page. Times come in UTC. */
export async function listMicrosoftEvents(input: {
  accessToken: string;
  calendarId: string;
  timeMin: string;
  timeMax: string;
}): Promise<Record<string, unknown>[]> {
  const first = new URL(`${GRAPH}/me/calendars/${encodeURIComponent(input.calendarId)}/calendarView`);
  first.searchParams.set("startDateTime", input.timeMin);
  first.searchParams.set("endDateTime", input.timeMax);
  first.searchParams.set("$top", "250");
  first.searchParams.set("$select", EVENT_FIELDS);
  const out: Record<string, unknown>[] = [];
  let next: string | null = first.toString();
  while (next) {
    const page = await graphGet(next, input.accessToken, "microsoft_events_failed");
    for (const item of Array.isArray(page.value) ? page.value : []) {
      if (item && typeof item === "object") out.push(item as Record<string, unknown>);
    }
    next = nextPage(page);
  }
  return out;
}

/** The stored token columns of one user_integrations row (provider microsoft_calendar). */
export type MicrosoftTokenRow = {
  id: string;
  refresh_token_enc: string | null;
  access_token_enc: string | null;
  token_expiry: string | null;
};

/** The part of a Supabase client a refresh writes through (service role). */
export type MicrosoftTokenDb = {
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): PromiseLike<unknown>;
    };
  };
};

export type MicrosoftAccessOutcome =
  | { kind: "ok"; accessToken: string }
  | { kind: "revoked" }
  | { kind: "unavailable" };

export type MicrosoftTokenDeps = {
  db: MicrosoftTokenDb;
  /** MODUO_TOKEN_ENCRYPTION_SECRET. */
  encSecret: string;
  client: MicrosoftClient;
  /** Overridable for tests. */
  refresh?: typeof refreshMicrosoftAccess;
  now?: () => number;
};

/** The stored access token while it has over a minute left; null otherwise. */
async function storedAccess(deps: MicrosoftTokenDeps, userId: string, row: MicrosoftTokenRow, now: number) {
  const expiry = row.token_expiry ? Date.parse(row.token_expiry) : 0;
  if (expiry <= now + 60_000 || !row.access_token_enc) return null;
  try {
    return await decryptToken(row.access_token_enc, deps.encSecret, userId);
  } catch {
    return null;
  }
}

/** Save a refresh's tokens to that row (by id: a person can connect several Microsoft logins). */
async function saveFresh(
  deps: MicrosoftTokenDeps,
  userId: string,
  row: MicrosoftTokenRow,
  oldRefresh: string,
  fresh: MicrosoftTokens,
  now: number,
): Promise<void> {
  const rotated = fresh.refreshToken !== null && fresh.refreshToken !== oldRefresh;
  const saved = (await deps.db
    .from("user_integrations")
    .update({
      access_token_enc: await encryptToken(fresh.accessToken, deps.encSecret, userId),
      refresh_token_enc: rotated
        ? await encryptToken(fresh.refreshToken as string, deps.encSecret, userId)
        : row.refresh_token_enc,
      token_expiry: fresh.expiresAt,
      updated_at: new Date(now).toISOString(),
    })
    .eq("id", row.id)) as { error?: { message?: string } | null } | null;
  // The token still works for this call; a lost rotated refresh token means a reconnect later.
  if (saved?.error) console.error("[microsoft-token] refreshed token not saved:", row.id, saved.error.message);
}

/**
 * The row's access token, refreshed and saved back to that row when it has
 * under a minute left. "revoked" when Microsoft answers invalid_grant
 * (reconnect), "unavailable" otherwise.
 */
export async function microsoftAccessOutcome(
  deps: MicrosoftTokenDeps,
  userId: string,
  row: MicrosoftTokenRow,
): Promise<MicrosoftAccessOutcome> {
  const unavailable = { kind: "unavailable" } as const;
  if (!deps.encSecret || !row.refresh_token_enc || !deps.client.id) return unavailable;
  const now = deps.now?.() ?? Date.now();
  const stored = await storedAccess(deps, userId, row, now);
  if (stored) return { kind: "ok", accessToken: stored };
  let refresh: string;
  try {
    refresh = await decryptToken(row.refresh_token_enc, deps.encSecret, userId);
  } catch {
    return unavailable;
  }
  let fresh: MicrosoftTokens;
  try {
    fresh = await (deps.refresh ?? refreshMicrosoftAccess)({ client: deps.client, refreshToken: refresh });
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err);
    if (code === "invalid_grant") return { kind: "revoked" };
    // invalid_client here usually means MICROSOFT_CALENDAR_WEB_CLIENT_SECRET expired: renew it in Entra.
    console.error("[microsoft-token] refresh failed:", row.id, code);
    return unavailable;
  }
  await saveFresh(deps, userId, row, refresh, fresh, now);
  return { kind: "ok", accessToken: fresh.accessToken };
}

/** `outlook:<email>` (the app's account id) → the email, lowercased; null for anything else. */
export function outlookAccountEmail(externalAccountId: unknown): string | null {
  if (typeof externalAccountId !== "string" || !externalAccountId.startsWith("outlook:")) return null;
  const email = externalAccountId.slice("outlook:".length).trim().toLowerCase();
  return email && !email.includes(":") ? email : null;
}
