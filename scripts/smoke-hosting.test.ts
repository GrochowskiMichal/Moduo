import { describe, expect, it } from "@rstest/core";

import { smoke, smokeLanding } from "./smoke-hosting";

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

const LANDING =
  '<html><head><title>Moduo · Home</title><link rel="canonical" href="https://moduo.app/" /></head></html>';

type LandingHost = { bookToLanding?: boolean; legalFallsBack?: boolean };

/** The landing Worker in front of the app Worker, as deployed. */
function landingHost(h: LandingHost = {}) {
  const app = host();
  return async (url: string) => {
    const path = new URL(url).pathname;
    const html = (body: string) =>
      new Response(body, { headers: { ...SEC, "Content-Type": "text/html" } });
    const appPath = path === "/book" || path.startsWith("/book/") || path.startsWith("/static/");
    if (appPath && !h.bookToLanding) return app(url);
    if (path === "/assets/og.png" || path === "/favicon.ico")
      return new Response("png", {
        headers: { ...SEC, "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
      });
    const legal = ["/manifesto", "/privacy", "/terms", "/dpa", "/aup"].includes(path);
    if (legal && !h.legalFallsBack)
      return html(`<html><head><title>${path} · Moduo</title></head></html>`);
    return html(LANDING);
  };
}

describe("smoke-hosting landing routes (AC10)", () => {
  it("a correct landing passes every check", async () => {
    const checks = await smokeLanding("https://moduo.app", "prod", { fetchFn: landingHost() });
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.map((c) => c.name)).toEqual([
      "GET /",
      "GET /manifesto",
      "GET /privacy",
      "GET /terms",
      "GET /dpa",
      "GET /aup",
      "GET /assets/og.png",
      "GET /favicon.ico",
      "GET /book/smoke-test",
      "GET /static/js/index.abc.js (booking)",
      "GET missing /static/* file",
    ]);
  });

  it("catches booking served by the landing and legal pages that fall back to the landing", async () => {
    const checks = await smokeLanding("https://moduo.app", "prod", {
      fetchFn: landingHost({ bookToLanding: true, legalFallsBack: true }),
    });
    const failed = checks.filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toEqual([
      "GET /manifesto",
      "GET /privacy",
      "GET /terms",
      "GET /dpa",
      "GET /aup",
      "GET /book/smoke-test",
      "GET /static/js/* (booking)",
      "GET missing /static/* file",
    ]);
  });

  it("staging wants the portal at / and a noindexed marketing page at /landing", async () => {
    const checks = await smokeLanding("https://staging.example", "staging", {
      fetchFn: landingHost(),
    });
    const failed = checks.filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toEqual(["GET /", "GET /landing"]);
  });
});
