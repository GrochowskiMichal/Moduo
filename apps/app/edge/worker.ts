// The app's edge Worker (apps/app/wrangler.jsonc). A file that exists is
// served by Workers static assets and never reaches it. It runs for "/" and
// "/index.html" (`run_worker_first`) and for every path with no file, which
// is every app route, /config.json, and a missing file.
//
// - /config.json: this environment's public config as JSON, plus the live build id.
// - /static/* (no such file): a plain 404, never the shell, so a missing
//   chunk fails fast and the app's chunk-reload handler can act.
// - Anything else: the SPA shell (index.html from the assets binding) with
//   the config written into <head> as `window.__MODUO_CONFIG__` (no extra
//   request at boot), revalidated on every load, with the security headers.
//
// The Worker serves the shell itself, with `not_found_handling: "none"`:
// Cloudflare's single-page-application mode answers a missing /static/* file
// with the shell before the Worker can run (docs/decisions/workflow.md, PLAT-4).

import {
  type ConfigEnv,
  configFromEnv,
  configScript,
  NO_CACHE,
  scriptHash,
  securityHeaders,
} from "./config";

type Fetcher = { fetch(request: Request): Promise<Response> };

/** BUILD is the short commit SHA, set by the deploy (`--var BUILD:<sha>`), so the smoke test can tell which build is live. */
export type Env = ConfigEnv & { ASSETS: Fetcher; BUILD?: string };

/** Writes `script` as the first child of <head>. HTMLRewriter in production; tests pass a string version. */
export type InjectHead = (response: Response, script: string) => Response;

type HtmlRewriterElement = { prepend(content: string, options: { html: boolean }): unknown };
declare const HTMLRewriter: {
  new (): {
    on(
      selector: string,
      handlers: { element(el: HtmlRewriterElement): void },
    ): {
      transform(response: Response): Response;
    };
  };
};

const htmlRewriterInject: InjectHead = (response, script) =>
  new HTMLRewriter()
    .on("head", {
      element(el) {
        el.prepend(`<script>${script}</script>`, { html: true });
      },
    })
    .transform(response);

function withHeaders(response: Response, headers: Record<string, string>): Response {
  const out = new Response(response.body, response);
  for (const [name, val] of Object.entries(headers)) out.headers.set(name, val);
  return out;
}

export async function handle(request: Request, env: Env, inject: InjectHead): Promise<Response> {
  const url = new URL(request.url);
  const config = configFromEnv(env);

  if (url.pathname === "/config.json") {
    return new Response(JSON.stringify({ ...config, build: env.BUILD ?? "" }), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": NO_CACHE,
        ...securityHeaders(),
      },
    });
  }

  if (url.pathname.startsWith("/static/")) {
    return new Response("Not found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": NO_CACHE,
        ...securityHeaders(),
      },
    });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD", ...securityHeaders() },
    });
  }

  // Always the full shell, fetched fresh: a 304 against the file's ETag would
  // keep a stale config in the browser after a vars-only change, since the
  // file's ETag doesn't move. index.html is small. "/" is the shell
  // (html_handling redirects "/index.html" to it).
  const asset = await env.ASSETS.fetch(new Request(new URL("/", url), { method: request.method }));
  if (!asset.ok || !(asset.headers.get("Content-Type") ?? "").includes("text/html")) {
    return new Response("App shell missing", { status: 502 });
  }

  const script = configScript(config);
  const headers = { ...securityHeaders([await scriptHash(script)]), "Cache-Control": NO_CACHE };
  const out = withHeaders(inject(asset, script), headers);
  out.headers.delete("ETag");
  out.headers.delete("Content-Length");
  return out;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env, htmlRewriterInject);
  },
};
