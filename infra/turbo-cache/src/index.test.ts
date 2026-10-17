import { describe, expect, it } from "@rstest/core";

import { type Bucket, type Env, handle, type StoredObject } from "./index";

/** In-memory stand-in for the R2 binding. */
function memoryBucket() {
  const store = new Map<string, { bytes: ArrayBuffer; customMetadata: Record<string, string> }>();
  const bucket: Bucket = {
    async head(key) {
      const hit = store.get(key);
      return hit
        ? ({ size: hit.bytes.byteLength, customMetadata: hit.customMetadata } as StoredObject)
        : null;
    },
    async get(key) {
      const hit = store.get(key);
      if (!hit) return null;
      return {
        size: hit.bytes.byteLength,
        customMetadata: hit.customMetadata,
        body: new Response(hit.bytes).body!,
      };
    },
    async put(key, value, { customMetadata }) {
      const bytes = await new Response(value).arrayBuffer();
      store.set(key, { bytes, customMetadata });
    },
  };
  return { bucket, store };
}

const READ = "read-token-for-tests";
const WRITE = "write-token-for-tests";

function setup() {
  const { bucket, store } = memoryBucket();
  const env: Env = { ARTIFACTS: bucket, READ_TOKEN: READ, WRITE_TOKEN: WRITE };
  const call = (path: string, init: RequestInit & { token?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    return handle(new Request(`https://cache.test${path}`, { ...init, headers }), env);
  };
  return { call, store };
}

const put = (
  call: ReturnType<typeof setup>["call"],
  hash: string,
  token: string,
  body = "artifact-bytes",
) =>
  call(`/v8/artifacts/${hash}?teamId=team_moduo`, {
    method: "PUT",
    token,
    body,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(body.length),
      "x-artifact-tag": "c2lnbmF0dXJl",
      "x-artifact-duration": "1234",
    },
  });

describe("turbo remote cache worker", () => {
  it("rejects a missing or wrong token", async () => {
    const { call } = setup();
    expect((await call("/v8/artifacts/status")).status).toBe(401);
    expect((await call("/v8/artifacts/status", { token: "nope" })).status).toBe(401);
  });

  it("reports the cache as enabled to either token", async () => {
    const { call } = setup();
    for (const token of [READ, WRITE]) {
      const res = await call("/v8/artifacts/status", { token });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "enabled" });
    }
  });

  it("stores with the write token and serves the bytes, signature tag and duration back", async () => {
    const { call, store } = setup();
    expect((await put(call, "abc123", WRITE)).status).toBe(202);
    expect(store.has("team_moduo/abc123")).toBe(true);

    const res = await call("/v8/artifacts/abc123?teamId=team_moduo", { token: READ });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-artifact-tag")).toBe("c2lnbmF0dXJl");
    expect(res.headers.get("x-artifact-duration")).toBe("1234");
    expect(await res.text()).toBe("artifact-bytes");

    const head = await call("/v8/artifacts/abc123?teamId=team_moduo", {
      method: "HEAD",
      token: READ,
    });
    expect(head.status).toBe(200);
  });

  it("refuses a write with the read-only token (the PR case)", async () => {
    const { call, store } = setup();
    const res = await put(call, "abc123", READ);
    expect(res.status).toBe(403);
    expect(store.size).toBe(0);
  });

  it("answers 404 for a miss, and keeps teams apart", async () => {
    const { call } = setup();
    await put(call, "abc123", WRITE);
    expect((await call("/v8/artifacts/missing?teamId=team_moduo", { token: READ })).status).toBe(
      404,
    );
    expect((await call("/v8/artifacts/abc123?teamId=other", { token: READ })).status).toBe(404);
    expect(
      (await call("/v8/artifacts/abc123?teamId=team_moduo", { method: "HEAD", token: READ }))
        .status,
    ).toBe(200);
  });

  it("rejects hashes and teams that could escape the key prefix", async () => {
    const { call } = setup();
    expect((await call("/v8/artifacts/..%2Fx?teamId=team_moduo", { token: READ })).status).toBe(
      404,
    );
    expect((await call("/v8/artifacts/a.b?teamId=team_moduo", { token: READ })).status).toBe(404);
    expect((await call("/v8/artifacts/abc?teamId=../x", { token: READ })).status).toBe(400);
  });

  it("needs a Content-Length and caps the size", async () => {
    const { call } = setup();
    const big = await call("/v8/artifacts/abc?teamId=t", {
      method: "PUT",
      token: WRITE,
      body: "x",
      headers: { "content-length": String(200 * 1024 * 1024) },
    });
    expect(big.status).toBe(413);
  });

  it("answers a batch lookup with hits and nulls", async () => {
    const { call } = setup();
    await put(call, "hit1", WRITE);
    const res = await call("/v8/artifacts?teamId=team_moduo", {
      method: "POST",
      token: READ,
      body: JSON.stringify({ hashes: ["hit1", "miss1"] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      hit1: { size: 14, taskDurationMs: 1234, tag: "c2lnbmF0dXJl" },
      miss1: null,
    });
  });

  it("accepts usage events and 404s anything outside the API", async () => {
    const { call } = setup();
    expect(
      (await call("/v8/artifacts/events", { method: "POST", token: READ, body: "[]" })).status,
    ).toBe(200);
    expect((await call("/", { token: READ })).status).toBe(404);
    expect((await call("/v8/artifacts/abc", { method: "DELETE", token: WRITE })).status).toBe(405);
  });
});
