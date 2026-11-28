// Writes apps/native/crates/tokens/tokens.json from apps/app/src/styles/tokens.css, the one
// source of Moduo's design values (specs/native-foundation.md, NF-3). The native app reads the
// JSON; the Rust resolver (NF-4) layers it per appearance and does the colour maths.
//
//   bun run native:tokens            rewrite the JSON
//   bun run native:tokens --check    exit 1 when the JSON is stale (verify runs the test instead)
//
// Each CSS rule becomes one layer, in source order, so a later layer wins exactly as in the
// browser. Its selector list becomes `when` (any one of them applies): an object of appearance
// axes (`data-theme` → `theme`), where a string is "equals", "*" is "the attribute is present"
// and {not} is "differs". A media query becomes `media`. Values become small expression trees,
// never evaluated here. Anything this file does not know (a selector, a function) fails the
// export instead of being dropped.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import postcss, { type AtRule, type Rule } from "postcss";
import valueParser, { type Node as ValueNode } from "postcss-value-parser";

export const TOKENS_CSS = "apps/app/src/styles/tokens.css";
export const TOKENS_JSON = "apps/native/crates/tokens/tokens.json";

type AxisTest = string | { not: string };
export type Condition = Record<string, AxisTest>;
export type Expr =
  | { num: number; unit: string }
  | { oklch: [number, number, number, number] }
  | { rgb: [number, number, number, number] }
  | { hsl: [number, number, number, number] }
  | { var: string; fallback?: Expr }
  | { mix: { space: string; a: Expr; pa: number | null; b: Expr; pb: number | null } }
  | { calc: Expr | { op: string; l: Expr; r: Expr } }
  | { bezier: number[] }
  | { keyword: string }
  | { word: string }
  | { string: string }
  | { list: { sep: " " | ","; items: Expr[] } }
  | { raw: string };
export type Layer = {
  when: Condition[];
  media?: Record<string, string>;
  set: Record<string, Expr>;
  /** Standard properties the native app also needs (`color-scheme` says dark or light). */
  props?: Record<string, string>;
};
export type TokensExport = { source: string; layers: Layer[] };

/** Standard properties exported as text; any other non-custom property fails the export. */
const STANDARD_PROPS = new Set(["color-scheme"]);
const KEYWORDS = new Set(["transparent", "none", "currentcolor", "inherit", "initial"]);
/** Kept as text: the native app has no use for them yet, and evaluating them needs a layout. */
const RAW_FUNCTIONS = new Set(["clamp", "linear-gradient"]);

// ── Selectors ────────────────────────────────────────────────────────────────

function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === sep && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

const ATTRIBUTE = /^\[data-([\w-]+)(?:="([^"]*)")?\]/;

/** One selector (no commas) → the conditions it stands for (several only for :where). */
function conditionsOf(selector: string): Condition[] {
  let rest = selector.trim();
  let conditions: Condition[] = [{}];
  const add = (axis: string, test: AxisTest) => {
    conditions = conditions.map((c) => ({ ...c, [axis]: test }));
  };
  while (rest.length > 0) {
    let m: RegExpExecArray | null;
    if (rest.startsWith(":root")) {
      rest = rest.slice(5);
    } else if ((m = ATTRIBUTE.exec(rest))) {
      add(m[1]!, m[2] ?? "*");
      rest = rest.slice(m[0].length);
    } else if ((m = /^:not\((\[data-([\w-]+)="([^"]*)"\])\)/.exec(rest))) {
      add(m[2]!, { not: m[3]! });
      rest = rest.slice(m[0].length);
    } else if (rest.startsWith(":where(")) {
      const close = rest.indexOf(")", 7);
      const inner = splitTopLevel(rest.slice(7, close), ",").flatMap(conditionsOf);
      conditions = conditions.flatMap((c) => inner.map((i) => ({ ...c, ...i })));
      rest = rest.slice(close + 1);
    } else if (/^\s/.test(rest)) {
      // A descendant: the native app has one appearance, so it reads like a compound.
      rest = rest.trimStart();
    } else {
      throw new Error(`tokens.css: no appearance condition for the selector "${selector}"`);
    }
  }
  return conditions;
}

function mediaOf(params: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of params.split(/\s+and\s+/)) {
    const m = /^\(\s*([\w-]+)\s*:\s*([^)]+?)\s*\)$/.exec(part.trim());
    if (!m) throw new Error(`tokens.css: unsupported media query "${params}"`);
    out[m[1]!] = m[2]!;
  }
  return out;
}

