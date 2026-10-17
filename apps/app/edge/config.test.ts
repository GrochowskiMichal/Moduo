import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@rstest/core";

import {
  configFromEnv,
  configScript,
  contentSecurityPolicy,
  IMMUTABLE,
  NO_CACHE,
  scriptHash,
  securityHeaders,
} from "./config";
import { type Env, handle, type InjectHead } from "./worker";

const SHELL =
  '<!doctype html><html><head><title>Moduo</title></head><body><div id="root"></div></body></html>';

// HTMLRewriter only exists in the Workers runtime; this does the same insert on the string.
const stringInject: InjectHead = (response, script) => {
  const body = response
    .text()
    .then((html) => html.replace("<head>", `<head><script>${script}</script>`));
  const stream = new ReadableStream({
    async start(c) {
      c.enqueue(new TextEncoder().encode(await body));
      c.close();
    },
  });
  return new Response(stream, response);
};

function assets(files: Record<string, string>) {
  const seen: Request[] = [];
  return {
    seen,
    fetch: async (request: Request) => {
      seen.push(request);
      const path = new URL(request.url).pathname;
      if (path in files) {
        return new Response(files[path], {
          headers: { "Content-Type": "application/javascript", ETag: '"js"' },
        });
      }
      // single-page-application: anything else is the shell
      return new Response(SHELL, {
        headers: { "Content-Type": "text/html; charset=utf-8", ETag: '"shell"' },
      });
    },
  };
}

const STAGING = {
  SUPABASE_URL: "https://staging-ref.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_staging",
  WEB_ORIGIN: "https://app.staging.moduo.app",
  STAGING_PORTAL: "true",
};
const PROD = {
  SUPABASE_URL: "https://prod-ref.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_prod",
  POSTHOG_KEY: "phc_prod",
  STRIPE_PUBLISHABLE_KEY: "pk_live_prod",
  VAPID_PUBLIC_KEY: "BProd",
  WEB_ORIGIN: "https://app.moduo.app",
};

function env(vars: Record<string, string>, files: Record<string, string> = {}) {
  const a = assets(files);
  return { env: { ...vars, ASSETS: a } as Env, assets: a };
}

function injected(html: string): Record<string, string> {
  const m = html.match(/<script>window\.__MODUO_CONFIG__=(.*?);<\/script>/);
  if (!m) throw new Error(`no config script in ${html}`);
  return JSON.parse(m[1]);
}

describe("injects per-host config (AC7)", () => {
  it("one shell, each environment's own values, written first in <head>", async () => {
    for (const [vars, expected] of [
      [
        STAGING,
        { supabaseUrl: STAGING.SUPABASE_URL, webOrigin: STAGING.WEB_ORIGIN, stagingPortal: "true" },
      ],
      [PROD, { supabaseUrl: PROD.SUPABASE_URL, posthogKey: "phc_prod", vapidPublicKey: "BProd" }],
    ] as const) {
      const { env: e } = env(vars);
      const res = await handle(new Request("https://host.example/tasks?id=MOD-1"), e, stringInject);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html.startsWith("<!doctype html><html><head><script>window.__MODUO_CONFIG__=")).toBe(
        true,
      );
      expect(injected(html)).toMatchObject(expected);
    }
  });

  it("a missing or empty var is left out, so the app keeps its build-time value", () => {
    expect(
      configFromEnv({ SUPABASE_URL: "https://x.supabase.co", POSTHOG_KEY: "  ", WEB_ORIGIN: "" }),
    ).toEqual({
      supabaseUrl: "https://x.supabase.co",
    });
    expect(configFromEnv({})).toEqual({});
  });

  it("no vars at all still serves the shell, with an empty config", async () => {
    const { env: e } = env({});
    const html = await (await handle(new Request("https://h.example/"), e, stringInject)).text();
    expect(injected(html)).toEqual({});
    expect(html).toContain('<div id="root"></div>');
  });

  it("a value can't close the script tag", () => {
    const script = configScript({ webOrigin: "</script><script>alert(1)</script>\u2028" });
    expect(script).not.toContain("</script>");
    expect(script).not.toContain("\u2028");
    const json = script.slice("window.__MODUO_CONFIG__=".length, -1);
    expect(JSON.parse(json).webOrigin).toBe("</script><script>alert(1)</script>\u2028");
  });

  it("/config.json serves the same config, revalidated", async () => {
    const { env: e } = env(PROD);
    const res = await handle(new Request("https://h.example/config.json"), e, stringInject);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Cache-Control")).toBe(NO_CACHE);
    expect(await res.json()).toEqual(configFromEnv(PROD));
  });
});

