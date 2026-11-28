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
/** The appearance axes the native app knows; a typo here would make a layer that never applies. */
const AXES = new Set(["theme", "shade", "accent", "density", "radius", "font", "motion", "label"]);

/** A selector's specificity in attribute-class units; :where() counts nothing, as in CSS. */
function specificityOf(selector: string): number {
  const plain = selector.replace(/:where\([^)]*\)/g, "");
  return (plain.match(/\[data-|:root/g) ?? []).length;
}

/** One selector (no commas) → the conditions it stands for (several only for :where). */
function conditionsOf(selector: string): Condition[] {
  let rest = selector.trim();
  let conditions: Condition[] = [{}];
  const add = (axis: string, test: AxisTest) => {
    if (!AXES.has(axis))
      throw new Error(`tokens.css: "data-${axis}" in "${selector}" is not an appearance axis`);
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
  if (channels.length !== 3) fail(prop, `${name}() takes three space-separated channels`);
  // Each channel keeps its CSS scale, so only the units that scale is written in pass:
  // oklch L may be a percentage (it becomes 0–1), hsl's S and L are percentages (kept 0–100),
  // a hue may say deg. Anything else would be read at the wrong scale, so it fails.
  const allowed: Record<string, string[][]> = {
    oklch: [["", "%"], [""], ["", "deg"]],
    rgb: [[""], [""], [""]],
    hsl: [["", "deg"], ["%"], ["%"]],
  };
  const values = channels.map((n, i) => {
    const parsed = n.type === "word" ? valueParser.unit(n.value) : false;
    if (
      !parsed ||
      Number.isNaN(Number(parsed.number)) ||
      !allowed[name]![i]!.includes(parsed.unit)
    ) {
      fail(
        prop,
        `${name}() channel ${i + 1} "${valueParser.stringify(n)}" is not in a unit it can read`,
      );
    }
    const v = Number(parsed.number);
    return name === "oklch" && i === 0 && parsed.unit === "%" ? v / 100 : v;
  });
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

function wordOf(value: string, prop: string): Expr {
  const parsed = valueParser.unit(value);
  if (parsed && parsed.number !== "" && !Number.isNaN(Number(parsed.number))) {
    return { num: Number(parsed.number), unit: parsed.unit };
  }
  if (value.startsWith("#")) fail(prop, "hex colours are not tokens; use oklch()");
  const lower = value.toLowerCase();
  return KEYWORDS.has(lower) ? { keyword: lower } : { word: value };
}

function varOf(nodes: ValueNode[], prop: string): Expr {
  const [first = [], fallback] = groups(nodes, ",");
  const ref = first[0];
  if (ref?.type !== "word" || !ref.value.startsWith("--")) fail(prop, "var() needs a --name");
  const e: Expr = { var: ref.value.slice(2) };
  return fallback && fallback.length > 0 ? { ...e, fallback: listOf(fallback, prop) } : e;
}

function mixOf(nodes: ValueNode[], prop: string): Expr {
  const [space = [], a = [], b = []] = groups(nodes, ",");
  // A hue method ("in oklch longer hue") would be lost: refuse it until the resolver knows it.
  if (space[0]?.type !== "word" || space[0].value !== "in" || !space[1] || space.length !== 2) {
    fail(prop, "color-mix() needs 'in <space>'");
  }
  const side = (part: ValueNode[]) => {
    const pct = part.find((n) => n.type === "word" && n.value.endsWith("%"));
    const color = part.filter((n) => n !== pct);
    if (color.length !== 1) fail(prop, "color-mix() takes one colour per side");
    return { color: exprOf(color[0]!, prop), pct: pct ? percentOf(pct, prop) : null };
  };
  const l = side(a);
  const r = side(b);
  const name = (space[1] as { value: string }).value;
  return { mix: { space: name, a: l.color, pa: l.pct, b: r.color, pb: r.pct } };
}

/** The functions a token may use, each to its expression. Anything else fails the export. */
const FUNCTIONS: Record<string, (nodes: ValueNode[], prop: string) => Expr> = {
  oklch: (n, p) => ({ oklch: colorArgs(n, p, "oklch") }),
  rgb: (n, p) => ({ rgb: colorArgs(n, p, "rgb") }),
  rgba: (n, p) => ({ rgb: colorArgs(n, p, "rgb") }),
  hsl: (n, p) => ({ hsl: colorArgs(n, p, "hsl") }),
  hsla: (n, p) => ({ hsl: colorArgs(n, p, "hsl") }),
  var: varOf,
  "color-mix": mixOf,
  calc: (n, p) => {
    // A binary calc is already {calc:{op,l,r}}; a lone operand is wrapped once.
    const e = calcOf(n, p);
    return "calc" in e ? e : { calc: e };
  },
  "cubic-bezier": (n, p) => ({ bezier: groups(n, ",").map((g) => numberOf(g[0], p)) }),
};

function exprOf(node: ValueNode, prop: string): Expr {
  if (node.type === "string") return { string: node.value };
  if (node.type === "word") return wordOf(node.value, prop);
  if (node.type !== "function") fail(prop, `unexpected "${valueParser.stringify(node)}"`);
  const name = node.value.toLowerCase();
  const read = FUNCTIONS[name];
  if (read) return read(node.nodes, prop);
  if (RAW_FUNCTIONS.has(name)) return { raw: valueParser.stringify(node) };
  return fail(prop, `unknown function ${name}()`);
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
  // The JSON carries no specificity: the resolver applies layers in order, so a later layer must
  // never be outranked by an earlier one that sets the same property, or the browser and the
  // native app would disagree. The export refuses that instead.
  const rank = new Map<string, { max: number; selector: string }>();
  const visit = (rule: Rule, media?: Record<string, string>) => {
    const selectors = splitTopLevel(rule.selector, ",");
    const when = selectors.flatMap(conditionsOf);
    const lowest = Math.min(...selectors.map(specificityOf));
    const highest = Math.max(...selectors.map(specificityOf));
    const set: Record<string, Expr> = {};
    const props: Record<string, string> = {};
    rule.each((child) => {
      if (child.type === "comment") return;
      if (child.type !== "decl") {
        throw new Error(`tokens.css: a nested ${child.type} in "${rule.selector}" is not read`);
      }
      if (child.important) throw new Error(`tokens.css: !important on ${child.prop} is not read`);
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
      const earlier = rank.get(prop);
      if (earlier && lowest < earlier.max) {
        throw new Error(
          `tokens.css: --${prop} in "${rule.selector}" comes later but is outranked by "${earlier.selector}"`,
        );
      }
      if (!earlier || highest >= earlier.max)
        rank.set(prop, { max: highest, selector: rule.selector });
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
        else if (child.type !== "comment")
          throw new Error(`tokens.css: @${child.type} inside @media is not read`);
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
    if (Bun.spawnSync(["bun", "fmt", out]).exitCode !== 0)
      console.error(`bun fmt failed on ${TOKENS_JSON}`);
  }
}
