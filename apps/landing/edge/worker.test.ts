import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@rstest/core";

import { type Env, handle, isAppPath } from "./worker";

function recorder(name: string) {
  const seen: string[] = [];
  return {
    seen,
    fetcher: {
      async fetch(request: Request) {
        seen.push(new URL(request.url).pathname);
        return new Response(name, { headers: { "X-From": name } });
      },
    },
  };
}

describe("landing router", () => {
  it("sends booking and the app's hashed files to the app Worker", () => {
    for (const p of ["/book", "/book/", "/book/mike", "/book/cancel", "/static/js/index.1a2b.js"]) {
      expect(isAppPath(p)).toBe(true);
    }
  });

  it("keeps every other path on the landing", () => {
    for (const p of [
      "/",
      "/privacy",
      "/manifesto",
      "/assets/og.png",
      "/booking",
      "/books",
      "/statics",
      "/favicon.ico",
    ]) {
      expect(isAppPath(p)).toBe(false);
    }
  });

  it("forwards the original request, address included, to the app Worker", async () => {
    const app = recorder("app");
    const assets = recorder("assets");
    const env: Env = { ASSETS: assets.fetcher, APP: app.fetcher };
    const res = await handle(new Request("https://moduo.app/book/mike?d=2026-10-20"), env);
    expect(await res.text()).toBe("app");
    expect(app.seen).toEqual(["/book/mike"]);
    expect(assets.seen).toEqual([]);
  });

  it("serves the landing's own paths from the assets", async () => {
    const app = recorder("app");
    const assets = recorder("assets");
    const res = await handle(new Request("https://moduo.app/privacy"), {
      ASSETS: assets.fetcher,
      APP: app.fetcher,
    });
    expect(await res.text()).toBe("assets");
    expect(app.seen).toEqual([]);
  });

  it("answers 502, not the landing, when there is no app binding", async () => {
    const res = await handle(new Request("https://moduo.app/book/mike"), {
      ASSETS: recorder("assets").fetcher,
    });
    expect(res.status).toBe(502);
  });

  it("runs the Worker first for exactly the app paths", () => {
    const raw = readFileSync(path.join(import.meta.dirname, "..", "wrangler.jsonc"), "utf8");
    const json = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, "")) as {
      assets: { run_worker_first: string[] };
      env: Record<string, { services?: { binding: string; service: string }[] }>;
    };
    expect(json.assets.run_worker_first).toEqual(["/book", "/book/*", "/static/*"]);
    expect(json.env.staging?.services).toEqual([{ binding: "APP", service: "moduo-app-staging" }]);
    expect(json.env.production?.services).toEqual([
      { binding: "APP", service: "moduo-app-production" },
    ]);
  });
});