describe("HTML responses (AC9)", () => {
  it("are revalidated, carry the security headers, and the CSP allows exactly the injected script", async () => {
    const { env: e } = env(STAGING);
    const res = await handle(new Request("https://h.example/"), e, stringInject);
    expect(res.headers.get("Cache-Control")).toBe(NO_CACHE);
    expect(res.headers.get("ETag")).toBeNull();
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
    const hash = await scriptHash(configScript(configFromEnv(STAGING)));
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toContain(
      `script-src 'self' ${hash}`,
    );
  });

  it("always fetch the shell fresh from /, so a vars-only change is never hidden behind a 304", async () => {
    const { env: e, assets: a } = env(STAGING);
    await handle(
      new Request("https://h.example/tasks?id=1", { headers: { "If-None-Match": '"shell"' } }),
      e,
      stringInject,
    );
    expect(new URL(a.seen[0].url).pathname).toBe("/");
    expect(a.seen[0].headers.get("If-None-Match")).toBeNull();
  });

  it("a missing /static/* file is a 404, never the shell", async () => {
    const { env: e, assets: a } = env(STAGING);
    const res = await handle(
      new Request("https://h.example/static/js/async/gone.123.js"),
      e,
      stringInject,
    );
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("<html");
    expect(a.seen).toHaveLength(0);
  });

  it("only GET and HEAD get the shell", async () => {
    const { env: e } = env(STAGING);
    const res = await handle(
      new Request("https://h.example/tasks", { method: "POST" }),
      e,
      stringInject,
    );
    expect(res.status).toBe(405);
  });

  it("no shell in the build is a 502, not an empty page", async () => {
    const e = {
      ASSETS: { fetch: async () => new Response("", { status: 404 }) },
    } as unknown as Env;
    const res = await handle(new Request("https://h.example/"), e, stringInject);
    expect(res.status).toBe(502);
  });
});

describe("public/_headers matches the Worker", () => {
  const file = readFileSync(join(__dirname, "../public/_headers"), "utf8");
  function rule(path: string): Record<string, string> {
    const lines = file.split("\n");
    const start = lines.findIndex((l) => l.trim() === path);
    expect(start).toBeGreaterThanOrEqual(0);
    const out: Record<string, string> = {};
    for (const line of lines.slice(start + 1)) {
      if (!/^\s+\S/.test(line)) break;
      const i = line.indexOf(":");
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return out;
  }

  it("every response gets the same security headers", () => {
    expect(rule("/*")).toEqual(securityHeaders());
    expect(rule("/*")["Content-Security-Policy-Report-Only"]).toBe(contentSecurityPolicy());
  });

  it("hashed files are immutable; index.html and the push service workers revalidate", () => {
    expect(rule("/static/*")["Cache-Control"]).toBe(IMMUTABLE);
    for (const path of ["/index.html", "/push-sw.js", "/push-display.js"]) {
      expect(rule(path)["Cache-Control"]).toBe(NO_CACHE);
    }
  });
});

describe("wrangler.jsonc routes only the shell, /config.json and missing files through the Worker", () => {
  const raw = readFileSync(join(__dirname, "../wrangler.jsonc"), "utf8");
  const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ""));

  it("files are served without the Worker; the shell's two paths run it first", () => {
    // "single-page-application" would answer a missing /static/* file with the shell.
    expect(config.assets.not_found_handling).toBe("none");
    expect(config.assets.run_worker_first).toEqual(["/", "/index.html"]);
  });

  it("staging and production each set the Supabase pair", () => {
    for (const name of ["staging", "production"]) {
      const vars = config.env[name].vars;
      expect(vars.SUPABASE_URL).toMatch(/^https:\/\/[a-z]+\.supabase\.co$/);
      expect(vars.SUPABASE_PUBLISHABLE_KEY).toMatch(/^sb_publishable_/);
    }
  });
});
