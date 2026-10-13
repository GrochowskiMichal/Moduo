/**
 * The notes-doc bundle's freshness key: a hash over the app source files it
 * was built from plus the exact Lexical / Yjs versions. Used by the build
 * script (writes it into the bundle header) and by the drift test (recomputes
 * it). Node-only; never imported by the Edge Function.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PACKAGES = [
  "lexical",
  "@lexical/yjs",
  "@lexical/markdown",
  "@lexical/headless",
  "@lexical/list",
  "@lexical/table",
  "@lexical/rich-text",
  "@lexical/link",
  "@lexical/code",
  "yjs",
  "y-protocols",
  "lib0",
];

export function notesDocSourceHash(root: string, inputs: string[]): string {
  const h = createHash("sha256");
  for (const path of inputs.filter((p) => !p.includes("node_modules")).sort()) {
    h.update(path);
    h.update(readFileSync(resolve(root, path)));
  }
  for (const pkg of PACKAGES) {
    const meta = JSON.parse(readFileSync(resolve(root, "node_modules", pkg, "package.json"), "utf8"));
    h.update(`${pkg}@${meta.version}`);
  }
  return h.digest("hex").slice(0, 16);
}
