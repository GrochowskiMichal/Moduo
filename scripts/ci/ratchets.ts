/**
 * Size and complexity ratchets (HV-5, specs/harness-v3.md AC20). Two limits on source code:
 *
 *   size        a file over 32 KB (about 8K tokens: an agent reads it in pieces and loses the thread)
 *   complexity  a function whose cognitive complexity is over 15 (SonarSource's metric and default)
 *
 * What was over a limit on 2026-10-23 is frozen in `ratchets.baseline.json` at that value. A
 * frozen file or function may shrink but not grow; anything new over a limit fails. Fix a failure
 * by splitting the file or function. Raising a baseline value is a deliberate, reviewed edit to the
 * JSON (it is on the Tier 2 path list), never something a script does.
 *
 * Complexity is scored per function, without the functions nested inside it (each of those is
 * scored on its own), so a React component is not charged for its callbacks. A function is named
 * by its enclosing names, e.g. `TaskRow>useEffect(cb)`; a second one with the same name gets `#2`.
 * Written in erasable TypeScript only, so `node` (type stripping) and `bun` both run it.
 *
 * CLI:
 *   bun scripts/ci/ratchets.ts            check tracked and new files against the baseline
 *   bun scripts/ci/ratchets.ts --tighten  lower the baseline to today's values (never raises any)
 *   bun scripts/ci/ratchets.ts --freeze   rewrite the baseline from today's tree (HV-5 only; a
 *                                         re-freeze is a CTO call, visible in the diff)
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseSync } from "oxc-parser";

export const SIZE_LIMIT = 32 * 1024;
export const COMPLEXITY_LIMIT = 15;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASELINE = path.join(ROOT, "scripts/ci/ratchets.baseline.json");

const SIZE_FILES = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|rs|css|sh)$/;
const COMPLEXITY_FILES = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
// Generated, vendored, throwaway or append-only history: not code anyone splits.
const EXCLUDED =
  /^(\.design|storybook-static|scripts\/spikes|supabase\/migrations)\/|\.d\.[cm]?ts$|__snapshots__\/|\/notes-doc\.bundle\.js$|^apps\/app\/src\/types\/supabase\.ts$|(^|\/)node_modules\/|(^|\/)dist\//;
const TEST = /\.(test|spec)\.[cm]?[jt]sx?$|^e2e\//;

export function sizeChecked(file: string): boolean {
  return SIZE_FILES.test(file) && !EXCLUDED.test(file);
}

export function complexityChecked(file: string): boolean {
  return COMPLEXITY_FILES.test(file) && !EXCLUDED.test(file) && !TEST.test(file);
}

// ── Cognitive complexity ────────────────────────────────────────────────────────────────────

// An ESTree node from oxc; only `type` is common to all of them.
type Node = any;

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);
const LOOP_TYPES = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
]);

function isNode(v: unknown): v is Node {
  return typeof v === "object" && v !== null && typeof (v as Node).type === "string";
}

function children(node: Node): Node[] {
  const out: Node[] = [];
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "range") continue;
    const v = node[key];
    if (Array.isArray(v)) out.push(...v.filter(isNode));
    else if (isNode(v)) out.push(v);
  }
  return out;
}

function isLogical(node: Node): boolean {
  return node?.type === "LogicalExpression";
}

/** Operators of a chain of logical expressions, left to right (`a && b || c` → `&&`, `||`). */
function logicalOperators(node: Node, out: string[] = []): string[] {
  if (!isLogical(node)) return out;
  logicalOperators(node.left, out);
  out.push(node.operator);
  logicalOperators(node.right, out);
  return out;
}

function logicalLeaves(node: Node, out: Node[] = []): Node[] {
  if (!isLogical(node)) {
    out.push(node);
    return out;
  }
  logicalLeaves(node.left, out);
  logicalLeaves(node.right, out);
  return out;
}

