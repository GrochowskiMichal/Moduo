import { describe, expect, it } from "@rstest/core";

import {
  type Bucket,
  compareVersions,
  type Env,
  handle,
  INSTALL_ID_HEADER,
  parseConfig,
  rolloutBucket,
  type StoredObject,
} from "./server";

/** In-memory stand-in for the R2 binding. */
function memoryBucket(files: Record<string, string>): Bucket {
  const object = (text: string): StoredObject => ({
    size: new TextEncoder().encode(text).byteLength,
    httpEtag: `"${text.length}"`,
    body: new Response(text).body!,
    text: async () => text,
  });
  return {
    async get(key) {
      return key in files ? object(files[key]!) : null;
    },
    async head(key) {
      if (!(key in files)) return null;
      const { size, httpEtag } = object(files[key]!);
      return { size, httpEtag };
    },
  };
}

const BASE = "https://updates.test";
const manifest = (
  version: string,
  platforms = ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"],
) =>
  JSON.stringify({
    version,
    notes: `build ${version}`,
    pub_date: "2026-10-17T12:00:00Z",
    platforms: Object.fromEntries(
      platforms.map((p) => [
        p,
        { signature: `sig-${p}`, url: `${BASE}/download/desktop/x/${version}/${p}` },
      ]),
    ),
  });

function setup({
  files = {} as Record<string, string>,
  config = {} as Record<string, string>,
} = {}) {
  const env: Env = {
    RELEASES: memoryBucket(files),
    UPDATE_CONFIG: { get: async (key) => config[key] ?? null },
  };
  const call = (path: string, headers: Record<string, string> = {}, method = "GET") =>
    handle(new Request(`${BASE}${path}`, { method, headers }), env);
  return { call };
}

const STAGING = {
  "desktop/staging/latest.json": manifest("1.1.0-rc.12"),
  "desktop/production/latest.json": manifest("1.1.0"),
};

