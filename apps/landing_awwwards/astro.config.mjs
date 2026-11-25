// moduo.app, the product site. Static output for Cloudflare Workers static assets
// (wrangler.jsonc): `format: "file"` writes privacy.html, and the Worker's html_handling
// serves it at /privacy, so canonical URLs carry no trailing slash.
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://moduo.app",
  trailingSlash: "never",
  build: { format: "file", inlineStylesheets: "auto" },
  integrations: [sitemap({ filter: (page) => !page.includes("/og/") && !page.endsWith("/modus") })],
  // The type page's first address, from before the typeface was named Oudom (DESIGN.md §16).
  redirects: { "/modus": "/typeface" },
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
  devToolbar: { enabled: false },
});