/** Cognitive complexity of one function body, not counting the functions nested in it. */
export function complexityOf(fn: Node): number {
  let score = 0;
  const visit = (node: Node, nesting: number, elseIf = false): void => {
    if (!isNode(node) || FUNCTION_TYPES.has(node.type)) return;
    switch (node.type) {
      case "IfStatement": {
        score += elseIf ? 1 : 1 + nesting;
        visit(node.test, nesting);
        visit(node.consequent, nesting + 1);
        const alt = node.alternate;
        if (alt?.type === "IfStatement") visit(alt, nesting, true);
        else if (alt) {
          score += 1;
          visit(alt, nesting + 1);
        }
        return;
      }
      case "ConditionalExpression":
        score += 1 + nesting;
        visit(node.test, nesting);
        visit(node.consequent, nesting + 1);
        visit(node.alternate, nesting + 1);
        return;
      case "SwitchStatement":
        score += 1 + nesting;
        visit(node.discriminant, nesting);
        for (const c of node.cases) visit(c, nesting + 1);
        return;
      case "CatchClause":
        score += 1 + nesting;
        visit(node.body, nesting + 1);
        return;
      case "BreakStatement":
      case "ContinueStatement":
        if (node.label) score += 1;
        return;
      case "LogicalExpression": {
        // +1 per run of the same operator: `a && b && c` is 1, `a && b || c` is 2.
        const ops = logicalOperators(node);
        score += ops.filter((op, i) => op !== ops[i - 1]).length;
        for (const leaf of logicalLeaves(node)) visit(leaf, nesting);
        return;
      }
    }
    if (LOOP_TYPES.has(node.type)) {
      score += 1 + nesting;
      for (const key of ["init", "test", "update", "left", "right"]) visit(node[key], nesting);
      visit(node.body, nesting + 1);
      return;
    }
    for (const c of children(node)) visit(c, nesting);
  };
  visit(fn.body, 0);
  return score;
}

function keyName(key: Node): string | null {
  if (!key) return null;
  if (key.type === "Identifier" || key.type === "PrivateIdentifier") return key.name;
  if (key.type === "Literal") return String(key.value);
  return null;
}

function exprName(node: Node): string | null {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "ThisExpression") return "this";
  if (node.type === "MemberExpression" && !node.computed) {
    const obj = exprName(node.object);
    const prop = keyName(node.property);
    return obj && prop ? `${obj}.${prop}` : prop;
  }
  return null;
}

/** A function's own name, from the node itself or from where it sits. */
function ownName(fn: Node, parent: Node, className: string | null): string {
  if (fn.id?.name) return fn.id.name;
  switch (parent?.type) {
    case "VariableDeclarator":
      return keyName(parent.id) ?? "<anonymous>";
    case "MethodDefinition":
    case "PropertyDefinition":
    case "Property": {
      const k = keyName(parent.key) ?? "<computed>";
      return className ? `${className}.${k}` : k;
    }
    case "AssignmentExpression":
      return exprName(parent.left) ?? "<anonymous>";
    case "CallExpression":
    case "NewExpression":
      return `${exprName(parent.callee) ?? "<call>"}(cb)`;
    case "ExportDefaultDeclaration":
      return "default";
    default:
      return "<anonymous>";
  }
}

export interface FunctionScore {
  name: string;
  line: number;
  score: number;
}

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

/** Every function in a file with its cognitive complexity. */
export function scoreFunctions(file: string, source: string): FunctionScore[] {
  const { program, errors } = parseSync(file, source);
  if (errors.length > 0 && !program?.body?.length) return [];
  const out: FunctionScore[] = [];
  const seen = new Map<string, number>();
  const walk = (node: Node, parent: Node, scope: string[], className: string | null) => {
    if (!isNode(node)) return;
    let nextScope = scope;
    let nextClass = className;
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      nextClass =
        node.id?.name ?? (parent?.type === "VariableDeclarator" ? keyName(parent.id) : null);
    }
    if (FUNCTION_TYPES.has(node.type)) {
      const base = [...scope, ownName(node, parent, className)].join(">");
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const name = n === 1 ? base : `${base}#${n}`;
      out.push({ name, line: lineAt(source, node.start), score: complexityOf(node) });
      nextScope = [...scope, ownName(node, parent, className)];
      nextClass = null;
    }
    for (const c of children(node)) walk(c, node, nextScope, nextClass);
  };
  walk(program, null, [], null);
  return out;
}

// ── Baseline and check ──────────────────────────────────────────────────────────────────────

export interface Baseline {
  sizeLimit: number;
  complexityLimit: number;
  /** File → bytes, for files over the size limit. */
  size: Record<string, number>;
  /** File → function name → score, for functions over the complexity limit. */
  complexity: Record<string, Record<string, number>>;
}

export interface Measured {
  size: Record<string, number>;
  complexity: Record<string, Record<string, number>>;
  lines: Record<string, Record<string, number>>;
}

export interface Violation {
  kind: "size" | "complexity";
  file: string;
  fn?: string;
  line?: number;
  value: number;
  /** The frozen value, or null for a new violation. */
  frozen: number | null;
}

/** Measures the given files and keeps only what is over a limit. */
export function measure(files: { path: string; source: string }[]): Measured {
  const m: Measured = { size: {}, complexity: {}, lines: {} };
  for (const { path: file, source } of files) {
    if (sizeChecked(file)) {
      const bytes = Buffer.byteLength(source);
      if (bytes > SIZE_LIMIT) m.size[file] = bytes;
    }
    if (complexityChecked(file)) {
      for (const f of scoreFunctions(file, source)) {
        if (f.score <= COMPLEXITY_LIMIT) continue;
        (m.complexity[file] ??= {})[f.name] = f.score;
        (m.lines[file] ??= {})[f.name] = f.line;
      }
    }
  }
  return m;
}

