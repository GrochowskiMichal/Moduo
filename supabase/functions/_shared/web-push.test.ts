// Web Push encryption and VAPID (TV-D12): what push-send sends is what a
// browser can read. The test plays the browser: it makes the subscription's
// keys, decrypts the body per RFC 8291 and checks the VAPID signature.

import { webcrypto } from "node:crypto";

import { describe, expect, it } from "@rstest/core";

import {
  base64UrlDecode,
  base64UrlEncode,
  encryptPayload,
  isPushEndpoint,
  sendWebPush,
  vapidAuthorization,
} from "./web-push.ts";

const subtle = (globalThis.crypto?.subtle ?? webcrypto.subtle) as SubtleCrypto;
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

const encoder = new TextEncoder();

async function browserKeys() {
  const pair = (await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  const auth = new Uint8Array(16);
  webcrypto.getRandomValues(auth);
  return { pair, p256dh: base64UrlEncode(raw), auth: base64UrlEncode(auth) };
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
      key,
      length * 8,
    ),
  );
}

/** The browser's side of RFC 8291. */
async function decrypt(body: Uint8Array, browser: Awaited<ReturnType<typeof browserKeys>>) {
  const salt = body.slice(0, 16);
  const idLen = body[20]!;
  const asPublic = body.slice(21, 21 + idLen);
  const ciphertext = body.slice(21 + idLen);
  const serverKey = await subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(
    await subtle.deriveBits({ name: "ECDH", public: serverKey }, browser.pair.privateKey, 256),
  );
  const uaPublic = base64UrlDecode(browser.p256dh);
  const info = new Uint8Array([...encoder.encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(base64UrlDecode(browser.auth), shared, info, 32);
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
  const key = await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext));
  // Strip the record delimiter (0x02) at the end.
  return new TextDecoder().decode(plain.slice(0, plain.lastIndexOf(2)));
}

async function vapid() {
  const pair = (await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = await subtle.exportKey("jwk", pair.privateKey);
  const raw = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  return {
    keys: { publicKey: base64UrlEncode(raw), privateKey: jwk.d as string, subject: "mailto:hello@moduo.app" },
    verifyKey: pair.publicKey,
  };
}

describe("web push (TV-D12)", () => {
  it("encrypts a payload the subscribed browser can read", async () => {
    const browser = await browserKeys();
    const body = await encryptPayload(encoder.encode('{"title":"Reminder"}'), browser);
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);
    expect(await decrypt(body, browser)).toBe('{"title":"Reminder"}');
  });

  it("signs a VAPID token for the push service's origin", async () => {
    const { keys, verifyKey } = await vapid();
    const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, 1_800_000_000);
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, h, c, s, k] = match!;
    expect(k).toBe(keys.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(c!)));
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: 1_800_000_000 + 43_200, sub: "mailto:hello@moduo.app" });
    const ok = await subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verifyKey,
      base64UrlDecode(s!),
      encoder.encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });

  it("only ever sends to a known push service", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/x")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/QH0")).toBe(true);
    expect(isPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com.example.com/x")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isPushEndpoint("http://kong:8000/functions/v1/x")).toBe(false);
  });

  it("reads the push service's answer: sent, gone, or failed", async () => {
    const browser = await browserKeys();
    const { keys } = await vapid();
    const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: browser.p256dh, auth: browser.auth };
    const answer = (status: number) => (async () => new Response(null, { status })) as unknown as typeof fetch;
    expect(await sendWebPush(sub, { title: "x" }, keys, { fetch: answer(201) })).toEqual({ ok: true, status: 201 });
    expect(await sendWebPush(sub, { title: "x" }, keys, { fetch: answer(410) })).toEqual({
      ok: false,
      gone: true,
      status: 410,
    });
    const failed = await sendWebPush(sub, { title: "x" }, keys, { fetch: answer(500) });
    expect(failed.ok).toBe(false);
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const refused = await sendWebPush({ ...sub, endpoint: "https://evil.example/x" }, { title: "x" }, keys, {
      fetch: spy,
    });
    expect(refused).toEqual({ ok: false, gone: true, status: 0 });
    expect(called).toBe(false);
  });
});
