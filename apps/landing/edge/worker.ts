// The landing's router Worker (apps/landing/wrangler.jsonc, specs/platform-v2.md PLAT-5).
//
// The landing is static files: Workers static assets serve them without this Worker. It runs only
// for the app's paths on the landing host (`run_worker_first`): /book, /book/* (public booking)
// and /static/* (the app shell's hashed files, which /book loads from the same host). Those go to
// the app Worker through the APP service binding, unchanged, so booking keeps its moduo.app
// address and the app Worker answers with its own shell, config and headers. A service binding
// is a call inside Cloudflare, not a network hop. Anything else that reaches the Worker goes back
// to the assets.

type Fetcher = { fetch(request: Request): Promise<Response> };

/** APP is missing only on the top-level (env-less) config, which is never deployed. */
export type Env = { ASSETS: Fetcher; APP?: Fetcher };

/** Paths the app Worker serves on the landing host. Keep in step with `run_worker_first`. */
export function isAppPath(pathname: string): boolean {
  return pathname === "/book" || pathname.startsWith("/book/") || pathname.startsWith("/static/");
}

export function handle(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (!isAppPath(pathname)) return env.ASSETS.fetch(request);
  if (!env.APP) {
    return Promise.resolve(
      new Response("Booking is not available on this host", {
        status: 502,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      }),
    );
  }
  return env.APP.fetch(request);
}

export default { fetch: handle };
