// The conversion check (round-3 §2.6 step 4; CV-1 reuses it): does a v1 body,
// converted by `chat__v1_to_v2` in SQL, draw the same as v1 drew it? Both
// sides are reduced to what a reader sees, character by character: the
// character, its marks (ignored on whitespace, where they're invisible),
// whether it's code, the link it belongs to; `@channel` pills, references,
// date chips and line breaks as their own cells. v1's side comes from v1's own
// parser (../markup.ts), with its links exactly where v1 drew them; v2's from
// the v2 parser. `lineChanges` names the kinds the spec accepts as better
// formatting (a line starting "- ", a `[text](url)`, a "1." list).

import { parseBody, type Block as V1Block, type Inline as V1Inline } from "../markup";
import { parseStored } from "./parse";
import { type Block, BOLD, type Inline, ITALIC, type Marks, PERSON_TYPE, STRIKE } from "./types";

function v1Inline(nodes: readonly V1Inline[], m: Marks, out: Inline[]): void {
  for (const node of nodes) {
    switch (node.t) {
      case "text":
        node.v.split("\n").forEach((part, i) => {
          if (i > 0) out.push({ t: "br" });
          if (part) out.push({ t: "text", v: part, m });
        });
        break;
      case "code":
        out.push({ t: "code", v: node.v, m });
        break;
      case "bold":
        v1Inline(node.c, m | BOLD, out);
        break;
      case "italic":
        v1Inline(node.c, m | ITALIC, out);
        break;
      case "strike":
        v1Inline(node.c, m | STRIKE, out);
        break;
      // v1's link is a bare URL, linked exactly where v1's own rule cut it.
      case "link":
        out.push({ t: "url", v: node.href, m });
        break;
      case "mention":
        out.push({ t: "ref", type: PERSON_TYPE, id: node.userId });
        break;
      case "channel":
        out.push({ t: "channel", m });
        break;
      case "entity":
        out.push({ t: "ref", type: node.type, id: node.id });
        break;
    }
  }
}

/** What v1 drew for `body`, as a v2 tree (not canonicalised: v1's links stay as v1 cut them). */
export function v1Tree(body: string): Block[] {
  return parseBody(body).map((block: V1Block): Block => {
    if (block.t === "pre") return { t: "pre", v: block.v, lang: block.lang };
    const c: Inline[] = [];
    v1Inline(block.c, 0, c);
    return { t: block.t, c };
  });
}

const CODE = 8;

/** One inline run as drawn cells. */
function cells(leaves: readonly Inline[]): string[] {
  const out: string[] = [];
  const chars = (v: string, m: Marks, href: string) => {
    for (const ch of v) {
      out.push(/\s/.test(ch) ? `${ch}|${m & CODE ? "code" : ""}|${href}` : `${ch}|${m}|${href}`);
    }
  };
  for (const leaf of leaves) {
    switch (leaf.t) {
      case "text":
        chars(leaf.v, leaf.m, "");
        break;
      // A custom emoji the workspace lacks is drawn as its text; v1 drew it as text.
      case "emoji":
        chars(`:${leaf.name}:`, leaf.m, "");
        break;
      case "code":
        chars(leaf.v, leaf.m | CODE, "");
        break;
      case "url":
        chars(leaf.v, leaf.m, leaf.v);
        break;
      case "link":
        for (const part of leaf.c)
          chars(part.v, part.m | (part.t === "code" ? CODE : 0), leaf.href);
        break;
      case "channel":
        out.push("@channel-pill");
        break;
      case "ref":
        out.push(`ref:${leaf.type}:${leaf.id}`);
        break;
      case "date":
        out.push(`date:${leaf.day}`);
        break;
      case "br":
        out.push("br");
        break;
    }
  }
  // Spaces at a line's end hang invisibly (v1 drew rows with pre-wrap).
  return out.filter((cell, k) => {
    if (!/^\s\|/.test(cell)) return true;
    let next = k + 1;
    while (next < out.length && /^\s\|/.test(out[next] as string)) next += 1;
    return next < out.length && out[next] !== "br";
  });
}

