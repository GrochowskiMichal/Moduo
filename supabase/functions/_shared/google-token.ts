/**
 * A usable Google access token for one stored `user_integrations` row
 * (provider google_calendar), refreshing it when it is missing or about to
 * expire. booking-public and calendar-google-web both read Google through it.
 *
 * A host can connect several Google accounts (one row per account_key), so a
 * refreshed token is written back to that row by its id, never by user and
 * provider: that would overwrite every other account's tokens with this one's.
 */

import { refreshGoogleAccess } from "./google-calendar.ts";
import { decryptToken, encryptToken } from "./token-cipher.ts";

export type GoogleClient = { id: string; secret: string };

/** The stored token columns of one user_integrations row. */
export type GoogleTokenRow = {
  id: string;
  refresh_token_enc: string | null;
  access_token_enc: string | null;
  token_expiry: string | null;
};

/** The part of a Supabase client this writes through (service role). */
export type GoogleTokenDb = {
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): PromiseLike<unknown>;
    };
  };
};

export type GoogleTokenDeps = {
  db: GoogleTokenDb;
  /** MODUO_TOKEN_ENCRYPTION_SECRET. */
  encSecret: string;
  /** The OAuth clients a refresh token may be bound to, tried in order. */
  clients: GoogleClient[];
  /** Overridable for tests. */
  refresh?: typeof refreshGoogleAccess;
  now?: () => number;
};

/**
 * Google OAuth clients from env, dropping any without both id and secret.
 * A refresh token only works with the client that issued it: the Desktop client
 * (desktop Connect uploads its token) first, then the Web client (booking-google-connect).
 */
export function googleClients(env: (name: string) => string | undefined): GoogleClient[] {
  return [
    { id: env("GOOGLE_CALENDAR_CLIENT_ID") ?? "", secret: env("GOOGLE_CALENDAR_CLIENT_SECRET") ?? "" },
    { id: env("GOOGLE_CALENDAR_WEB_CLIENT_ID") ?? "", secret: env("GOOGLE_CALENDAR_WEB_CLIENT_SECRET") ?? "" },
  ].filter((client) => client.id.length > 0 && client.secret.length > 0);
}

/** The row's access token, refreshed and saved to that row when needed; null when it can't get one. */
export async function googleAccessForRow(
  deps: GoogleTokenDeps,
  userId: string,
  row: GoogleTokenRow,
): Promise<string | null> {
  const { db, encSecret, clients } = deps;
  if (!encSecret || !row.refresh_token_enc || clients.length === 0) return null;
  let refresh: string;
  try {
    refresh = await decryptToken(row.refresh_token_enc, encSecret, userId);
  } catch {
    return null;
  }
  const now = deps.now?.() ?? Date.now();
  const expiry = row.token_expiry ? Date.parse(row.token_expiry) : 0;
  if (expiry > now + 60_000 && row.access_token_enc) {
    try {
      return await decryptToken(row.access_token_enc, encSecret, userId);
    } catch {
      // fall through to a refresh
    }
  }
  const doRefresh = deps.refresh ?? refreshGoogleAccess;
  let fresh: { accessToken: string; expiresAt: string; refreshToken: string } | null = null;
  for (const client of clients) {
    try {
      fresh = await doRefresh({ clientId: client.id, clientSecret: client.secret, refreshToken: refresh });
      break;
    } catch {
      fresh = null;
    }
  }
  if (!fresh) return null;
  const accessEnc = await encryptToken(fresh.accessToken, encSecret, userId);
  const refreshOut =
    fresh.refreshToken === refresh ? row.refresh_token_enc : await encryptToken(fresh.refreshToken, encSecret, userId);
  const saved = (await db
    .from("user_integrations")
    .update({
      access_token_enc: accessEnc,
      refresh_token_enc: refreshOut,
      token_expiry: fresh.expiresAt,
      updated_at: new Date(now).toISOString(),
    })
    .eq("id", row.id)) as { error?: { message?: string } | null } | null;
  // The token still works for this call; a lost rotated refresh token would
  // need a reconnect, so say so.
  if (saved?.error) console.error("[google-token] refreshed token not saved:", row.id, saved.error.message);
  return fresh.accessToken;
}
