import type { SupabaseClient } from "@supabase/supabase-js";
import {
  emailConnectCallbackSchema,
  emailConnectInitSchema,
  emailListThreadsSchema,
  emailSendInputSchema,
} from "./schemas";
import type {
  EmailAccount,
  EmailFolder,
  EmailMessage,
  EmailProvider,
  EmailSendInput,
  EmailThread,
  EmailThreadPage,
} from "../types";

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const payload = parts[1] ?? "";
  const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const json = atob(base64);
    const parsed = JSON.parse(json);
    return typeof parsed === "object" && parsed ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Ensure we have a fresh access token before calling an edge function.
 * Returns the access token string or throws if the session is unrecoverable.
 */
async function ensureFreshToken(supabase: SupabaseClient): Promise<string> {
  // First, try the cached session
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt =
    typeof session?.expires_at === "number"
      ? session.expires_at
      : session?.expires_in
        ? nowSeconds + session.expires_in
        : null;

  // If token exists and has >120s left, use it
  if (session?.access_token && expiresAt && expiresAt - nowSeconds > 120) {
    return session.access_token;
  }

  // Otherwise force a refresh
  const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError || !refreshData.session?.access_token) {
    console.error("[email-client] token refresh failed", refreshError?.message);
    throw new Error("Session expired. Please sign in again.");
  }

  return refreshData.session.access_token;
}

async function invoke<T>(
  supabase: SupabaseClient,
  fn: string,
  body?: unknown,
  headers?: Record<string, string>,
  retry = true
): Promise<T> {
  const token = await ensureFreshToken(supabase);
  const tokenPayloadPre = decodeJwtPayload(token);
  const nowPre = Math.floor(Date.now() / 1000);

  // Log what we're sending to the edge function
  console.debug(`[email-client] invoke ${fn}`, {
    tokenSub: tokenPayloadPre?.sub,
    tokenExp: tokenPayloadPre?.exp,
    tokenIss: tokenPayloadPre?.iss,
    tokenTtl: typeof tokenPayloadPre?.exp === "number" ? tokenPayloadPre.exp - nowPre : null,
    now: nowPre,
    bodyHasAuthToken: body && typeof body === "object" && !Array.isArray(body),
    retry,
  });

  const authHeader: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  const nextBody =
    body && typeof body === "object" && !Array.isArray(body)
      ? { ...(body as Record<string, unknown>), authToken: token }
      : body;

  const { data, error } = await supabase.functions.invoke(fn, {
    body: nextBody as any,
    headers: { ...authHeader, ...(headers ?? {}) },
  });

  if (error) {
    let message = (error as any)?.message ?? "Edge Function request failed";
    const context = (error as any)?.context;
    if (context) {
      const status = typeof context.status === "number" ? context.status : null;
      try {
        const parsed = await context.clone().json();
        const parsedMessage =
          typeof parsed?.error?.message === "string"
            ? parsed.error.message
            : typeof parsed?.message === "string"
              ? parsed.message
              : null;
        if (parsedMessage) {
          message = status ? `${status} ${parsedMessage}` : parsedMessage;
        } else if (status) {
          message = `${status} ${message}`;
        }
      } catch {
        try {
          const text = await context.clone().text();
          if (text) {
            message = status ? `${status} ${text}` : text;
          } else if (status) {
            message = `${status} ${message}`;
          }
        } catch {
          if (status) {
            message = `${status} ${message}`;
          }
        }
      }
    }

    const normalized = message.toLowerCase();
    if (
      normalized.includes("invalid jwt") ||
      normalized.includes("invalid token") ||
      normalized.includes("missing bearer token")
    ) {
      // Token was rejected server-side — try one more time with a forced refresh
      if (retry) {
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshData.session?.access_token) {
          return invoke<T>(supabase, fn, body, headers, false);
        }
        console.error("[email-client] retry refresh failed", refreshError?.message);
      }

      // Build diagnostic detail for logging
      const {
        data: { session: latestSession },
      } = await supabase.auth.getSession();
      const latestNow = Math.floor(Date.now() / 1000);
      const latestExpiresAt =
        typeof latestSession?.expires_at === "number"
          ? latestSession.expires_at
          : latestSession?.expires_in
            ? latestNow + latestSession.expires_in
            : null;
      const tokenPayload = token ? decodeJwtPayload(token) : null;
      const detail = [
        latestExpiresAt ? `expiresAt=${latestExpiresAt}` : "expiresAt=unknown",
        `now=${latestNow}`,
        latestSession?.user?.id ? `userId=${latestSession.user.id}` : "userId=missing",
        typeof tokenPayload?.iss === "string" ? `tokenIss=${tokenPayload.iss}` : null,
        typeof tokenPayload?.exp === "number" ? `tokenExp=${tokenPayload.exp}` : null,
        typeof tokenPayload?.sub === "string" ? `tokenSub=${tokenPayload.sub}` : null,
      ]
        .filter(Boolean)
        .join(" ");
      console.error("[email-client] auth failure", { message, detail });
      throw new Error(`Session expired. Please sign in again. ${detail}`);
    }
    throw new Error(message);
  }
  return data as T;
}