// ── Values ───────────────────────────────────────────────────────────────────

function fail(prop: string, why: string): never {
  throw new Error(`tokens.css --${prop}: ${why}`);
}

/** Splits nodes at a divider (",", "/"), dropping spaces. */
function groups(nodes: ValueNode[], divider: string): ValueNode[][] {
  const out: ValueNode[][] = [[]];
  for (const node of nodes) {
    if (node.type === "div" && node.value === divider) out.push([]);
    else if (node.type !== "space" && node.type !== "comment") out[out.length - 1]!.push(node);
  }
  return out;
}

function numberOf(node: ValueNode | undefined, prop: string): number {
  const parsed = node?.type === "word" ? valueParser.unit(node.value) : false;
  if (!parsed)
    fail(prop, `expected a number, got "${node ? valueParser.stringify(node) : "nothing"}"`);
  const n = Number(parsed.number);
  return parsed.unit === "%" ? n / 100 : n;
}

function percentOf(node: ValueNode, prop: string): number {
  const parsed = node.type === "word" ? valueParser.unit(node.value) : false;
  if (!parsed || parsed.unit !== "%")
    fail(prop, `expected a percentage, got "${valueParser.stringify(node)}"`);
  return Number(parsed.number);
}

function colorArgs(
  nodes: ValueNode[],
  prop: string,
  name: string,
): [number, number, number, number] {
  const [channels = [], alpha = []] = groups(nodes, "/");
  const flat = channels.length === 1 ? groups(nodes, ",").flat() : channels;
  if (flat.length !== 3) fail(prop, `${name}() takes three channels`);
  const raw = (n: ValueNode) =>
    Number(valueParser.unit((n as { value: string }).value || "")?.number ?? NaN);
  // oklch's lightness and rgb's channels keep their CSS scale; a "%" lightness becomes 0–1.
  const values = flat.map((n, i) => (name === "oklch" && i === 0 ? numberOf(n, prop) : raw(n)));
  if (values.some((v) => Number.isNaN(v)))
    fail(prop, `${name}() has a channel that is not a number`);
  const a = alpha.length > 0 ? numberOf(alpha[0], prop) : 1;
  return [values[0]!, values[1]!, values[2]!, a];
}

function calcOf(nodes: ValueNode[], prop: string): Expr {
  const tokens = nodes.filter((n) => n.type !== "space" && n.type !== "comment");
  let at = 0;
  const isOp = (n: ValueNode | undefined, ops: string[]) =>
    !!n && (n.type === "word" || n.type === "div") && ops.includes(n.value);
  const primary = (): Expr => {
    const node = tokens[at++];
    if (!node) fail(prop, "calc() ends early");
    if (node.type === "function" && node.value === "") return calcOf(node.nodes, prop);
    return exprOf(node, prop);
  };
  const term = (): Expr => {
    let left = primary();
    while (isOp(tokens[at], ["*", "/"])) {
      const op = tokens[at++]!.value;
      left = { calc: { op, l: left, r: primary() } };
    }
    return left;
  };
  let left = term();
  while (isOp(tokens[at], ["+", "-"])) {
    const op = tokens[at++]!.value;
    left = { calc: { op, l: left, r: term() } };
  }
  if (at !== tokens.length) fail(prop, "calc() has a token it cannot read");
  return left;
}

