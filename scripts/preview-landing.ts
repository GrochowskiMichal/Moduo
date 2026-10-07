/**
 * Local preview of the static landing, served the way Vercel ships it:
 *   /          → landing/index.html   (www.moduo.app, prod-landing)
 *   /staging   → landing/staging.html (staging.moduo.app, staging-landing)
 *   /manifesto → landing/manifesto.html
 *   /privacy   → landing/privacy.html
 *   /terms     → landing/terms.html
 *   /parked/x  → landing/parked/x.html (kept for later, never deployed)
 *
 * Usage: bun run preview:landing   (PORT=… to change the port)
 * Re-reads the file on every request — edit, then refresh.
 */

import path from "node:path";

const root = path.resolve(import.meta.dir, "..", "landing");
const port = Number(process.env.PORT ?? 8765);
// Marketing subpages, the way vercel.json rewrites them on moduo.app
const SUBPAGES: Record<string, string> = {
  "/manifesto": "manifesto.html",
  "/privacy": "privacy.html",
  "/terms": "terms.html",
};

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(req) {
    const { pathname } = new URL(req.url);
    // Static assets next to the page (share image etc.), shipped to /assets by vercel-build.
    if (pathname.startsWith("/assets/") && !pathname.includes("..")) {
      const asset = Bun.file(path.join(root, pathname));
      return asset
        .exists()
        .then((ok) =>
          ok
            ? new Response(asset, { headers: { "cache-control": "no-store" } })
            : new Response("Not found", { status: 404 }),
        );
    }
    // Parked pages (not deployed) preview at /parked/<name>
    const parked = pathname.match(/^\/parked\/([a-z0-9-]+)\/?$/);
    if (parked) {
      const page = Bun.file(path.join(root, "parked", `${parked[1]}.html`));
      return page.exists().then((ok) =>
        ok
          ? new Response(page, {
              headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
              },
            })
          : new Response("Not found", { status: 404 }),
      );
    }
    const subpage = SUBPAGES[pathname.replace(/\/$/, "")];
    if (subpage) {
      return new Response(Bun.file(path.join(root, subpage)), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    const file = pathname.replace(/\/$/, "") === "/staging" ? "staging.html" : "index.html";
    return new Response(Bun.file(path.join(root, file)), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  },
});

console.log(`Landing preview → http://${server.hostname}:${server.port}/`);
console.log(`Staging portal  → http://${server.hostname}:${server.port}/staging`);
console.log("Ctrl+C to stop.");
