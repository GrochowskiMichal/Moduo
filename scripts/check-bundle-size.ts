#!/usr/bin/env bun
/**
 * First-load JS budget (`bun run size` in apps/app, part of verify).
 * Run from apps/app after `rsbuild build` (MODUO_TARGET=web).
 *
 * First load = every script dist/web/index.html loads before the app can run
 * (its <script src> and <link rel="modulepreload">), gzipped at level 9 and
 * summed. Route chunks fetched later don't count. The budget is
 * `firstLoadGzipKB` in apps/app/bundle-budget.json: lower it when the bundle
 * shrinks; raise it only on purpose, saying why in the commit.
 */

import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

export function firstLoadScripts(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) out.add(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g)) {
    out.add(m[1]);
  }
  return [...out].filter((src) => !/^(?:https?:)?\/\//.test(src));
}

function main() {
  const root = process.cwd();
  const dist = path.join(root, "dist/web");
  const budget = JSON.parse(fs.readFileSync(path.join(root, "bundle-budget.json"), "utf8")) as {
    firstLoadGzipKB: number;
  };
  const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  const files = firstLoadScripts(html);
  let total = 0;
  for (const src of files) {
    const bytes = gzipSync(fs.readFileSync(path.join(dist, src.replace(/^\//, ""))), { level: 9 });
    total += bytes.length;
    console.log(`  ${(bytes.length / 1024).toFixed(1).padStart(8)} KB  ${src}`);
  }
  const kb = total / 1024;
  const line = `first-load JS ${kb.toFixed(1)} KB gzip (budget ${budget.firstLoadGzipKB} KB)`;
  if (kb > budget.firstLoadGzipKB) {
    console.error(`size — over budget: ${line}.`);
    console.error(
      "  Fix: lazy-load what the first screen doesn't need (a route chunk or a dynamic import), or raise firstLoadGzipKB in apps/app/bundle-budget.json on purpose.",
    );
    process.exit(1);
  }
  console.log(`size — ${line}.`);
}

if (import.meta.main) main();
