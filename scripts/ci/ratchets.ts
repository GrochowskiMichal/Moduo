/**
 * Size and complexity ratchets (HV-5, specs/harness-v3.md AC20). Two limits on source code:
 *
 *   size        a file over 32 KB (about 8K tokens: an agent reads it in pieces and loses the thread)
 *   complexity  a function whose cognitive complexity is over 15 (SonarSource's metric and default)
 *
 * What was over a limit on 2026-10-23 is frozen in `ratchets.baseline.json` at that value. A
 * frozen file may grow by at most 4 KB and a frozen function by 3 (the headroom below); anything
 * new over a limit fails. A frozen function keeps its value when it moves to another file. Fix a failure
 * by splitting the file or function. Raising a baseline value is a deliberate, reviewed edit to the
 * JSON (it is on the Tier 2 path list), never something a script does.
 *
 * Complexity is scored per function, without the functions nested inside it (each of those is
 * scored on its own), so a React component is not charged for its callbacks. A function is named
 * by its enclosing names, e.g. `TaskRow>useEffect(cb)`; a second one with the same name gets `#2`,
 * and same-named functions are compared by score, not by that number.
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
/**
 * How far a frozen value may grow before it fails: a routine fix in a big file or function
 * passes, a steady drift doesn't. The headroom is measured from the frozen value, so it is spent
 * once; `--tighten` after a split re-bases it.
 */
export const SIZE_HEADROOM = 4 * 1024;
export const COMPLEXITY_HEADROOM = 3;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASELINE = path.join(ROOT, "scripts/ci/ratchets.baseline.json");

const SIZE_FILES = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|rs|css|sh)$/;
const COMPLEXITY_FILES = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
// Generated, vendored, throwaway or append-only history: not code anyone splits.
const EXCLUDED =
  /^(\.design|storybook-static|scripts\/spikes|supabase\/migrations)\/|\.d\.[cm]?ts$|__snapshots__\/|\/notes-doc\.bundle\.js$|^apps\/app\/src\/types\/supabase\.ts$|(^|\/)node_modules\/|(^|\/)dist\//;
// Single sources the rules require editing (AGENTS.md rules 3 and 4): long lists, not logic.
const SIZE_EXEMPT = new Set([
  "supabase/functions/_shared/contracts/vocabularies.ts",
  "apps/app/src/styles/tokens.css",
]);
const TEST = /\.(test|spec)\.[cm]?[jt]sx?$|^e2e\//;

