/**
 * CORS for the functions the signed-in app calls (MOD-75).
 *
 * Only Moduo's own pages may read these answers from a browser: the origin is
 * echoed back when it is one of ours, and left out otherwise, so the browser
 * refuses to hand a foreign page the response. A preflight from a foreign origin
 * gets 403 and never reaches the function. Every answer carries Vary: Origin, so
 * a cache never serves one origin's headers to another.
 *
 * Requests with no Origin (curl, servers, OAuth redirects a browser follows as a
 * top-level navigation) are untouched: CORS only governs what a page may read.
 * The real gate stays the person's JWT, which every one of these functions checks.
 *
 * Public functions (notes-public, booking-public, waitlist-join, moduo-mcp) keep
 * their own CORS: a published note, a booking page or an MCP client may sit on
 * any origin. cors.test.ts holds the list and fails when a new function answers "*".
 */

import { APP_ORIGINS } from "./app-origin.ts";

/** The desktop webview: tauri://localhost on macOS and Linux, http(s)://tauri.localhost on Windows. */
export const DESKTOP_ORIGINS: readonly string[] = [
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
];

/**
 * PR previews and versions of the staging app Worker (pr-<n>-moduo-app-staging…,
 * <version>-moduo-app-staging…), and the Worker's own workers.dev address. They
 * share the hosted backend (docs/decisions/workflow.md, PLAT-4).
 */
const PREVIEW_ORIGIN = /^https:\/\/(?:[a-z0-9-]+-)?moduo-app-staging\.moduo\.workers\.dev$/;

/** Any dev server on this machine: 8081, a worktree's own port, Storybook, e2e. */
const LOOPBACK_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;

/** True when `origin` (an Origin header value) is a page of the Moduo app. */
export function isAppOrigin(origin: string | null | undefined): origin is string {
  if (!origin) return false;
  return (
    APP_ORIGINS.includes(origin) ||
    DESKTOP_ORIGINS.includes(origin) ||
    PREVIEW_ORIGIN.test(origin) ||
    LOOPBACK_ORIGIN.test(origin)
  );
}

export type AppCorsOptions = {
  /** Access-Control-Allow-Methods, e.g. "POST, OPTIONS". */
  methods: string;
  /** Access-Control-Allow-Headers: what the app's request sends, e.g. "authorization, content-type". */
  headers: string;
};

function addVaryOrigin(headers: Headers): void {
  const vary = headers.get("Vary");
  if (!vary) headers.set("Vary", "Origin");
  else if (!vary.split(",").some((v) => v.trim().toLowerCase() === "origin" || v.trim() === "*")) {
    headers.set("Vary", `${vary}, Origin`);
  }
}

/** The preflight answer: 204 with the echoed origin, 403 for a foreign one. */
export function appPreflight(req: Request, options: AppCorsOptions): Response {
  const origin = req.headers.get("Origin");
  const headers = new Headers({ Vary: "Origin" });
  if (origin !== null && !isAppOrigin(origin)) {
    return new Response(null, { status: 403, headers });
  }
  if (origin !== null) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", options.methods);
  headers.set("Access-Control-Allow-Headers", options.headers);
  return new Response(null, { status: 204, headers });
}

/**
 * `res` with this request's CORS headers: any Access-Control-Allow-Origin the
 * handler set is replaced. Builds a new Response, because Response.redirect's
 * headers are immutable.
 */
export function withAppCorsHeaders(req: Request, res: Response): Response {
  const origin = req.headers.get("Origin");
  const headers = new Headers(res.headers);
  headers.delete("Access-Control-Allow-Origin");
  if (isAppOrigin(origin)) headers.set("Access-Control-Allow-Origin", origin);
  addVaryOrigin(headers);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * Wraps a function's handler: answers the preflight, puts the CORS headers on
 * every answer, and turns a throw into a 500 that still carries them (without
 * them the browser reports a CORS error and hides the real failure).
 */
export function withAppCors(
  options: AppCorsOptions,
  handler: (req: Request) => Response | Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") return appPreflight(req, options);
    let res: Response;
    try {
      res = await handler(req);
    } catch (err) {
      console.error("[cors] handler threw:", err);
      res = Response.json({ error: "internal" }, { status: 500 });
    }
    return withAppCorsHeaders(req, res);
  };
}
