// A tiny reader for our own stylesheets (tokens.css, global.css), used by the
// design-system tests to assert where a rule lives and what it declares. Not a
// general CSS parser, but it skips comments, quoted strings and parentheses
// (data URIs, `content: "}"`), so braces or semicolons inside those can't
// derail it.

export type CssBlock = {
  /** Selector list or at-rule prelude, whitespace-normalised. */
  prelude: string;
  /** The block's own text: its declarations, with nested blocks cut out. */
  own: string;
  /** Preludes of the enclosing blocks, outermost first (e.g. "@layer base"). */
  parents: string[];
};

type OpenBlock = { prelude: string; own: string; segmentStart: number };

export function cssBlocks(css: string): CssBlock[] {
  const src = stripComments(css);
  const blocks: CssBlock[] = [];
  const open: OpenBlock[] = [];
  let preludeStart = 0;
  let quote = "";
  let parens = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") parens++;
    else if (ch === ")") parens = Math.max(0, parens - 1);
    else if (parens > 0) continue;
    else if (ch === "{") {
      const parent = open[open.length - 1];
      if (parent) parent.own += src.slice(parent.segmentStart, preludeStart);
      open.push({ prelude: normalise(src.slice(preludeStart, i)), own: "", segmentStart: i + 1 });
      preludeStart = i + 1;
    } else if (ch === "}") {
      const block = open.pop();
      if (!block) throw new Error(`Unbalanced "}" at offset ${i}`);
      block.own += src.slice(block.segmentStart, i);
      blocks.push({ prelude: block.prelude, own: block.own, parents: open.map((o) => o.prelude) });
      const parent = open[open.length - 1];
      if (parent) parent.segmentStart = i + 1;
      preludeStart = i + 1;
    } else if (ch === ";") {
      preludeStart = i + 1;
    }
  }
  if (open.length > 0) throw new Error(`Unclosed block: ${open[open.length - 1].prelude}`);
  return blocks;
}

/** The selectors of a block, split on top-level commas. */
export function selectors(block: CssBlock): string[] {
  return splitTopLevel(block.prelude, ",").map((s) => s.trim());
}

/** The block's own declarations, property → whitespace-normalised value. */
export function declarations(block: CssBlock): Map<string, string> {
  const decls = new Map<string, string>();
  for (const part of splitTopLevel(block.own, ";")) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    const prop = part.slice(0, colon).trim();
    if (prop) decls.set(prop, normalise(part.slice(colon + 1)));
  }
  return decls;
}

/** Blocks whose selector list is exactly `list` (order-insensitive). */
export function blocksWithSelectors(blocks: CssBlock[], list: string[]): CssBlock[] {
  const want = [...list].sort().join("|");
  return blocks.filter((b) => [...selectors(b)].sort().join("|") === want);
}

function stripComments(css: string): string {
  let out = "";
  let quote = "";
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      out += ch;
      if (ch === "\\") out += css[++i] ?? "";
      else if (ch === quote) quote = "";
    } else if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 1;
    } else {
      if (ch === '"' || ch === "'") quote = ch;
      out += ch;
    }
  }
  return out;
}

/** Split on `separator` outside quotes, parentheses and brackets. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
