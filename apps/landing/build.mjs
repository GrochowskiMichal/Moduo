/**
 * Builds what the landing Worker serves into apps/landing/dist.
 *
 * Since 2026-11-25 the pages are the product site in apps/landing_awwwards (Astro): this script
 * builds it and adds the files only this Worker carries (/assets, /.well-known). This folder keeps
 * the Worker (wrangler.jsonc, edge/ for /book), the legal pages and changelog.mjs the site reads,
 * and the staging portal.
 *
 *   node build.mjs             → moduo.app: the product site
 *   node build.mjs --staging   → staging.moduo.app: the staging portal at /, the site's home at
 *                                /landing and its other pages at their own paths (noindex)
 *   node build.mjs --noindex   → the moduo.app build for a PR preview, never indexed
 *
 * Needs `bun install` first (Astro). dist/ ends with _headers from the site's public/_headers.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(root, "..", "landing_awwwards");
const outDir = path.join(root, "dist");
const staging = process.argv.includes("--staging");
const noindex = staging || process.argv.includes("--noindex");

const built = spawnSync("bun", ["run", noindex ? "build:preview" : "build"], {
  cwd: site,
  stdio: "inherit",
});
if (built.status !== 0) throw new Error(`[landing] the site build failed (${built.status})`);

fs.rmSync(outDir, { recursive: true, force: true });
fs.cpSync(path.join(site, "dist"), outDir, { recursive: true });

if (staging) {
  // Staging keeps its portal at /; the site's home is reviewed at /landing before a release.
  fs.renameSync(path.join(outDir, "index.html"), path.join(outDir, "landing.html"));
  fs.copyFileSync(path.join(root, "staging.html"), path.join(outDir, "index.html"));
}

// This Worker's own files: the old share image and founder photos (/assets, still linked from
// outside) and /.well-known (microsoft-identity-association.json verifies moduo.app as the
// publisher of the Moduo app registration in Microsoft Entra, for Outlook Calendar).
for (const dir of ["assets", ".well-known"]) {
  const from = path.join(root, dir);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(outDir, dir), { recursive: true });
}

// Staging and previews are never indexed.
const headersFile = path.join(outDir, "_headers");
let headers = fs.readFileSync(headersFile, "utf8");
if (noindex) {
  const marked = headers.replace(/^\/\*\r?\n/m, "/*\n  X-Robots-Tag: noindex, nofollow\n");
  if (marked === headers) throw new Error("[landing] _headers has no /* rule for X-Robots-Tag");
  headers = marked;
}
fs.writeFileSync(headersFile, headers);

console.log(
  `[landing] Built ${staging ? "staging" : "prod"} landing${noindex ? " (noindex)" : ""} → apps/landing/dist`,
);
