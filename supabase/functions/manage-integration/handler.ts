/**
 * manage-integration (MOD-554): the desktop app stores the person's own Google
 * Calendar tokens on `user_integrations`, so booking links can create events
 * and Meet links while the app is closed. Zoom and Meet connect through booking
 * links on every platform, so the function takes no other provider and has no
 * disconnect (EB-1); a Google login disconnects per login through
 * `calendar-google-web` (action "disconnect").
 *
 * Who: the person's Supabase session (Authorization: Bearer), verified with
 * getUser(); the user is the token's, never one named in the request. An app
 * token is refused like everywhere else (app-token.ts).
 *
 * What: the desktop sends the tokens in plaintext over TLS; this function
 * encrypts them with MODUO_TOKEN_ENCRYPTION_SECRET, which therefore never
 * ships in a desktop build. (It used to be the endpoint's bearer secret too,
 * with the user_id taken from the body: anyone holding it could write or
 * delete any person's integration.)
 *
 * POST { provider: "google_calendar", access_token, refresh_token?, expires_at? } → { success }
 */

import { APP_TOKEN_REFUSAL, type UserVerifier, verifiedPerson } from "../_shared/app-token.ts";
import { manageIntegrationBodySchema, parseJsonBody } from "../_shared/contracts/http-bodies.ts";
import { encryptToken } from "../_shared/token-cipher.ts";

type DbResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

/** The slice of a service-role client this handler uses. */
export interface IntegrationsDb {
  findId(userId: string, provider: string, accountKey: string): DbResult<{ id: string }>;
  insert(row: IntegrationRow): DbResult<unknown>;
  update(id: string, row: IntegrationRow): DbResult<unknown>;
}

export interface IntegrationRow {
  user_id: string;
  provider: string;
  account_key: string;
  access_token_enc: string;
  refresh_token_enc: string | null;
  token_expiry: string | null;
  updated_at: string;
}

export interface ManageIntegrationDeps {
  auth: UserVerifier<{ id: string }>;
  db: IntegrationsDb;
  encryptionSecret: string;
  /** The Google login's email for a Google Calendar token (its account_key). */
  googleEmail(accessToken: string): Promise<string | null>;
  now?: () => Date;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleManageIntegration(
  req: Request,
  deps: ManageIntegrationDeps,
): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }
  const caller = await verifiedPerson(deps.auth, req.headers.get("Authorization"));
  if (caller.kind === "app") return json(APP_TOKEN_REFUSAL, 403);
  if (caller.kind !== "person") return json({ error: "unauthorized" }, 401);
  return save(req, caller.user.id, deps);
}

async function readBody(req: Request) {
  try {
    return parseJsonBody(manageIntegrationBodySchema, await req.json());
  } catch {
    return null;
  }
}

async function save(req: Request, uid: string, deps: ManageIntegrationDeps): Promise<Response> {
  if (!deps.encryptionSecret) return json({ error: "not_configured" }, 503);
  const parsed = await readBody(req);
  if (!parsed) return json({ error: "invalid json" }, 400);
  if (!parsed.success) return json({ error: "invalid body", details: parsed.errors }, 400);
  const body = parsed.data;

  // One row per Google login (account_key = its email, as booking-google-connect
  // stores it). The email comes from Google, not from the request. No email, no
  // save: an unkeyed row would sit beside the login's keyed one.
  const accountKey = ((await deps.googleEmail(body.access_token)) ?? "").trim().toLowerCase();
  if (!accountKey) return json({ error: "google_email_unknown" }, 502);
  const row = await encryptedRow(uid, body, accountKey, deps);

  let existing = await deps.db.findId(uid, body.provider, accountKey);
  // A Google row saved before account keys existed has an empty key: adopt it.
  if (!existing.data && !existing.error) {
    existing = await deps.db.findId(uid, body.provider, "");
  }
  const saved = existing.error
    ? existing
    : existing.data?.id
      ? await deps.db.update(existing.data.id, row)
      : await deps.db.insert(row);
  if (saved.error) {
    console.error(`[manage-integration] ${body.provider} save failed:`, saved.error.message);
    return json({ error: "save_failed" }, 500);
  }
  return json({ success: true });
}

async function encryptedRow(
  uid: string,
  body: { provider: string; access_token: string; refresh_token?: string | null; expires_at?: number | null },
  accountKey: string,
  deps: ManageIntegrationDeps,
): Promise<IntegrationRow> {
  const secret = deps.encryptionSecret;
  return {
    user_id: uid,
    provider: body.provider,
    account_key: accountKey,
    access_token_enc: await encryptToken(body.access_token, secret, uid),
    refresh_token_enc: body.refresh_token ? await encryptToken(body.refresh_token, secret, uid) : null,
    token_expiry: body.expires_at ? new Date(body.expires_at * 1000).toISOString() : null,
    updated_at: (deps.now?.() ?? new Date()).toISOString(),
  };
}
