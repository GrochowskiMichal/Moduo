import { describe, expect, it } from "@rstest/core";

import { parseHookSecrets, signWebhook, verifyWebhook } from "./webhook.ts";

const KEY_B64 = btoa("a-thirty-two-byte-test-secret!!!");
const SECRET = `v1,whsec_${KEY_B64}`;
const OTHER = `v1,whsec_${btoa("another-thirty-two-byte-secret!!")}`;
const NOW = 1_791_500_000;
const BODY = '{"user":{},"email_data":{}}';

async function headersFor(body: string, secret = SECRET, timestamp = String(NOW), id = "msg_1") {
  const [key] = parseHookSecrets(secret);
  return { id, timestamp, signature: `v1,${await signWebhook(key, id, timestamp, body)}` };
}

describe("Standard Webhooks check", () => {
  it("accepts a request signed with the hook secret", async () => {
    expect(await verifyWebhook(BODY, await headersFor(BODY), SECRET, NOW)).toEqual({ ok: true });
  });

  it("accepts any of several configured secrets (rotation) and any listed signature", async () => {
    const headers = await headersFor(BODY, OTHER);
    expect(await verifyWebhook(BODY, headers, `${SECRET}|${OTHER}`, NOW)).toEqual({ ok: true });
    const both = { ...headers, signature: `v1,bm90LWl0 ${headers.signature}` };
    expect(await verifyWebhook(BODY, both, OTHER, NOW)).toEqual({ ok: true });
  });

  it("refuses a body changed after signing", async () => {
    const headers = await headersFor(BODY);
    expect(await verifyWebhook(`${BODY} `, headers, SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a signature made with another secret", async () => {
    expect(await verifyWebhook(BODY, await headersFor(BODY, OTHER), SECRET, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("refuses unsigned requests and missing headers", async () => {
    expect(await verifyWebhook(BODY, { id: null, timestamp: null, signature: null }, SECRET, NOW)).toEqual({
      ok: false,
      reason: "missing_headers",
    });
    const headers = await headersFor(BODY);
    expect(await verifyWebhook(BODY, { ...headers, signature: "v2,abc" }, SECRET, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("refuses a replay outside five minutes", async () => {
    const old = await headersFor(BODY, SECRET, String(NOW - 301));
    expect(await verifyWebhook(BODY, old, SECRET, NOW)).toEqual({ ok: false, reason: "stale_timestamp" });
    const recent = await headersFor(BODY, SECRET, String(NOW - 299));
    expect(await verifyWebhook(BODY, recent, SECRET, NOW)).toEqual({ ok: true });
  });

  it("refuses everything when no secret is configured", async () => {
    expect(await verifyWebhook(BODY, await headersFor(BODY), undefined, NOW)).toEqual({
      ok: false,
      reason: "no_secret",
    });
    expect(parseHookSecrets("v1,whsec_%%%")).toEqual([]);
  });
});
