#!/usr/bin/env bun
/**
 * Import boundaries in apps/app/src (`bun run lint:boundaries`, part of verify).
 * Run from apps/app, like lint:tw.
 *
 *   runtime  The Supabase client lives behind the runtime port: only
 *            src/lib/runtime*.ts may import `lib/runtime.web*` (the client is
 *            `lib/runtime.web.client`), `lib/runtime.db`
 *            or any `@supabase/*` package, or import values from the other
 *            runtime implementations (`lib/runtime.focus.web`, …; a type-only
 *            import is fine). `lib/runtime` and `lib/runtime.types` are the
 *            port and open to all. Everyone else calls getRuntime().
 *   layers   src/lib/** never imports src/features/**: lib is the layer
 *            features build on, not the other way round.
 *   tanstack TanStack DB (`@tanstack/db`, `@tanstack/react-db`) is reached
 *            only through src/lib/sync/tanstack/ (specs/tanstack-spine.md);
 *            TanStack Query and Store arrive as DB's dependencies and are
 *            never imported by app code.
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

export type Violation = { rule: "runtime" | "layers" | "tanstack"; file: string; target: string };

const RUNTIME_ONLY = new Set([
  "src/lib/runtime.web",
  "src/lib/runtime.web.client",
  "src/lib/runtime.db",
]);
const RUNTIME_PORT = new Set(["src/lib/runtime", "src/lib/runtime.types"]);

const TANSTACK_DB = /^@tanstack\/(?:react-)?db(?:\/|$)/;
const TANSTACK_BANNED = /^@tanstack\/(?:react-query|query-core|store|react-store)(?:\/|$)/;
const TANSTACK_HOME = "src/lib/sync/tanstack/";

const IMPORT_RE = [
  // import x from "a" · import type { x } from "a" · export { x } from "a"
  /(?:^|[\s;}])(?:import|export)\s[^'"`;]*?\sfrom\s*["']([^"']+)["']/g,
  // import "a" (side effect)
  /(?:^|[\s;])import\s*["']([^"']+)["']/g,
  // import("a") (dynamic)
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

const toPosix = (p: string) => p.split(path.sep).join("/");

export type Import = { spec: string; typeOnly: boolean };

/** Every module a file imports (comments stripped first); `typeOnly` for `import type`. */
export function importsOf(content: string): Import[] {
  const code = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out: Import[] = [];
  for (const re of IMPORT_RE) {
    re.lastIndex = 0;
    for (const m of code.matchAll(re)) {
      out.push({ spec: m[1], typeOnly: /^[\s;}]*(?:import|export)\s+type\s/.test(m[0]) });
    }
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
const isRuntimeFile = (file: string) => /^src\/lib\/runtime(?:\.[\w.-]+)?\.ts$/.test(file);

/** The rules one file breaks (`file` is app-relative, posix). */
export function checkFile(file: string, content: string): Violation[] {
  if (isExempt(file)) return [];
  const out: Violation[] = [];
  for (const { spec, typeOnly } of importsOf(content)) {
    const target = resolveSpec(file, spec);
    const runtimeImpl =
      !!target &&
      (RUNTIME_ONLY.has(target) ||
        (!typeOnly && /^src\/lib\/runtime\./.test(target) && !RUNTIME_PORT.has(target)));
    if (!isRuntimeFile(file) && (spec.startsWith("@supabase/") || runtimeImpl)) {
      out.push({ rule: "runtime", file, target: target ?? spec });
    }
    if (file.startsWith("src/lib/") && target?.startsWith("src/features/")) {
      out.push({ rule: "layers", file, target });
    }
    if (TANSTACK_BANNED.test(spec) || (TANSTACK_DB.test(spec) && !file.startsWith(TANSTACK_HOME))) {
      out.push({ rule: "tanstack", file, target: spec });
    }
  }
  return out;
}

/** `runtime` is grandfathered per file; `layers` per file → target pair; `tanstack` never. */
export const keyOf = (v: Violation) => (v.rule === "runtime" ? v.file : `${v.file} -> ${v.target}`);

export function compare(
  violations: Violation[],
  allow: { runtime: readonly string[]; layers: readonly string[]; tanstack?: readonly string[] },
): { fresh: Violation[]; stale: Array<{ rule: Violation["rule"]; entry: string }> } {
  const seen = {
    runtime: new Set<string>(),
    layers: new Set<string>(),
    tanstack: new Set<string>(),
  };
  const fresh: Violation[] = [];
  for (const v of violations) {
    const key = keyOf(v);
    seen[v.rule].add(key);
    if (!(allow[v.rule] ?? []).includes(key)) fresh.push(v);
  }
  const stale = (["runtime", "layers", "tanstack"] as const).flatMap((rule) =>
    (allow[rule] ?? []).filter((entry) => !seen[rule].has(entry)).map((entry) => ({ rule, entry })),
  );
  return { fresh, stale };
}

const FIX: Record<Violation["rule"], string> = {
  runtime:
    "Only src/lib/runtime*.ts may talk to Supabase. Call getRuntime() (src/lib/runtime.ts) and, if the method is missing, add it to that module port (lib/runtime.types.<module>.ts) and implement it in lib/runtime.web.<module>.ts.",
  layers:
    "src/lib must not import src/features. Move the shared code down into src/lib (as timestampMicros moved to lib/sync/stamps.ts), or have the feature pass it in.",
  tanstack:
    "Import TanStack DB only inside src/lib/sync/tanstack/ and expose what features need from there; TanStack Query and Store are not app APIs (specs/tanstack-spine.md).",
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
  for (const rule of ["runtime", "layers", "tanstack"] as const) {
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
