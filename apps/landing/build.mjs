/**
 * Builds the static landing into apps/landing/dist, without building the app.
 *
 *   node build.mjs             → moduo.app: index, subpages, assets, favicons
 *   node build.mjs --staging   → staging.moduo.app: the staging portal at /, the
 *                                marketing page at /landing (noindex)
 *   node build.mjs --noindex   → the moduo.app build for a PR preview, never indexed
 *
 * dist/ is what the landing Worker serves (wrangler.jsonc), with _headers.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, "dist");
const staging = process.argv.includes("--staging");
const noindex = staging || process.argv.includes("--noindex");

// Marketing subpages ride along on the public landing (staging keeps its portal at /).
// The Worker serves each at its clean URL (/manifesto → manifesto.html).
const SUBPAGES = ["manifesto.html", "privacy.html", "terms.html", "dpa.html", "aup.html"];
const FAVICONS = ["favicon.ico", "favicon.svg", "favicon-32x32.png", "apple-touch-icon.png"];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

if (staging) {
  fs.copyFileSync(path.join(root, "staging.html"), path.join(outDir, "index.html"));
  // Staging keeps its portal at /, so the marketing page is published for review at
  // /landing.html (never indexed) before it's promoted to prod-landing.
  let page = fs.readFileSync(path.join(root, "index.html"), "utf8");
  if (!/name="robots"/.test(page)) {
    page = page.replace("<head>", '<head>\n    <meta name="robots" content="noindex, nofollow" />');
  }
  fs.writeFileSync(path.join(outDir, "landing.html"), page);
} else {
  fs.copyFileSync(path.join(root, "index.html"), path.join(outDir, "index.html"));
  for (const page of SUBPAGES) {
    fs.copyFileSync(path.join(root, page), path.join(outDir, page));
  }
}

// The landing's own static files (share image, founder photos, …) go to /assets.
const assets = path.join(root, "assets");
if (fs.existsSync(assets)) fs.cpSync(assets, path.join(outDir, "assets"), { recursive: true });

// The pages link the app's favicons at the root; the landing Worker serves its own copies.
const appPublic = path.join(root, "..", "app", "public");
for (const icon of FAVICONS) fs.copyFileSync(path.join(appPublic, icon), path.join(outDir, icon));

// Response headers for the Worker. Staging and previews are never indexed.
let headers = fs.readFileSync(path.join(root, "_headers"), "utf8");
if (noindex) {
  const marked = headers.replace(/^\/\*\r?\n/m, "/*\n  X-Robots-Tag: noindex, nofollow\n");
  if (marked === headers) throw new Error("[landing] _headers has no /* rule for X-Robots-Tag");
  headers = marked;
}
fs.writeFileSync(path.join(outDir, "_headers"), headers);

console.log(
  `[landing] Built ${staging ? "staging" : "prod"} landing${noindex ? " (noindex)" : ""} → apps/landing/dist`,
);
