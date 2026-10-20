#!/usr/bin/env bun
/**
 * Import boundaries in apps/app/src (`bun run lint:boundaries`, part of verify).
 * Run from apps/app, like lint:tw.
 *
 *   runtime  The Supabase client lives behind the runtime port: only
 *            src/lib/runtime*.ts may import `lib/runtime.web`, `lib/runtime.db`
 *            or `@supabase/supabase-js`. Everyone else calls getRuntime().
 *   layers   src/lib/** never imports src/features/**: lib is the layer
 *            features build on, not the other way round.
 *
 * Tests and stories are exempt (they mock and fixture across layers). The
 * files that broke a rule when it was added are grandfathered in
 * scripts/check-boundaries.allow.ts; the check fails when an entry there is
 * stale (the file is gone or no longer breaks the rule), so the list only
 * shrinks.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { ALLOW_LAYERS, ALLOW_RUNTIME } from "./check-boundaries.allow";

export type Violation = { rule: "runtime" | "layers"; file: string; target: string };

const RUNTIME_ONLY = new Set(["src/lib/runtime.web", "src/lib/runtime.db"]);
const SUPABASE_JS = "@supabase/supabase-js";

const IMPORT_RE = [
  // import x from "a" · import type { x } from "a" · export { x } from "a"
  /(?:^|[\s;}])(?:import|export)\s[^'"`;]*?\sfrom\s*["']([^"']+)["']/g,
  // import "a" (side effect)
  /(?:^|[\s;])import\s*["']([^"']+)["']/g,
  // import("a") (dynamic)
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

const toPosix = (p: string) => p.split(path.sep).join("/");

/** Every module specifier a file imports (comments stripped first). */
export function importsOf(content: string): string[] {
  const code = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  for (const re of IMPORT_RE) {
    re.lastIndex = 0;
    for (const m of code.matchAll(re)) out.push(m[1]);
  }
  return out;
}

/** A specifier as an app-relative module path without extension (`src/lib/x`), or null. */
export function resolveSpec(file: string, spec: string): string | null {
  let target: string;
  if (spec.startsWith("@/")) target = `src/${spec.slice(2)}`;
  else if (spec.startsWith(".")) target = toPosix(path.posix.join(path.posix.dirname(file), spec));
  else return null;
  return target.replace(/\.(tsx?|jsx?)$/, "").replace(/\/index$/, "");
}

const isExempt = (file: string) => /\.(test|spec|stories)\.tsx?$/.test(file);
const isRuntimeFile = (file: string) => /^src\/lib\/runtime[^/]*\.ts$/.test(file);

/** The rules one file breaks (`file` is app-relative, posix). */
export function checkFile(file: string, content: string): Violation[] {
  if (isExempt(file)) return [];
  const out: Violation[] = [];
  for (const spec of importsOf(content)) {
    const target = resolveSpec(file, spec);
    if (!isRuntimeFile(file) && (spec === SUPABASE_JS || (target && RUNTIME_ONLY.has(target)))) {
      out.push({ rule: "runtime", file, target: target ?? spec });
    }
    if (file.startsWith("src/lib/") && target?.startsWith("src/features/")) {
      out.push({ rule: "layers", file, target });
    }
  }
  return out;
}

/** `runtime` is grandfathered per file; `layers` per file → target pair. */
export const keyOf = (v: Violation) => (v.rule === "runtime" ? v.file : `${v.file} -> ${v.target}`);

export function compare(
  violations: Violation[],
  allow: { runtime: readonly string[]; layers: readonly string[] },
): { fresh: Violation[]; stale: Array<{ rule: Violation["rule"]; entry: string }> } {
  const seen = { runtime: new Set<string>(), layers: new Set<string>() };
  const fresh: Violation[] = [];
  for (const v of violations) {
    const key = keyOf(v);
    seen[v.rule].add(key);
    if (!allow[v.rule].includes(key)) fresh.push(v);
  }
  const stale = (["runtime", "layers"] as const).flatMap((rule) =>
    allow[rule].filter((entry) => !seen[rule].has(entry)).map((entry) => ({ rule, entry })),
  );
  return { fresh, stale };
}

const FIX: Record<Violation["rule"], string> = {
  runtime:
    "Only src/lib/runtime*.ts may talk to Supabase. Call getRuntime() (src/lib/runtime.ts) and, if the method is missing, add it to the port (lib/runtime.types.ts) and implement it in runtime.web.ts.",
  layers:
    "src/lib must not import src/features. Move the shared code down into src/lib (as timestampMicros moved to lib/sync/stamps.ts), or have the feature pass it in.",
};

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

async function main() {
  const root = process.cwd();
  const violations: Violation[] = [];
  for (const full of await walk(path.join(root, "src"))) {
    const file = toPosix(path.relative(root, full));
    violations.push(...checkFile(file, await fs.readFile(full, "utf8")));
  }
  const { fresh, stale } = compare(violations, { runtime: ALLOW_RUNTIME, layers: ALLOW_LAYERS });
  if (!fresh.length && !stale.length) {
    console.log("lint:boundaries — imports stay inside their layers.");
    return;
  }
  for (const rule of ["runtime", "layers"] as const) {
    const hits = fresh.filter((v) => v.rule === rule);
    if (!hits.length) continue;
    console.error(`\nlint:boundaries — ${rule}: ${hits.length} new import(s) across a boundary:`);
    for (const v of hits) console.error(`  ${v.file}  imports  ${v.target}`);
    console.error(`  Fix: ${FIX[rule]}`);
  }
  if (stale.length) {
    console.error(`\nlint:boundaries — ${stale.length} stale grandfather entr(y/ies):`);
    for (const s of stale) console.error(`  ${s.rule}: ${s.entry}`);
    console.error(
      "  Fix: the import is gone, well done. Delete these lines from scripts/check-boundaries.allow.ts.",
    );
  }
  process.exit(1);
}

if (import.meta.main) await main();