export function sizeChecked(file: string): boolean {
  return SIZE_FILES.test(file) && !EXCLUDED.test(file) && !SIZE_EXEMPT.has(file);
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
/** Score of a flow-breaking node itself (before its children), or null if it isn't one. */
function increment(node: Node, nesting: number, elseIf: boolean): number | null {
  if (node.type === "IfStatement") return elseIf ? 1 : 1 + nesting;
  if (
    node.type === "ConditionalExpression" ||
    node.type === "SwitchStatement" ||
    node.type === "CatchClause" ||
    LOOP_TYPES.has(node.type)
  )
    return 1 + nesting;
  if (node.type === "BreakStatement" || node.type === "ContinueStatement")
    return node.label ? 1 : 0;
  if (node.type === "LogicalExpression") {
    // +1 per run of the same operator: `a && b && c` is 1, `a && b || c` is 2.
    const ops = logicalOperators(node);
    return ops.filter((op, i) => op !== ops[i - 1]).length;
  }
  return null;
}

/** The parts of a flow-breaking node, each with the nesting it is scored at. */
function nestedParts(node: Node, nesting: number): [Node, number, boolean][] {
  const inner = nesting + 1;
  switch (node.type) {
    case "IfStatement": {
      const alt = node.alternate;
      // `else if` stays at this nesting and scores flat; a plain `else` scores +1.
      const altPart: [Node, number, boolean][] =
        alt?.type === "IfStatement" ? [[alt, nesting, true]] : alt ? [[alt, inner, false]] : [];
      return [[node.test, nesting, false], [node.consequent, inner, false], ...altPart];
    }
    case "ConditionalExpression":
      return [
        [node.test, nesting, false],
        [node.consequent, inner, false],
        [node.alternate, inner, false],
      ];
    case "SwitchStatement":
      return [
        [node.discriminant, nesting, false],
        ...node.cases.map((c: Node) => [c, inner, false]),
      ];
    case "CatchClause":
      return [[node.body, inner, false]];
    case "LogicalExpression":
      return logicalLeaves(node).map((leaf) => [leaf, nesting, false]);
    default: {
      if (!LOOP_TYPES.has(node.type)) return [];
      const heads = ["init", "test", "update", "left", "right"].map(
        (key): [Node, number, boolean] => [node[key], nesting, false],
      );
      return [...heads, [node.body, inner, false]];
    }
  }
}

function visit(node: Node, nesting: number, elseIf: boolean): number {
  if (!isNode(node) || FUNCTION_TYPES.has(node.type)) return 0;
  const own = increment(node, nesting, elseIf);
  const parts: [Node, number, boolean][] =
    own === null ? children(node).map((c) => [c, nesting, false]) : nestedParts(node, nesting);
  // A plain `else` adds +1 on top of its `if`.
  const plainElse =
    node.type === "IfStatement" && node.alternate && node.alternate.type !== "IfStatement";
  return (own ?? 0) + (plainElse ? 1 : 0) + parts.reduce((n, [c, d, e]) => n + visit(c, d, e), 0);
}

/** Cognitive complexity of one function body, not counting the functions nested in it. */
export function complexityOf(fn: Node): number {
  return visit(fn.body, 0, false);
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

const baseName = (fn: string) => fn.replace(/#\d+$/, "");

/** Functions grouped by name without the `#N` suffix, highest score first. */
function byBaseName(fns: Record<string, number>): Map<string, { name: string; score: number }[]> {
  const groups = new Map<string, { name: string; score: number }[]>();
  for (const [name, score] of Object.entries(fns)) {
    const key = baseName(name);
    groups.set(key, [...(groups.get(key) ?? []), { name, score }]);
  }
  for (const list of groups.values()) list.sort((a, b) => b.score - a.score);
  return groups;
}

function checkSize(measured: Measured, baseline: Baseline): Violation[] {
  return Object.entries(measured.size).flatMap(([file, bytes]) => {
    const frozen = baseline.size[file] ?? null;
    const fails = frozen === null || bytes > frozen + SIZE_HEADROOM;
    return fails ? [{ kind: "size" as const, file, value: bytes, frozen }] : [];
  });
}

interface Assigned {
  file: string;
  fn: string;
  score: number;
  /** The frozen value this function is held to, or null for a new one. */
  frozen: number | null;
}

/**
 * One file's functions against its frozen ones. Same-named functions (`useCallback(cb)`, `#2`,
 * `#3` …) are paired highest with highest, so adding or removing one doesn't shift the others onto
 * the wrong frozen value. Also returns the frozen values left without a function there (it shrank,
 * was deleted, or moved to another file).
 */
function pairFile(file: string, measured: Measured, baseline: Baseline) {
  const now = byBaseName(measured.complexity[file] ?? {});
  const was = byBaseName(baseline.complexity[file] ?? {});
  const assigned: Assigned[] = [];
  const left: [string, number][] = [];
  for (const [base, fns] of now) {
    const frozen = (was.get(base) ?? []).map((f) => f.score);
    fns.forEach(({ name, score }, i) => {
      assigned.push({ file, fn: name, score, frozen: frozen[i] ?? null });
    });
  }
  for (const [base, fns] of was) {
    for (const f of fns.slice(now.get(base)?.length ?? 0)) left.push([base, f.score]);
  }
  return { assigned, left };
}

/** Takes the smallest frozen value from the pool that still covers `score`, if any. */
function takeFrozen(pool: number[], score: number): number | null {
  let best = -1;
  pool.forEach((frozen, i) => {
    if (score <= frozen + COMPLEXITY_HEADROOM && (best < 0 || frozen < pool[best])) best = i;
  });
  return best >= 0 ? pool.splice(best, 1)[0] : null;
}

/** Every function over the limit with the frozen value it is held to (null: none). */
export function assign(measured: Measured, baseline: Baseline): Assigned[] {
  const out: Assigned[] = [];
  const orphans = new Map<string, number[]>();
  const files = new Set([...Object.keys(measured.complexity), ...Object.keys(baseline.complexity)]);
  for (const file of files) {
    const r = pairFile(file, measured, baseline);
    out.push(...r.assigned);
    for (const [base, score] of r.left) orphans.set(base, [...(orphans.get(base) ?? []), score]);
  }
  // A frozen function moved to another file (the fix for a big file) keeps its frozen value.
  for (const a of out) {
    if (a.frozen === null) a.frozen = takeFrozen(orphans.get(baseName(a.fn)) ?? [], a.score);
  }
  return out;
}

export function check(measured: Measured, baseline: Baseline): Violation[] {
  const out = checkSize(measured, baseline);
  for (const { file, fn, score, frozen } of assign(measured, baseline)) {
    if (frozen === null || score > frozen + COMPLEXITY_HEADROOM)
      out.push({
        kind: "complexity",
        file,
        fn,
        line: measured.lines[file]?.[fn],
        value: score,
        frozen,
      });
  }
  return out;
}

/**
 * The baseline lowered to today's values: shrunk entries go down, fixed ones disappear, renumbered
 * or moved functions are re-keyed under their current name. Never adds or raises a value.
 */
export function tighten(measured: Measured, baseline: Baseline): Baseline {
  const size: Baseline["size"] = {};
  for (const [file, frozen] of Object.entries(baseline.size)) {
    const now = measured.size[file];
    if (now !== undefined) size[file] = Math.min(now, frozen);
  }
  const complexity: Baseline["complexity"] = {};
  for (const { file, fn, score, frozen } of assign(measured, baseline)) {
    if (frozen !== null) (complexity[file] ??= {})[fn] = Math.min(score, frozen);
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
  return `${where}: ${unit}, grew more than the headroom past its frozen ${was}`;
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
  console.log(
    "Ratchets hold: nothing new over 32 KB or complexity 15, nothing frozen outgrew its headroom.",
  );
}
