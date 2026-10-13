/**
 * Web Push with WebCrypto only (TV-D12): VAPID (RFC 8292) and the aes128gcm
 * message encryption (RFC 8291 / RFC 8188). No library: Deno and the browser
 * test runner both have `crypto.subtle`, and the whole thing is ~150 lines.
 *
 * Plain TypeScript with an injected fetch, so the unit tests and push-send run
 * the same code.
 */

export type PushSubscriptionKeys = {
  endpoint: string;
  /** The browser's P-256 public key, base64url (65 bytes uncompressed). */
  p256dh: string;
  /** The browser's auth secret, base64url (16 bytes). */
  auth: string;
};

export type VapidKeys = {
  /** base64url, 65-byte uncompressed P-256 point (what the app subscribes with). */
  publicKey: string;
  /** base64url, the 32-byte private scalar. */
  privateKey: string;
  /** A contact for the push service: "mailto:…" or "https://…". */
  subject: string;
};

export type PushOutcome =
  | { ok: true; status: number }
  /** The push service says this subscription is gone: forget it. */
  | { ok: false; gone: true; status: number }
  | { ok: false; gone: false; status: number; error: string };

const encoder = new TextEncoder();

/**
 * The push services browsers use. The database refuses any other endpoint
 * (push__endpoint_ok); this is checked again before every send.
 */
const PUSH_HOST = /^([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && (url.port === "" || url.port === "443") && PUSH_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function base64UrlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let raw = "";
  for (const b of view) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/** The VAPID private key as a signing key (JWK from the raw scalar and the public point). */
async function vapidSigningKey(vapid: VapidKeys): Promise<CryptoKey> {
  const pub = base64UrlDecode(vapid.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID public key must be an uncompressed P-256 point");
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: vapid.privateKey,
      x: base64UrlEncode(pub.slice(1, 33)),
      y: base64UrlEncode(pub.slice(33, 65)),
      ext: false,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/** `Authorization: vapid t=<JWT>, k=<public key>` for one push service (RFC 8292). */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, nowSeconds: number): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64UrlEncode(
    encoder.encode(JSON.stringify({ aud: audience, exp: nowSeconds + 12 * 3600, sub: vapid.subject })),
  );
  const unsigned = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    await vapidSigningKey(vapid),
    encoder.encode(unsigned),
  );
  // WebCrypto answers r||s (64 bytes), which is what ES256 wants.
  return `vapid t=${unsigned}.${base64UrlEncode(signature)}, k=${vapid.publicKey}`;
}

/**
 * Encrypt a payload for one subscription (RFC 8291, aes128gcm, one record).
 * `salt` and `serverKeys` are drawn fresh unless a test passes them.
 */
export async function encryptPayload(
  payload: Uint8Array<ArrayBuffer>,
  subscription: Pick<PushSubscriptionKeys, "p256dh" | "auth">,
  fixed?: { salt?: Uint8Array<ArrayBuffer>; serverKeys?: CryptoKeyPair },
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = base64UrlDecode(subscription.p256dh);
  const authSecret = base64UrlDecode(subscription.auth);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const server =
    fixed?.serverKeys ??
    ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", server.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, server.privateKey, 256),
  );
  const keyInfo = concat(encoder.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // One record: the payload, then the last-record delimiter (0x02).
  const plaintext = concat(payload, new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext));
  const recordSize = new Uint8Array(new ArrayBuffer(4));
  new DataView(recordSize.buffer).setUint32(0, 4096);
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

/** Send one notice to one browser. Never throws for a push service's answer. */
export async function sendWebPush(
  subscription: PushSubscriptionKeys,
  message: Record<string, unknown>,
  vapid: VapidKeys,
  opts: { fetch?: typeof fetch; nowSeconds?: number; ttlSeconds?: number; timeoutMs?: number } = {},
): Promise<PushOutcome> {
  if (!isPushEndpoint(subscription.endpoint)) {
    return { ok: false, gone: true, status: 0 };
  }
  const doFetch = opts.fetch ?? fetch;
  const body = await encryptPayload(encoder.encode(JSON.stringify(message)), subscription);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const response = await doFetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(
          subscription.endpoint,
          vapid,
          opts.nowSeconds ?? Math.floor(Date.now() / 1000),
        ),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(opts.ttlSeconds ?? 86_400),
        Urgency: "high",
      },
      body,
      signal: controller.signal,
    });
    if (response.ok) return { ok: true, status: response.status };
    if (response.status === 404 || response.status === 410) return { ok: false, gone: true, status: response.status };
    return { ok: false, gone: false, status: response.status, error: `push service answered ${response.status}` };
  } catch (error) {
    return { ok: false, gone: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}
