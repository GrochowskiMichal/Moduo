/**
 * Builds the static landing into apps/landing/dist, without building the app.
 *
 *   node build.mjs            → moduo.app (prod-landing): index, subpages, assets
 *   node build.mjs --staging  → staging.moduo.app (staging-landing): the staging
 *                               portal at /, the marketing page at /landing.html
 *
 * scripts/vercel-build.mjs copies dist/ over the app build until PLAT-5 moves
 * the landing to its own Worker.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, "dist");
const staging = process.argv.includes("--staging");

// Marketing subpages ride along on the public landing (staging keeps its portal at /).
// Each one also needs a host rewrite in vercel.json (/manifesto → /manifesto.html, …).
const SUBPAGES = ["manifesto.html", "privacy.html", "terms.html", "dpa.html", "aup.html"];

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

console.log(`[landing] Built ${staging ? "staging" : "prod"} landing → apps/landing/dist`);
