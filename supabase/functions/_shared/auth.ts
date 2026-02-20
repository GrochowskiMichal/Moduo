import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

type UserContext = {
  userId: string;
  supabaseAdmin: ReturnType<typeof createClient>;
};

function decodeJwtPayloadEdge(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const payload = parts[1] ?? "";
  const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const json = atob(base64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function requireUser(request: Request, body?: Record<string, unknown> | null): Promise<UserContext> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY");
  }

  // ── Token extraction ──────────────────────────────────────────
  const authHeader = request.headers.get("Authorization");
  const headerJwt = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  const bodyJwt = (body && typeof body === "object" && typeof (body as Record<string,unknown>).authToken === "string")
    ? ((body as Record<string,unknown>).authToken as string).trim()
    : "";

  // Prefer body.authToken (explicitly set by our client with a fresh token)
  // over the Authorization header (auto-injected by supabase.functions.invoke
  // which may use a stale cached token).
  const jwt = bodyJwt || headerJwt;

  // ── Diagnostic logging (visible in Supabase Dashboard → Edge Functions → Logs) ──
  const headerPayload = headerJwt ? decodeJwtPayloadEdge(headerJwt) : null;
  const bodyPayload = bodyJwt ? decodeJwtPayloadEdge(bodyJwt) : null;
  const nowSec = Math.floor(Date.now() / 1000);
  console.log("[requireUser] token-diag", JSON.stringify({
    hasHeaderJwt: !!headerJwt,
    hasBodyJwt: !!bodyJwt,
    tokensMatch: headerJwt === bodyJwt,
    headerExp: headerPayload?.exp ?? null,
    headerSub: headerPayload?.sub ?? null,
    bodyExp: bodyPayload?.exp ?? null,
    bodySub: bodyPayload?.sub ?? null,
    chosenSource: bodyJwt ? "body" : headerJwt ? "header" : "none",
    now: nowSec,
    supabaseUrl,
  }));

  if (!jwt) {
    throw new Error("Missing bearer token");
  }

  // ── Validate via Auth API ────────────────────────────────────
  // Pass jwt explicitly to getUser(jwt) to avoid session-less client issues
  const supabaseAuth = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser(jwt);

  // ── Log the exact error from getUser ─────────────────────────
  if (error) {
    console.error("[requireUser] getUser FAILED", JSON.stringify({
      errorMessage: error.message,
      errorStatus: (error as any).status ?? null,
      errorName: error.name ?? null,
      jwtSub: decodeJwtPayloadEdge(jwt)?.sub ?? null,
      jwtExp: decodeJwtPayloadEdge(jwt)?.exp ?? null,
      jwtIss: decodeJwtPayloadEdge(jwt)?.iss ?? null,
      jwtAud: decodeJwtPayloadEdge(jwt)?.aud ?? null,
      now: nowSec,
    }));
  }

  if (error || !user?.id) {
    throw new Error(`Invalid token: ${error?.message ?? "no user"}`);
  }

  console.log("[requireUser] OK", user.id);

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return { userId: user.id, supabaseAdmin };
}

export async function requireWorkspaceMember(
  supabaseAdmin: ReturnType<typeof createClient>,
  workspaceId: string,
  userId: string
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) throw new Error("Workspace access denied");
}

export async function requireAccountOwner(
  supabaseAdmin: ReturnType<typeof createClient>,
  accountId: string,
  userId: string
): Promise<{ id: string; workspace_id: string }> {
  const { data, error } = await supabaseAdmin
    .from("email_accounts")
    .select("id,workspace_id")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) throw new Error("Email account not found");

  await requireWorkspaceMember(supabaseAdmin, data.workspace_id as string, userId);
  return { id: data.id as string, workspace_id: data.workspace_id as string };
}
