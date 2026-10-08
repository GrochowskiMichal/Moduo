// Zoom calls for a host's stored Zoom login. One OAuth app (user-managed,
// ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET) issues every token. Zoom rotates the
// refresh token on every refresh, so the caller must save the new one.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import { decryptToken, encryptToken } from "./token-cipher.ts";

export type ZoomTokens = { accessToken: string; refreshToken: string; expiresAt: string };

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  reason?: string;
  error?: string;
};

function basic(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

async function tokenRequest(
  clientId: string,
  clientSecret: string,
  params: Record<string, string>,
): Promise<ZoomTokens> {
  const res = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      authorization: basic(clientId, clientSecret),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token || !json.refresh_token) {
    throw new Error(json.reason || json.error || "zoom_token_failed");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + Math.max(60, json.expires_in ?? 3600) * 1000).toISOString(),
  };
}

export function exchangeZoomCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  /** PKCE verifier, when the consent URL carried a code_challenge. */
  codeVerifier?: string;
}): Promise<ZoomTokens> {
  return tokenRequest(input.clientId, input.clientSecret, {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
  });
}

export function refreshZoomAccess(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<ZoomTokens> {
  return tokenRequest(input.clientId, input.clientSecret, {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
}

export async function zoomUserEmail(accessToken: string): Promise<string | null> {
  const res = await fetch("https://api.zoom.us/v2/users/me", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => ({}))) as { email?: string };
  return typeof json.email === "string" ? json.email.toLowerCase() : null;
}

export async function createZoomMeeting(input: {
  accessToken: string;
  topic: string;
  agenda: string;
  start: string;
  durationMinutes: number;
  timeZone: string;
}): Promise<{ meetingId: string; joinUrl: string }> {
  const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      topic: input.topic.slice(0, 200),
      agenda: input.agenda.slice(0, 2000),
      type: 2,
      start_time: input.start.replace(/\.\d{3}Z$/, "Z"),
      duration: input.durationMinutes,
      timezone: input.timeZone,
      settings: { join_before_host: true, waiting_room: false },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    id?: number | string;
    join_url?: string;
    message?: string;
  };
  if (!res.ok || !json.id || !json.join_url) throw new Error(json.message || "zoom_meeting_failed");
  return { meetingId: String(json.id), joinUrl: json.join_url };
}

export async function deleteZoomMeeting(accessToken: string, meetingId: string): Promise<void> {
  await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

/** `https://us05web.zoom.us/j/81234567890?pwd=…` → `81234567890`. */
export function zoomMeetingIdFromLink(link: string | null | undefined): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    if (!/(^|\.)zoom\.us$/.test(url.hostname)) return null;
    return url.pathname.match(/\/j\/(\d+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function zoomConfigured(): { clientId: string; clientSecret: string } | null {
  const clientId = Deno.env.get("ZOOM_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("ZOOM_CLIENT_SECRET") ?? "";
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Whether a Zoom login is stored for this user. Cheap: no network. */
export async function zoomConnected(db: SupabaseClient, userId: string): Promise<boolean> {
  const row = await db
    .from("user_integrations")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", "zoom")
    .not("refresh_token_enc", "is", null)
    .limit(1)
    .maybeSingle();
  return Boolean(row.data);
}

/** A working access token for the host's Zoom login, refreshing and saving as needed. */
export async function zoomAccess(
  db: SupabaseClient,
  userId: string,
  encSecret: string,
): Promise<string | null> {
  const app = zoomConfigured();
  if (!app || !encSecret) return null;
  const row = await db
    .from("user_integrations")
    .select("id, refresh_token_enc, access_token_enc, token_expiry")
    .eq("user_id", userId)
    .eq("provider", "zoom")
    .not("refresh_token_enc", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row.data?.refresh_token_enc) return null;
  const expiry = row.data.token_expiry ? Date.parse(String(row.data.token_expiry)) : 0;
  if (expiry > Date.now() + 60_000 && row.data.access_token_enc) {
    try {
      return await decryptToken(String(row.data.access_token_enc), encSecret, userId);
    } catch {
      // fall through to a refresh
    }
  }
  let refresh: string;
  try {
    refresh = await decryptToken(String(row.data.refresh_token_enc), encSecret, userId);
  } catch {
    return null;
  }
  let fresh: ZoomTokens;
  try {
    fresh = await refreshZoomAccess({ ...app, refreshToken: refresh });
  } catch {
    return null;
  }
  await db
    .from("user_integrations")
    .update({
      access_token_enc: await encryptToken(fresh.accessToken, encSecret, userId),
      refresh_token_enc: await encryptToken(fresh.refreshToken, encSecret, userId),
      token_expiry: fresh.expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.data.id);
  return fresh.accessToken;
}