function exprOf(node: ValueNode, prop: string): Expr {
  if (node.type === "string") return { string: node.value };
  if (node.type === "word") {
    const parsed = valueParser.unit(node.value);
    if (parsed && parsed.number !== "" && !Number.isNaN(Number(parsed.number))) {
      return { num: Number(parsed.number), unit: parsed.unit };
    }
    if (node.value.startsWith("#")) fail(prop, "hex colours are not tokens; use oklch()");
    const lower = node.value.toLowerCase();
    return KEYWORDS.has(lower) ? { keyword: lower } : { word: node.value };
  }
  if (node.type !== "function") fail(prop, `unexpected "${valueParser.stringify(node)}"`);
  const name = node.value.toLowerCase();
  switch (name) {
    case "oklch":
      return { oklch: colorArgs(node.nodes, prop, name) };
    case "rgb":
    case "rgba":
      return { rgb: colorArgs(node.nodes, prop, "rgb") };
    case "hsl":
    case "hsla":
      return { hsl: colorArgs(node.nodes, prop, "hsl") };
    case "var": {
      const [first = [], fallback] = groups(node.nodes, ",");
      const ref = first[0];
      if (ref?.type !== "word" || !ref.value.startsWith("--")) fail(prop, "var() needs a --name");
      const e: Expr = { var: ref.value.slice(2) };
      return fallback && fallback.length > 0 ? { ...e, fallback: listOf(fallback, prop) } : e;
    }
    case "color-mix": {
      const [space = [], a = [], b = []] = groups(node.nodes, ",");
      if (space[0]?.type !== "word" || space[0].value !== "in" || !space[1])
        fail(prop, "color-mix() needs 'in <space>'");
      const side = (nodes: ValueNode[]) => {
        const pct = nodes.find((n) => n.type === "word" && n.value.endsWith("%"));
        const color = nodes.filter((n) => n !== pct);
        if (color.length !== 1) fail(prop, "color-mix() takes one colour per side");
        return { color: exprOf(color[0]!, prop), pct: pct ? percentOf(pct, prop) : null };
      };
      const l = side(a);
      const r = side(b);
      return {
        mix: {
          space: (space[1] as { value: string }).value,
          a: l.color,
          pa: l.pct,
          b: r.color,
          pb: r.pct,
        },
      };
    }
    case "calc": {
      // A binary calc is already {calc:{op,l,r}}; a lone operand is wrapped once.
      const e = calcOf(node.nodes, prop);
      return "calc" in e ? e : { calc: e };
    }
    case "cubic-bezier":
      return { bezier: groups(node.nodes, ",").map((g) => numberOf(g[0], prop)) };
    default:
      if (RAW_FUNCTIONS.has(name)) return { raw: valueParser.stringify(node) };
      fail(prop, `unknown function ${name}()`);
  }
}

function listOf(nodes: ValueNode[], prop: string): Expr {
  const byComma = groups(nodes, ",").filter((g) => g.length > 0);
  const spaced = (g: ValueNode[]): Expr =>
    g.length === 1
      ? exprOf(g[0]!, prop)
      : { list: { sep: " ", items: g.map((n) => exprOf(n, prop)) } };
  if (byComma.length === 0) fail(prop, "empty value");
  return byComma.length === 1
    ? spaced(byComma[0]!)
    : { list: { sep: ",", items: byComma.map(spaced) } };
}

// ── The export ───────────────────────────────────────────────────────────────

export function exportTokens(css: string): TokensExport {
  const layers: Layer[] = [];
  const visit = (rule: Rule, media?: Record<string, string>) => {
    const when = splitTopLevel(rule.selector, ",").flatMap(conditionsOf);
    const set: Record<string, Expr> = {};
    const props: Record<string, string> = {};
    rule.each((child) => {
      if (child.type !== "decl") return;
      if (STANDARD_PROPS.has(child.prop)) {
        props[child.prop] = child.value.trim();
        return;
      }
      if (!child.prop.startsWith("--")) {
        throw new Error(
          `tokens.css: "${child.prop}" in "${rule.selector}" is not a custom property`,
        );
      }
      const prop = child.prop.slice(2);
      set[prop] = listOf(valueParser(child.value).nodes, prop);
    });
    if (Object.keys(set).length === 0 && Object.keys(props).length === 0) return;
    const layer: Layer = media ? { when, media, set } : { when, set };
    if (Object.keys(props).length > 0) layer.props = props;
    layers.push(layer);
  };
  postcss.parse(css).each((node) => {
    if (node.type === "rule") visit(node);
    else if (node.type === "atrule") {
      const at = node as AtRule;
      if (at.name === "theme") return; // Tailwind's mapping, not a token source.
      if (at.name !== "media") throw new Error(`tokens.css: unsupported @${at.name}`);
      const media = mediaOf(at.params);
      at.each((child) => {
        if (child.type === "rule") visit(child, media);
      });
    }
  });
  return { source: TOKENS_CSS, layers };
}

if (import.meta.main) {
  const root = join(import.meta.dir, "../..");
  const next = `${JSON.stringify(exportTokens(readFileSync(join(root, TOKENS_CSS), "utf8")), null, 2)}\n`;
  const out = join(root, TOKENS_JSON);
  if (process.argv.includes("--check")) {
    const current = (() => {
      try {
        return JSON.parse(readFileSync(out, "utf8"));
      } catch {
        return null;
      }
    })();
    if (JSON.stringify(current) !== JSON.stringify(JSON.parse(next))) {
      console.error(`${TOKENS_JSON} is stale: run bun run native:tokens`);
      process.exit(1);
    }
  } else {
    writeFileSync(out, next);
    // Leave it the way `bun fmt --check` (part of verify) wants it.
    Bun.spawnSync(["bun", "fmt", out]);
  }
}
