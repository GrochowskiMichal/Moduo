import { describe, expect, it } from "@rstest/core";

import { smoke } from "./smoke-hosting";

const SEC = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Content-Security-Policy-Report-Only": "default-src 'self'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=()",
};
const SHELL =
  '<html><head><script>window.__MODUO_CONFIG__={"supabaseUrl":"https://x.supabase.co"};</script><script defer src="/static/js/index.abc.js"></script></head></html>';

type Host = { spaForMissingStatic?: boolean; immutablePush?: boolean; oldGone?: boolean };

function host(h: Host = {}) {
  return async (url: string) => {
    const path = new URL(url).pathname;
    const html = () =>
      new Response(SHELL, {
        headers: { ...SEC, "Content-Type": "text/html", "Cache-Control": "no-cache" },
      });
    const js = (cache: string) =>
      new Response("x", {
        headers: { ...SEC, "Content-Type": "application/javascript", "Cache-Control": cache },
      });
    if (path === "/config.json")
      return Response.json({ supabaseUrl: "https://x.supabase.co" }, { headers: SEC });
    if (path === "/static/js/index.abc.js") return js("public, max-age=31536000, immutable");
    if (path === "/static/js/async/old.123.js")
      return h.oldGone ? new Response("", { status: 404 }) : js("immutable");
    if (path.startsWith("/static/"))
      return h.spaForMissingStatic ? html() : new Response("Not found", { status: 404 });
    if (path === "/push-sw.js" || path === "/push-display.js")
      return js(h.immutablePush ? "immutable" : "no-cache");
    return html();
  };
}

describe("smoke-hosting (AC6, AC8, AC9)", () => {
  it("a correct host passes every check", async () => {
    const checks = await smoke("https://h.example/", {
      fetchFn: host(),
      old: ["/static/js/async/old.123.js"],
      expect: { supabaseUrl: "https://x.supabase.co" },
    });
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.length).toBe(8);
  });

  it("catches the SPA shell served for a missing chunk, an immutable service worker, a lost old chunk", async () => {
    const checks = await smoke("https://h.example", {
      fetchFn: host({ spaForMissingStatic: true, immutablePush: true, oldGone: true }),
      old: ["/static/js/async/old.123.js"],
      expect: { supabaseUrl: "https://other.supabase.co" },
    });
    const failed = checks.filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toEqual([
      "GET /config.json",
      "GET missing /static/* file",
      "GET /push-sw.js",
      "GET /push-display.js",
      "previous build's files (1 sampled)",
    ]);
  });
});
