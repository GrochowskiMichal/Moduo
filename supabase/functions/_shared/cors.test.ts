import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@rstest/core";

import { APP_ORIGINS } from "./app-origin.ts";
import { appPreflight, DESKTOP_ORIGINS, isAppOrigin, withAppCors } from "./cors.ts";

const OPTS = { methods: "POST, OPTIONS", headers: "authorization, content-type" };
const URL_ = "https://wtoonrvuqumihpkbvwvs.supabase.co/functions/v1/delete-account";

function req(method: string, origin?: string): Request {
  return new Request(URL_, { method, headers: origin ? { Origin: origin } : {} });
}

const ALLOWED = [
  ...APP_ORIGINS,
  ...DESKTOP_ORIGINS,
  "https://moduo-app-staging.moduo.workers.dev",
  "https://pr-875-moduo-app-staging.moduo.workers.dev",
  "https://3f2a9c1d-moduo-app-staging.moduo.workers.dev",
  "http://localhost:8081",
  "http://localhost:8449",
  "http://127.0.0.1:8449",
  "http://localhost:6006",
  "http://localhost",
];

const FOREIGN = [
  "https://evil.example",
  "https://app.moduo.app.evil.example",
  "https://evilapp.moduo.app",
  "https://app.moduo.app:8443",
  "http://app.moduo.app",
  "https://moduo.app", // the landing never calls these
  "https://moduo-app-staging.moduo.workers.dev.evil.example",
  "https://moduo-app-staging.evil.workers.dev",
  "https://pr-1-moduo-app-production.moduo.workers.dev",
  "https://evil.example/moduo-app-staging.moduo.workers.dev",
  "https://localhost:8081",
  "http://localhost.evil.example",
  "http://evil.localhost:8081",
  "http://127.0.0.2:8081",
  "http://localhost:8081.evil.example",
  "tauri://evil",
  "tauri://localhost.evil.example",
  "http://tauri.localhost.evil.example",
  "null",
  "file://",
  "",
];

describe("isAppOrigin", () => {
  it("accepts the web app, staging, previews, the desktop webview and local dev servers", () => {
    for (const origin of ALLOWED) expect([origin, isAppOrigin(origin)]).toEqual([origin, true]);
  });

  it("refuses every other origin, including look-alikes", () => {
    for (const origin of FOREIGN) expect([origin, isAppOrigin(origin)]).toEqual([origin, false]);
    expect(isAppOrigin(null)).toBe(false);
    expect(isAppOrigin(undefined)).toBe(false);
  });
});