export async function connectInit(
  supabase: SupabaseClient,
  input: { provider: EmailProvider; workspaceId: string }
): Promise<{ authUrl?: string; requiredFields?: string[]; state?: string }> {
  const payload = emailConnectInitSchema.parse(input);
  return invoke(supabase, "email-connect-init", payload);
}

export async function connectCallback(
  supabase: SupabaseClient,
  input: {
    provider: EmailProvider;
    workspaceId: string;
    emailAddress?: string;
    displayName?: string;
    authMode?: "oauth" | "app_password" | "smtp_imap" | "smtp_pop3";
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: string;
    authorizationCode?: string;
    idToken?: string;
    authToken?: string;
  }
): Promise<{ account: EmailAccount }> {
  const payload = emailConnectCallbackSchema.parse(input);
  const headers = payload.authToken
    ? { Authorization: `Bearer ${payload.authToken}` }
    : undefined;
  return invoke(supabase, "email-connect-callback", payload, headers);
}

export async function upsertCustomAccount(
  supabase: SupabaseClient,
  input: Record<string, unknown>
): Promise<{ account: EmailAccount; verification: string }> {
  return invoke(supabase, "email-account-upsert-custom", input);
}

export async function syncAccount(
  supabase: SupabaseClient,
  accountId: string
): Promise<{ accountId: string; syncedAt: string }> {
  return invoke(supabase, "email-sync-account", { accountId });
}

export async function listThreads(
  supabase: SupabaseClient,
  input: {
    accountId: string;
    folderId?: string;
    cursor?: string;
    limit?: number;
    search?: string;
    unreadOnly?: boolean;
  }
): Promise<EmailThreadPage> {
  const payload = emailListThreadsSchema.parse(input);
  return invoke(supabase, "email-list-threads", payload);
}

export async function getThread(
  supabase: SupabaseClient,
  threadId: string
): Promise<{ thread: EmailThread; messages: EmailMessage[] }> {
  return invoke(supabase, "email-get-thread", { threadId });
}

export async function sendEmail(supabase: SupabaseClient, input: EmailSendInput): Promise<{ messageId: string; threadId: string }> {
  const payload = emailSendInputSchema.parse(input);
  return invoke(supabase, "email-send", payload);
}

export async function disconnectAccount(
  supabase: SupabaseClient,
  accountId: string
): Promise<{ accountId: string; status: "disabled" }> {
  return invoke(supabase, "email-disconnect-account", { accountId });
}

export async function listAccounts(supabase: SupabaseClient, workspaceId: string): Promise<EmailAccount[]> {
  const { data, error } = await supabase
    .from("email_accounts")
    .select("id,user_id,workspace_id,provider,auth_mode,email_address,display_name,status,last_sync_at,last_error,created_at,updated_at")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as any[]).map((row) => ({
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    authMode: row.auth_mode,
    emailAddress: row.email_address,
    displayName: row.display_name,
    status: row.status,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function listFolders(supabase: SupabaseClient, accountId: string): Promise<EmailFolder[]> {
  const { data, error } = await supabase
    .from("email_folders")
    .select("id,account_id,remote_id,name,kind,created_at,updated_at")
    .eq("account_id", accountId)
    .order("kind", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as any[]).map((row) => ({
    id: row.id,
    accountId: row.account_id,
    remoteId: row.remote_id,
    name: row.name,
    kind: row.kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