/** A tree as drawn: paragraphs read as lines, the message's blank edges gone. */
export function drawn(blocks: readonly Block[]): string[][] {
  const out: string[][] = [];
  for (const block of blocks) {
    const prev = out[out.length - 1];
    if (block.t === "p") {
      const c = cells(block.c);
      if (prev?.[0] === "p") prev.push("br", ...c);
      else out.push(["p", ...c]);
    } else if (block.t === "quote") {
      out.push(["quote", ...cells(block.c)]);
    } else if (block.t === "pre") {
      out.push(["pre", block.lang ?? "", block.v]);
    } else {
      const kind = block.ordered ? `ol:${block.start}` : "ul";
      const items = block.items.flatMap((item) => ["item", ...cells(item)]);
      if (prev?.[0] === kind) prev.push(...items);
      else out.push([kind, ...items]);
    }
  }
  const blank = (cell: string) => cell === "br" || /^\s\|/.test(cell);
  const first = out[0];
  if (first?.[0] === "p") while (first.length > 1 && blank(first[1] as string)) first.splice(1, 1);
  const last = out[out.length - 1];
  if (last?.[0] === "p")
    while (last.length > 1 && blank(last[last.length - 1] as string)) last.pop();
  return out.filter(
    (block, k) => !(block[0] === "p" && block.length === 1 && (k === 0 || k === out.length - 1)),
  );
}

/**
 * What a v1 body holds that v2 draws differently, by kind: lines that read as
 * Markdown structure in v2 (accepted as better formatting, round-3 §2.6), and
 * the fences the conversion rewrites on purpose.
 */
export type LineChange =
  /** A line starting "- " or "+ ": now a list item (a "* " line stays text). */
  | "dash-line"
  /** A line starting "1. " or "1) ": now a numbered item. */
  | "numbered-line"
  /** `[text](url)`: now a link. */
  | "markdown-link"
  /** A fence sharing its line with text: rewritten to a block (v1 drew a block too). */
  | "inline-fence"
  /** A fence without a line break after its first word: v1 took the word for the language. */
  | "fence-word";

/** The changes in a v1 body, outside code (one per matching line or fence). */
export function lineChanges(v1Body: string): LineChange[] {
  const out: LineChange[] = [];
  const prose = v1Body.replace(/```[a-zA-Z0-9_+-]*\n?[\s\S]*?```/g, (fence) => {
    if (!/^```[a-zA-Z0-9_+-]*\n/.test(fence)) out.push("fence-word");
    // A fence that shares its line with text: marked, then counted per line.
    return fence.includes("\n") ? "" : "\u0000";
  });
  for (const raw of prose.split("\n")) {
    // Code spans and v1's own tokens (a label may hold anything) aren't prose.
    const line = raw.replace(/`[^`\n]+`/g, "").replace(/<moduo:[^>\n]*>|<@[^>\n]*>/g, "");
    if (raw.includes("\u0000")) out.push("inline-fence");
    if (/^ {0,3}[-+][ \t]/.test(line)) out.push("dash-line");
    if (/^ {0,3}\d{1,9}[.)][ \t]/.test(line)) out.push("numbered-line");
    if (/\[[^\]\n]+\]\([^)\s]+\)/.test(line)) out.push("markdown-link");
  }
  return out;
}

const V1_TOKEN = /<@[0-9a-fA-F-]{36}>|<!channel>|<moduo:[a-z_]{1,32}:[0-9a-fA-F-]{36}\|/;

export type Comparison = {
  /** v2 draws what v1 drew. */
  same: boolean;
  /** A v1 token left in the converted text outside code. */
  tokenLeft: boolean;
  /** An entity's label still in the converted text (where v1 showed it only as the chip). */
  labelLeft: boolean;
  /** Accepted Markdown changes and intended rewrites in the v1 body. */
  lines: LineChange[];
};

/** Compare a v1 body with its conversion. */
export function compareConversion(v1Body: string, v2Body: string): Comparison {
  const v2 = parseStored(v2Body);
  // Text the reader sees outside code, for the token and label checks.
  const visible = (blocks: Block[]) =>
    blocks
      .flatMap((b) => (b.t === "pre" ? [] : b.t === "list" ? b.items.flat() : b.c))
      .map((leaf) => (leaf.t === "text" ? leaf.v : ""))
      .join("\n");
  const shown = visible(v2);
  const labels = [
    ...v1Body.matchAll(/<moduo:[a-z_]{1,32}:[0-9a-fA-F-]{36}\|([^>\n]{1,200})>/g),
  ].map((m) => m[1] as string);
  const v1Shown = visible(v1Tree(v1Body.replace(/<moduo:[^>\n]*>/g, "")));
  return {
    same: JSON.stringify(drawn(v1Tree(v1Body))) === JSON.stringify(drawn(v2)),
    tokenLeft: V1_TOKEN.test(shown),
    labelLeft: labels.some((label) => shown.includes(label) && !v1Shown.includes(label)),
    lines: lineChanges(v1Body),
  };
}
