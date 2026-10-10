/**
 * Standard Webhooks signature check (https://www.standardwebhooks.com), which
 * Supabase Auth's HTTP hooks use (auth-email-hook) and Resend's webhooks use
 * under Svix's names (resend-webhook: `svix-id`, `svix-timestamp`,
 * `svix-signature`, secret `whsec_<base64>`; same signed content and HMAC).
 * Web Crypto only, so it runs in Deno and in the unit tests without the esm.sh
 * library.
 *
 * Supabase signs `${webhook-id}.${webhook-timestamp}.${body}` with HMAC-SHA256.
 * The secret is `v1,whsec_<base64>`; several can be configured, separated by
 * `|`, while one is rotated out. `webhook-signature` lists one or more
 * `v1,<base64 signature>` entries; the spec separates them with spaces and
 * Supabase Auth joins them with ", " (hookshttp.go), so both are read. Any
 * match passes.
 */

/** How far the timestamp may be from now, either way (the library's default). */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type WebhookHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

export type WebhookCheck =
  | { ok: true }
  | {
      ok: false;
      reason: "no_secret" | "missing_headers" | "stale_timestamp" | "bad_signature";
    };

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The raw keys of a `v1,whsec_…[|v1,whsec_…]` setting; malformed entries are skipped. */
export function parseHookSecrets(setting: string | null | undefined): Uint8Array<ArrayBuffer>[] {
  if (!setting) return [];
  return setting
    .split("|")
    .map((entry) => entry.trim().replace(/^v1,/, "").replace(/^whsec_/, ""))
    .filter(Boolean)
    .map(base64ToBytes)
    .filter((key): key is Uint8Array<ArrayBuffer> => key !== null && key.length > 0);
}

export async function signWebhook(key: Uint8Array<ArrayBuffer>, id: string, timestamp: string, body: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return bytesToBase64(new Uint8Array(signature));
}

/** Compares two strings without stopping at the first difference. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyWebhook(
  body: string,
  headers: WebhookHeaders,
  secretSetting: string | null | undefined,
  nowSeconds: number,
): Promise<WebhookCheck> {
  const keys = parseHookSecrets(secretSetting);
  if (keys.length === 0) return { ok: false, reason: "no_secret" };
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "stale_timestamp" };
  if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: "stale_timestamp" };
  }
  // "v1,<sig> v1,<sig>" or "v1,<sig>, v1,<sig>": split on whitespace, then drop
  // the separator comma (base64 never ends in one).
  const offered = signature
    .split(/\s+/)
    .map((entry) => entry.trim().replace(/,$/, ""))
    .filter((entry) => entry.startsWith("v1,"))
    .map((entry) => entry.slice(3));
  if (offered.length === 0) return { ok: false, reason: "bad_signature" };
  for (const key of keys) {
    const expected = await signWebhook(key, id, timestamp, body);
    if (offered.some((candidate) => timingSafeEqual(candidate, expected))) return { ok: true };
  }
  return { ok: false, reason: "bad_signature" };
}
