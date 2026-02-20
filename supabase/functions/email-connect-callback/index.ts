import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import { decodeJwt, importPKCS8, SignJWT } from "https://esm.sh/jose@5.9.6";
import { requireUser, requireWorkspaceMember } from "../_shared/auth.ts";
import { badRequest, ok, optionsResponse } from "../_shared/http.ts";
import { encryptSecret } from "../_shared/security.ts";

type UserContext = {
  userId: string;
  supabaseAdmin: ReturnType<typeof createClient>;
};

function htmlBridge(payload: Record<string, unknown>): Response {
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html>
  <body style="font-family: sans-serif; padding: 24px; background: #111; color: #eee;">
    <p>Completing OAuth...</p>
    <script>
      const payload = ${json};
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, "*");
        }
      } catch (e) {}
      setTimeout(() => window.close(), 200);
    </script>
  </body>
</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function createAppleClientSecret(): Promise<string> {
  const teamId = Deno.env.get("APPLE_TEAM_ID");
  const keyId = Deno.env.get("APPLE_KEY_ID");
  const clientId = Deno.env.get("EMAIL_APPLE_CLIENT_ID");
  const privateKeyRaw = Deno.env.get("APPLE_PRIVATE_KEY");

  if (!teamId || !keyId || !clientId || !privateKeyRaw) {
    throw new Error("Missing APPLE_TEAM_ID/APPLE_KEY_ID/APPLE_PRIVATE_KEY/EMAIL_APPLE_CLIENT_ID");
  }

  const normalizePem = (raw: string): string => {
    const unquoted = raw.trim().replace(/^['"]|['"]$/g, "");
    const withNewlines = unquoted.replace(/\\n/g, "\n").trim();
    if (withNewlines.includes("BEGIN PRIVATE KEY")) return withNewlines;

    // Accept base64-only key payloads without PEM wrappers.
    const compact = withNewlines.replace(/\s+/g, "");
    const base64Like = /^[A-Za-z0-9+/=]+$/.test(compact) && compact.length > 128;
    if (base64Like) {
      const lines = compact.match(/.{1,64}/g)?.join("\n") ?? compact;
      return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
    }

    return withNewlines;
  };

  const privateKey = normalizePem(privateKeyRaw);
  const cryptoKey = await importPKCS8(privateKey, "ES256");
  const now = Math.floor(Date.now() / 1000);

  return await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setSubject(clientId)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt(now)
    .setExpirationTime(now + 60 * 60)
    .sign(cryptoKey);
}

async function exchangeAppleCode(authorizationCode: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  email: string | null;
  idToken?: string;
}> {
  const clientId = Deno.env.get("EMAIL_APPLE_CLIENT_ID");
  const redirectUri = Deno.env.get("EMAIL_OAUTH_REDIRECT_URI");
  if (!clientId || !redirectUri) throw new Error("Missing EMAIL_APPLE_CLIENT_ID or EMAIL_OAUTH_REDIRECT_URI");

  const clientSecret = await createAppleClientSecret();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: authorizationCode,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  const response = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    throw new Error(`Apple token exchange failed: ${payload?.error ?? response.status}`);
  }

  const expiresIn = Number(payload.expires_in ?? 0);
  const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

  let email: string | null = null;
  if (typeof payload.id_token === "string") {
    try {
      const decoded = decodeJwt(payload.id_token);
      email = typeof decoded.email === "string" ? decoded.email.toLowerCase() : null;
    } catch {
      email = null;
    }
  }

  return {
    accessToken: String(payload.access_token),
    refreshToken: payload.refresh_token ? String(payload.refresh_token) : null,
    expiresAt,
    email,
    idToken: typeof payload.id_token === "string" ? payload.id_token : undefined,
  };
}

function decodeEmailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const decoded = decodeJwt(idToken);
    return typeof decoded.email === "string" ? decoded.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function finalizeAccount(
  ctx: UserContext,
  input: {
    provider: string;
    workspaceId: string;
    emailAddress?: string;
    displayName?: string | null;
    authMode?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: string | null;
    authorizationCode?: string;
    idToken?: string;
    authToken?: string;
  }
): Promise<Response> {
  const { userId, supabaseAdmin } = ctx;

  const provider = String(input.provider ?? "").toLowerCase();
  const workspaceId = String(input.workspaceId ?? "");
  let emailAddress = input.emailAddress?.trim().toLowerCase() ?? "";
  const displayName = input.displayName ? String(input.displayName).trim() : null;
  let authMode = String(input.authMode ?? "oauth");
  let accessToken = input.accessToken ? String(input.accessToken) : "";
  let refreshToken = input.refreshToken ? String(input.refreshToken) : "";
  let expiresAt = input.expiresAt ? String(input.expiresAt) : null;

  if (!workspaceId || !provider) {
    return badRequest("invalid_input", "provider and workspaceId are required");
  }

  await requireWorkspaceMember(supabaseAdmin, workspaceId, userId);

  if (![
    "gmail",
    "outlook",
    "apple",
    "custom",
  ].includes(provider)) {
    return badRequest("provider_unsupported", "Unsupported provider");
  }

  if (provider === "apple" && input.authorizationCode) {
    const exchanged = await exchangeAppleCode(input.authorizationCode);
    accessToken = exchanged.accessToken;
    refreshToken = exchanged.refreshToken ?? refreshToken;
    expiresAt = exchanged.expiresAt ?? expiresAt;
    authMode = "oauth";
    emailAddress = emailAddress || exchanged.email || decodeEmailFromIdToken(input.idToken) || "";
  }

  if (!emailAddress) {
    emailAddress = decodeEmailFromIdToken(input.idToken) || "";
  }

  if (!emailAddress) {
    return badRequest("email_missing", "Could not resolve email address from provider response");
  }

  const accountPayload = {
    user_id: userId,
    workspace_id: workspaceId,
    provider,
    auth_mode: authMode,
    email_address: emailAddress,
    display_name: displayName,
    status: "active",
    last_error: null,
  };

  const { data: account, error: accountError } = await supabaseAdmin
    .from("email_accounts")
    .upsert(accountPayload, { onConflict: "user_id,workspace_id,email_address" })
    .select("id,user_id,workspace_id,provider,auth_mode,email_address,display_name,status,last_sync_at,last_error,created_at,updated_at")
    .single();

  if (accountError || !account?.id) throw accountError ?? new Error("Failed to save account");

  const secrets: Record<string, unknown> = { account_id: account.id };
  if (accessToken) secrets.oauth_access_token_enc = await encryptSecret(accessToken);
  if (refreshToken) secrets.oauth_refresh_token_enc = await encryptSecret(refreshToken);
  if (expiresAt) secrets.oauth_expires_at = expiresAt;

  if (Object.keys(secrets).length > 1) {
    const { error: secretError } = await supabaseAdmin
      .from("email_account_secrets")
      .upsert(secrets, { onConflict: "account_id" });
    if (secretError) throw secretError;
  }

  return ok({
    account: {
      id: account.id,
      userId: account.user_id,
      workspaceId: account.workspace_id,
      provider: account.provider,
      authMode: account.auth_mode,
      emailAddress: account.email_address,
      displayName: account.display_name,
      status: account.status,
      lastSyncAt: account.last_sync_at,
      lastError: account.last_error,
      createdAt: account.created_at,
      updatedAt: account.updated_at,
    },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();

  const url = new URL(request.url);

  // Browser redirect callback (Apple form_post, OAuth popup)
  if (request.method === "POST" && request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    const code = String(form.get("code") ?? "");
    const state = String(form.get("state") ?? "");
    const idToken = form.get("id_token") ? String(form.get("id_token")) : undefined;
    const userRaw = form.get("user") ? String(form.get("user")) : undefined;

    let email: string | undefined;
    let displayName: string | undefined;
    if (userRaw) {
      try {
        const parsed = JSON.parse(userRaw);
        if (parsed?.email) email = String(parsed.email).toLowerCase();
        if (parsed?.name) {
          const first = parsed.name.firstName ? String(parsed.name.firstName) : "";
          const last = parsed.name.lastName ? String(parsed.name.lastName) : "";
          const combined = `${first} ${last}`.trim();
          if (combined) displayName = combined;
        }
      } catch {
        // noop
      }
    }

    return htmlBridge({
      source: "moduo-email-oauth",
      provider: "apple",
      code,
      state,
      idToken,
      email,
      displayName,
    });
  }

  if (request.method === "GET" && url.searchParams.get("code")) {
    return htmlBridge({
      source: "moduo-email-oauth",
      provider: String(url.searchParams.get("provider") ?? "apple"),
      code: String(url.searchParams.get("code") ?? ""),
      state: String(url.searchParams.get("state") ?? ""),
      idToken: url.searchParams.get("id_token") ?? undefined,
    });
  }

  if (request.method !== "POST") return badRequest("method_not_allowed", "Only POST is supported", 405);

  try {
    const body = await request.json();
    // Pass body so requireUser prefers body.authToken over the
    // Authorization header (which supabase.functions.invoke() may
    // auto-inject with a stale cached token).
    const ctx = await requireUser(request, body);

    return await finalizeAccount(ctx, {
      provider: body?.provider,
      workspaceId: body?.workspaceId,
      emailAddress: body?.emailAddress,
      displayName: body?.displayName,
      authMode: body?.authMode,
      accessToken: body?.accessToken,
      refreshToken: body?.refreshToken,
      expiresAt: body?.expiresAt,
      authorizationCode: body?.authorizationCode,
      idToken: body?.idToken,
      authToken: body?.authToken,
    });
  } catch (error) {
    const message = (error as Error).message;
    console.error("email-connect-callback failed", {
      message,
      path: url.pathname,
      method: request.method,
    });
    const status = message === "Workspace access denied" ? 403 : 401;
    return badRequest("connect_callback_failed", message, status);
  }
});
