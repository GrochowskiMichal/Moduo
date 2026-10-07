/**
 * Edge Function: waitlist-join
 *
 * Public endpoint behind the landing page "Join the waitlist" forms (nav dialog, footer,
 * hero, closing section). Writes go through public.waitlist_join() — the table
 * itself is closed to anon/authenticated.
 *
 * Method: POST
 * Auth:   none (public; deploy with --no-verify-jwt)
 * Body:   { email: string; source: "nav" | "hero" | "close" | "footer"; website?: string; elapsedMs?: number; updates?: boolean }
 *         `updates` is the optional build-updates opt-in from the success state; it is
 *         stored as a request (updates_requested) until a confirmation email exists.
 * Returns: 200 { success: true } — also for duplicates and suspected bots, so the
 *          endpoint never reveals whether an address is already on the list.
 *          400 invalid_email · 403 origin · 413 too large · 429 rate_limited
 *
 * Abuse controls: Origin allowlist, body cap, honeypot + minimum time-on-page,
 * and a per-IP (8/hour) + global (500/10 min) limit enforced atomically in SQL.
 * IPs are never stored raw: HMAC-SHA256 keyed with the project secret key.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import { parseJsonBody, waitlistJoinBodySchema } from "../_shared/contracts/http-bodies.ts";
import { getDefaultSecretKey } from "../_shared/secret-keys.ts";

const SECRET_KEY = getDefaultSecretKey();
const MAX_BODY_BYTES = 2048;
const MIN_ELAPSED_MS = 1200;

const ALLOWED_ORIGINS = new Set([
  "https://moduo.app",
  "https://www.moduo.app",
  "http://127.0.0.1:8765",
  "http://localhost:8765",
]);
const ALLOWED_ORIGIN_PATTERNS = [/^https:\/\/moduo[a-z0-9-]*\.vercel\.app$/];

function isAllowedOrigin(origin: string | null): origin is string {
  if (!origin) return false;
  return ALLOWED_ORIGINS.has(origin) || ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
}

function corsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "unknown";
}

const hmacKey = crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(SECRET_KEY),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"],
);

async function hashIp(ip: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    "HMAC",
    await hmacKey,
    new TextEncoder().encode(`waitlist:v1:${ip}`),
  );
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin)) {
    return new Response("Forbidden", { status: 403, headers: { Vary: "Origin" } });
  }
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, cors);
  }

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json({ error: "too_large" }, 413, cors);
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "invalid_email" }, 400, cors);
    }

    const parsed = parseJsonBody(waitlistJoinBodySchema, body);
    if (!parsed.success) {
      return json({ error: "invalid_email" }, 400, cors);
    }
    const { email, source, website, elapsedMs, updates } = parsed.data;

    if ((website && website.trim() !== "") || (elapsedMs !== undefined && elapsedMs < MIN_ELAPSED_MS)) {
      console.log(`[waitlist-join] dropped suspected bot (source=${source})`);
      return json({ success: true }, 200, cors);
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", SECRET_KEY, {
      auth: { persistSession: false },
    });

    const { data, error } = await supabase.rpc("waitlist_join", {
      p_email: email,
      p_source: source,
      p_ip_hash: await hashIp(clientIp(req)),
      p_user_agent: req.headers.get("user-agent"),
      p_referrer: req.headers.get("referer"),
      p_updates: updates ?? null,
    });

    if (error) {
      if (error.code === "22023") {
        return json({ error: "invalid_email" }, 400, cors);
      }
      console.error("[waitlist-join] rpc error:", error.code, error.message);
      return json({ error: "server_error" }, 500, cors);
    }
    if (data === "rate_limited") {
      return json({ error: "rate_limited" }, 429, { ...cors, "Retry-After": "3600" });
    }

    console.log(`[waitlist-join] ok (source=${source})`);
    // Echo the opt-in so the page only shows "updates on" once it is really stored.
    return json(updates === undefined ? { success: true } : { success: true, updates }, 200, cors);
  } catch (err) {
    console.error("[waitlist-join] unexpected error:", err);
    return json({ error: "server_error" }, 500, cors);
  }
});
