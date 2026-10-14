/**
 * The notes-doc bundle's freshness keys (NR-6). Used by the build script
 * (writes them into the bundle header) and by the drift test (recomputes
 * them). Node-only; never imported by the Edge Function.
 *
 * - source hash: the app source files the bundle was built from plus the
 *   exact version of every package that went into it;
 * - code hash: the bundle's own bytes, so a hand edit is caught too.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The npm package names among a build's inputs (`node_modules/<name>/…`). */
export function bundledPackages(inputs: string[]): string[] {
  const names = new Set<string>();
  for (const path of inputs) {
    const m = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(path);
    if (m?.[1]) names.add(m[1]);
  }
  return [...names].sort();
}

export function notesDocSourceHash(root: string, appFiles: string[], packages: string[]): string {
  const h = createHash("sha256");
  for (const path of [...appFiles].sort()) {
    h.update(path);
    h.update(readFileSync(resolve(root, path)));
  }
  for (const pkg of [...packages].sort()) {
    const meta = JSON.parse(readFileSync(resolve(root, "node_modules", pkg, "package.json"), "utf8"));
    h.update(`${pkg}@${meta.version}`);
  }
  return h.digest("hex").slice(0, 16);
}

export function notesDocCodeHash(code: string): string {
  return createHash("sha256").update(code).digest("hex").slice(0, 16);
}