export function check(measured: Measured, baseline: Baseline): Violation[] {
  const out: Violation[] = [];
  for (const [file, bytes] of Object.entries(measured.size)) {
    const frozen = baseline.size[file] ?? null;
    if (frozen === null || bytes > frozen) out.push({ kind: "size", file, value: bytes, frozen });
  }
  for (const [file, fns] of Object.entries(measured.complexity)) {
    for (const [fn, score] of Object.entries(fns)) {
      const frozen = baseline.complexity[file]?.[fn] ?? null;
      if (frozen === null || score > frozen)
        out.push({
          kind: "complexity",
          file,
          fn,
          line: measured.lines[file]?.[fn],
          value: score,
          frozen,
        });
    }
  }
  return out;
}

/** The baseline lowered to today's values: shrunk entries go down, fixed ones disappear. */
export function tighten(measured: Measured, baseline: Baseline): Baseline {
  const size: Baseline["size"] = {};
  for (const [file, frozen] of Object.entries(baseline.size)) {
    const now = measured.size[file];
    if (now !== undefined) size[file] = Math.min(now, frozen);
  }
  const complexity: Baseline["complexity"] = {};
  for (const [file, fns] of Object.entries(baseline.complexity)) {
    for (const [fn, frozen] of Object.entries(fns)) {
      const now = measured.complexity[file]?.[fn];
      if (now !== undefined) (complexity[file] ??= {})[fn] = Math.min(now, frozen);
    }
  }
  return { ...baseline, size, complexity };
}

function sorted<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

function serialize(b: Baseline): string {
  const complexity = sorted(
    Object.fromEntries(Object.entries(b.complexity).map(([f, fns]) => [f, sorted(fns)])),
  );
  return `${JSON.stringify({ ...b, size: sorted(b.size), complexity }, null, 2)}\n`;
}

function repoFiles(): { path: string; source: string }[] {
  // Tracked plus new, not ignored, files: a new oversized file fails before it is committed.
  const list = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  )
    .split("\0")
    .filter((f) => f && (sizeChecked(f) || complexityChecked(f)));
  return [...new Set(list)].flatMap((f) => {
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) return []; // deleted in the working tree
    return [{ path: f, source: fs.readFileSync(abs, "utf8") }];
  });
}

function describe(v: Violation): string {
  const where = v.kind === "size" ? v.file : `${v.file}:${v.line ?? 1} ${v.fn}`;
  const unit = v.kind === "size" ? `${(v.value / 1024).toFixed(1)} KB` : `complexity ${v.value}`;
  const limit = v.kind === "size" ? `${SIZE_LIMIT / 1024} KB` : `${COMPLEXITY_LIMIT}`;
  if (v.frozen === null) return `${where}: ${unit}, over the ${limit} limit (new)`;
  const was = v.kind === "size" ? `${(v.frozen / 1024).toFixed(1)} KB` : `${v.frozen}`;
  return `${where}: ${unit}, grew past its frozen ${was}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const measured = measure(repoFiles());
  if (argv.includes("--freeze")) {
    const { lines: _lines, ...values } = measured;
    fs.writeFileSync(
      BASELINE,
      serialize({ sizeLimit: SIZE_LIMIT, complexityLimit: COMPLEXITY_LIMIT, ...values }),
    );
    const fns = Object.values(measured.complexity).reduce((n, f) => n + Object.keys(f).length, 0);
    console.log(`Froze ${Object.keys(measured.size).length} files and ${fns} functions.`);
    process.exit(0);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8")) as Baseline;
  if (argv.includes("--tighten")) {
    fs.writeFileSync(BASELINE, serialize(tighten(measured, baseline)));
    console.log("Baseline tightened to today's values.");
    process.exit(0);
  }
  const violations = check(measured, baseline);
  const annotate = process.env.GITHUB_ACTIONS === "true";
  for (const v of violations) {
    console.log(`✖ ${describe(v)}`);
    if (annotate)
      console.log(`::error file=${v.file},line=${v.line ?? 1}::Ratchet: ${describe(v)}`);
  }
  if (violations.length > 0) {
    console.log(
      "\nSplit the file or function. Frozen values live in scripts/ci/ratchets.baseline.json;" +
        " `--tighten` lowers them after a split.",
    );
    process.exit(1);
  }
  console.log("Ratchets hold: nothing new over 32 KB or complexity 15, nothing frozen grew.");
}
