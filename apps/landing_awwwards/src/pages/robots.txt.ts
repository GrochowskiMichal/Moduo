// robots.txt: open on moduo.app, closed on preview builds (PUBLIC_NOINDEX=1).
import type { APIRoute } from "astro";

export const GET: APIRoute = () => {
  const closed = import.meta.env.PUBLIC_NOINDEX === "1";
  const body = closed
    ? "User-agent: *\nDisallow: /\n"
    : "User-agent: *\nAllow: /\n\nSitemap: https://moduo.app/sitemap-index.xml\n";
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