describe("update check", () => {
  it("answers the manifest for a newer version on the asked channel", async () => {
    const { call } = setup({ files: STAGING });
    const res = await call("/desktop/staging/darwin/aarch64/1.1.0-rc.3");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      version: "1.1.0-rc.12",
      notes: "build 1.1.0-rc.12",
      pub_date: "2026-10-17T12:00:00Z",
      url: `${BASE}/download/desktop/x/1.1.0-rc.12/darwin-aarch64`,
      signature: "sig-darwin-aarch64",
    });
  });

  it("keeps the channels apart", async () => {
    const { call } = setup({ files: STAGING });
    const prod = await call("/desktop/production/darwin/aarch64/1.0.22");
    expect(((await prod.json()) as { version: string }).version).toBe("1.1.0");
    // A production install at 1.1.0 is not offered staging's 1.1.0-rc.12 (which sorts lower).
    expect((await call("/desktop/production/darwin/aarch64/1.1.0")).status).toBe(204);
    expect((await call("/desktop/beta/darwin/aarch64/1.0.0")).status).toBe(404);
  });

  it("answers 204 when the install is current or ahead", async () => {
    const { call } = setup({ files: STAGING });
    expect((await call("/desktop/staging/darwin/aarch64/1.1.0-rc.12")).status).toBe(204);
    expect((await call("/desktop/staging/darwin/aarch64/1.1.0")).status).toBe(204);
  });

  it("answers 204 when the channel has nothing published", async () => {
    const { call } = setup();
    expect((await call("/desktop/staging/darwin/aarch64/1.0.0")).status).toBe(204);
  });

  it("answers 204 for a platform the release left out (a failed Windows build)", async () => {
    const { call } = setup({
      files: {
        "desktop/staging/latest.json": manifest("1.1.0-rc.12", ["darwin-aarch64", "darwin-x86_64"]),
      },
    });
    expect((await call("/desktop/staging/windows/x86_64/1.1.0-rc.3")).status).toBe(204);
    expect((await call("/desktop/staging/darwin/x86_64/1.1.0-rc.3")).status).toBe(200);
  });

  it("decodes the version Tauri percent-encodes and rejects junk", async () => {
    const { call } = setup({ files: STAGING });
    expect((await call("/desktop/staging/darwin/aarch64/1.1.0-rc.3%2Bbuild.7")).status).toBe(200);
    expect((await call("/desktop/staging/darwin/aarch64/latest")).status).toBe(400);
    expect((await call("/desktop/staging/plan9/aarch64/1.0.0")).status).toBe(404);
  });

  it("never caches an answer", async () => {
    const { call } = setup({ files: STAGING });
    const res = await call("/desktop/staging/darwin/aarch64/1.0.0");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("kill switch", () => {
  it("answers 204 to everyone while paused", async () => {
    const { call } = setup({
      files: STAGING,
      config: { "channel:staging": JSON.stringify({ paused: true, rollout: 100 }) },
    });
    expect((await call("/desktop/staging/darwin/aarch64/1.0.0")).status).toBe(204);
    // Pausing one channel leaves the other alone.
    expect((await call("/desktop/production/darwin/aarch64/1.0.0")).status).toBe(200);
  });

  it("answers 204 when KV or R2 can't be read, so the client never falls back", async () => {
    const env: Env = {
      RELEASES: memoryBucket(STAGING),
      UPDATE_CONFIG: {
        get: async () => {
          throw new Error("KV down");
        },
      },
    };
    const res = await handle(new Request(`${BASE}/desktop/staging/darwin/aarch64/1.0.0`), env);
    expect(res.status).toBe(204);
  });

  it("treats a config that doesn't parse as paused", async () => {
    for (const raw of [
      "{paused: true",
      '"yes"',
      '{"rollout":"50"}',
      '{"paused":"false"}',
      "null",
    ]) {
      const { call } = setup({ files: STAGING, config: { "channel:staging": raw } });
      expect((await call("/desktop/staging/darwin/aarch64/1.0.0")).status).toBe(204);
    }
  });

  it("parses the stored config", () => {
    expect(parseConfig(null)).toEqual({ rollout: 100, paused: false });
    expect(parseConfig('{"rollout":25}')).toEqual({ rollout: 25, paused: false });
    expect(parseConfig('{"rollout":250,"paused":false}')).toEqual({ rollout: 100, paused: false });
    expect(parseConfig("not json").paused).toBe(true);
  });
});

describe("rollout", () => {
  const ids = Array.from({ length: 400 }, (_, i) => `install-${String(i).padStart(4, "0")}`);
  const offered = async (rollout: number) => {
    const { call } = setup({
      files: STAGING,
      config: { "channel:staging": JSON.stringify({ rollout, paused: false }) },
    });
    const answers = await Promise.all(
      ids.map((id) => call("/desktop/staging/darwin/aarch64/1.0.0", { [INSTALL_ID_HEADER]: id })),
    );
    return answers.filter((r) => r.status === 200).length;
  };

  it("offers the update to about the set share of installs", async () => {
    expect(await offered(0)).toBe(0);
    expect(await offered(100)).toBe(ids.length);
    const quarter = await offered(25);
    expect(quarter).toBeGreaterThan(ids.length * 0.15);
    expect(quarter).toBeLessThan(ids.length * 0.35);
  });

  it("gives one install the same answer every time, and widening never drops anyone", async () => {
    const offeredIds = async (rollout: number) => {
      const { call } = setup({
        files: STAGING,
        config: { "channel:staging": JSON.stringify({ rollout, paused: false }) },
      });
      const out = new Set<string>();
      for (const id of ids) {
        const res = await call("/desktop/staging/darwin/aarch64/1.0.0", {
          [INSTALL_ID_HEADER]: id,
        });
        if (res.status === 200) out.add(id);
      }
      return out;
    };
    const ten = await offeredIds(10);
    expect(await offeredIds(10)).toEqual(ten);
    const fifty = await offeredIds(50);
    for (const id of ten) expect(fifty.has(id)).toBe(true);
    expect(fifty.size).toBeGreaterThan(ten.size);
  });

  it("buckets an install without an id by its IP", async () => {
    const config = { "channel:staging": JSON.stringify({ rollout: 50, paused: false }) };
    const { call } = setup({ files: STAGING, config });
    const ip = { "cf-connecting-ip": "203.0.113.7" };
    const a = await call("/desktop/staging/darwin/aarch64/1.0.0", ip);
    const b = await call("/desktop/staging/darwin/aarch64/1.0.0", ip);
    expect(a.status).toBe(b.status);
    const expected = (await rolloutBucket("ip:203.0.113.7", "1.1.0-rc.12")) < 50 ? 200 : 204;
    expect(a.status).toBe(expected);
  });

  it("ignores a malformed install id instead of trusting it", async () => {
    const config = { "channel:staging": JSON.stringify({ rollout: 50, paused: false }) };
    const { call } = setup({ files: STAGING, config });
    const headers = { [INSTALL_ID_HEADER]: "../../etc", "cf-connecting-ip": "203.0.113.7" };
    const expected = (await rolloutBucket("ip:203.0.113.7", "1.1.0-rc.12")) < 50 ? 200 : 204;
    expect((await call("/desktop/staging/darwin/aarch64/1.0.0", headers)).status).toBe(expected);
  });
});

describe("channel manifest", () => {
  it("serves the current manifest per channel, uncached", async () => {
    const { call } = setup({ files: STAGING });
    const res = await call("/desktop/staging/latest.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(((await res.json()) as { version: string }).version).toBe("1.1.0-rc.12");
    expect((await setup().call("/desktop/staging/latest.json")).status).toBe(404);
    expect((await call("/desktop/nightly/latest.json")).status).toBe(404);
  });
});

describe("downloads", () => {
  const files = { "desktop/staging/1.1.0-rc.12/Moduo_universal.dmg": "dmg-bytes" };

  it("streams a versioned file with immutable caching", async () => {
    const { call } = setup({ files });
    const res = await call("/download/desktop/staging/1.1.0-rc.12/Moduo_universal.dmg");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("dmg-bytes");
    expect(res.headers.get("content-type")).toBe("application/x-apple-diskimage");
    expect(res.headers.get("cache-control")).toContain("immutable");
    const head = await call(
      "/download/desktop/staging/1.1.0-rc.12/Moduo_universal.dmg",
      {},
      "HEAD",
    );
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("9");
  });

  it("serves nothing outside desktop/<channel>/<version>/", async () => {
    const { call } = setup({ files: { ...files, "desktop/staging/latest.json": "{}" } });
    expect((await call("/download/desktop/staging/1.1.0-rc.12/missing.dmg")).status).toBe(404);
    expect((await call("/download/desktop/staging/latest.json/x")).status).toBe(404);
    expect((await call("/download/desktop/staging/1.1.0-rc.12/..%2F..%2Flatest.json")).status).toBe(
      404,
    );
    expect((await call("/download/desktop/other/1.1.0-rc.12/Moduo_universal.dmg")).status).toBe(
      404,
    );
  });

  it("refuses writes", async () => {
    const { call } = setup({ files });
    expect((await call("/download/desktop/staging/1.1.0-rc.12/x.dmg", {}, "PUT")).status).toBe(405);
  });
});

describe("compareVersions", () => {
  it("follows semver precedence", () => {
    expect(compareVersions("1.1.0", "1.0.41")).toBe(1);
    expect(compareVersions("1.1.0-rc.12", "1.1.0-rc.9")).toBe(1);
    expect(compareVersions("1.1.0", "1.1.0-rc.99")).toBe(1);
    expect(compareVersions("1.1.0-rc.1", "1.0.22")).toBe(1);
    expect(compareVersions("1.1.0-rc", "1.1.0-rc.1")).toBe(-1);
    expect(compareVersions("1.1.0-rc.1", "1.1.0-beta.9")).toBe(1);
    expect(compareVersions("1.1.0+a", "1.1.0+b")).toBe(0);
    expect(compareVersions("1.1", "1.1.0")).toBeNull();
  });
});