describe("appPreflight", () => {
  it("echoes an app origin with the function's methods and headers", () => {
    const res = appPreflight(req("OPTIONS", "https://app.moduo.app"), OPTS);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.moduo.app");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("authorization, content-type");
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("refuses a foreign origin's preflight without any CORS grant", () => {
    const res = appPreflight(req("OPTIONS", "https://evil.example"), OPTS);
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Headers")).toBeNull();
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("answers an OPTIONS with no Origin (not a browser) without granting an origin", () => {
    const res = appPreflight(req("OPTIONS"), OPTS);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("withAppCors", () => {
  const ok = withAppCors(OPTS, () =>
    Response.json({ ok: true }, { headers: { "Access-Control-Allow-Origin": "*" } }),
  );

  it("never calls the handler for a preflight", async () => {
    let called = false;
    const handler = withAppCors(OPTS, () => {
      called = true;
      return new Response("x");
    });
    expect((await handler(req("OPTIONS", "https://app.moduo.app"))).status).toBe(204);
    expect((await handler(req("OPTIONS", "https://evil.example"))).status).toBe(403);
    expect(called).toBe(false);
  });

  it("echoes an app origin on the answer and drops a handler's \"*\"", async () => {
    for (const origin of ["https://app.moduo.app", "tauri://localhost", "http://tauri.localhost"]) {
      const res = await ok(req("POST", origin));
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(res.headers.get("Vary")).toBe("Origin");
      expect(await res.json()).toEqual({ ok: true });
    }
  });

  it("gives a foreign origin no Allow-Origin, so the browser hides the answer", async () => {
    const res = await ok(req("POST", "https://evil.example"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("leaves requests with no Origin working (curl, servers, OAuth redirects)", async () => {
    const res = await ok(req("POST"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await res.json()).toEqual({ ok: true });
  });

  it("keeps the status, body and other headers of error answers", async () => {
    const handler = withAppCors(OPTS, () =>
      Response.json({ error: "Unauthorized" }, { status: 401, headers: { "X-Extra": "1" } }),
    );
    const res = await handler(req("POST", "https://app.moduo.app"));
    expect(res.status).toBe(401);
    expect(res.headers.get("X-Extra")).toBe("1");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.moduo.app");
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("works on a redirect, whose headers are immutable", async () => {
    const handler = withAppCors(OPTS, () => Response.redirect("https://app.moduo.app/calendar?code=1", 302));
    const res = await handler(req("GET"));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://app.moduo.app/calendar?code=1");
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("turns a throw into a 500 the app can still read", async () => {
    const handler = withAppCors(OPTS, () => {
      throw new Error("boom");
    });
    const res = await handler(req("POST", "https://app.moduo.app"));
    expect(res.status).toBe(500);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.moduo.app");
    expect(await res.json()).toEqual({ error: "internal" });
  });

  it("adds Origin to an existing Vary instead of replacing it", async () => {
    const handler = withAppCors(OPTS, () => new Response("x", { headers: { Vary: "Accept-Encoding" } }));
    const res = await handler(req("POST", "https://app.moduo.app"));
    expect(res.headers.get("Vary")).toBe("Accept-Encoding, Origin");
  });
});

// Functions that may answer any origin: public pages and MCP clients live anywhere.
// A new function joins this list only on purpose; the rest go through withAppCors.
const PUBLIC_CORS = new Set(["booking-public", "notes-public", "moduo-mcp", "waitlist-join"]);
const FUNCTIONS_DIR = path.resolve(__dirname, "..");

/**
 * Ways a function answers any origin: the header set to "*" (object key, set() or append(), any
 * case), Supabase's own template (`corsHeaders` from supabase-js/cors), and @supabase/server's
 * withSupabase, whose default CORS is that template, unless it is turned off.
 */
const ANY_ORIGIN: RegExp[] = [
  /access-control-allow-origin["'`]?\s*[:,]\s*["'`]\*["'`]/i,
  /@supabase\/supabase-js\/cors/,
  /withSupabase\((?![^)]*cors:\s*["']disabled["'])/,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [full] : [];
  });
}

describe("no signed-in function answers any origin", () => {
  it("the any-origin patterns catch the usual ways of writing it", () => {
    const samples = [
      `const CORS = { "Access-Control-Allow-Origin": "*" };`,
      `headers.set("Access-Control-Allow-Origin", "*");`,
      `res.headers.append('access-control-allow-origin', '*')`,
      `import { corsHeaders } from "@supabase/supabase-js/cors";`,
      `Deno.serve(withSupabase({ auth: "user" }, handler));`,
    ];
    for (const src of samples) expect([src, ANY_ORIGIN.some((re) => re.test(src))]).toEqual([src, true]);
    const fine = [
      `headers.set("Access-Control-Allow-Origin", origin);`,
      `withSupabase({ auth: "user", cors: "disabled" }, handler)`,
    ];
    for (const src of fine) expect([src, ANY_ORIGIN.some((re) => re.test(src))]).toEqual([src, false]);
  });


  it('only the public functions send Access-Control-Allow-Origin: "*"', () => {
    const offenders = readdirSync(FUNCTIONS_DIR)
      .filter((name) => !name.startsWith(".") && statSync(path.join(FUNCTIONS_DIR, name)).isDirectory())
      .filter((name) => !PUBLIC_CORS.has(name))
      .flatMap((name) => sourceFiles(path.join(FUNCTIONS_DIR, name)))
      .filter((file) => ANY_ORIGIN.some((re) => re.test(readFileSync(file, "utf8"))))
      .map((file) => path.relative(FUNCTIONS_DIR, file));
    expect(offenders).toEqual([]);
  });

  it("every function that answers a browser preflight goes through withAppCors or is public", () => {
    const loose = readdirSync(FUNCTIONS_DIR)
      .filter((name) => !name.startsWith("_") && !name.startsWith(".") && !PUBLIC_CORS.has(name))
      .filter((name) => statSync(path.join(FUNCTIONS_DIR, name)).isDirectory())
      .filter((name) => {
        const src = sourceFiles(path.join(FUNCTIONS_DIR, name)).map((f) => readFileSync(f, "utf8")).join("\n");
        return /access-control-allow|["'`]OPTIONS["'`]/i.test(src) && !src.includes("Deno.serve(withAppCors(");
      });
    expect(loose).toEqual([]);
  });
});
