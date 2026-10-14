// The conversion check (round-3 §2.6 step 4; CV-1 reuses it): does a v1 body,
// converted by `chat__v1_to_v2` in SQL, draw the same as v1 drew it? Both
// sides become the v2 tree: v1's own parser (../markup.ts) mapped onto it,
// and the v2 parser over the converted text, both canonical. A row that
// differs is a meaning change; `lineChanges` names the kinds the spec accepts
// as better formatting (a line starting "- ", a `[text](url)`, a "1." list).

import { parseBody, type Block as V1Block, type Inline as V1Inline } from "../markup";
import { canonicalBlocks } from "./canonical";
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
      // v1's link is a bare URL: v2 finds it in the text again (its own rules).
      case "link":
        out.push({ t: "text", v: node.label, m });
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

/** What v1 drew for `body`, as a canonical v2 tree. */
export function v1Tree(body: string): Block[] {
  const blocks = parseBody(body).map((block: V1Block): Block => {
    if (block.t === "pre") return { t: "pre", v: block.v, lang: block.lang };
    const c: Inline[] = [];
    v1Inline(block.c, 0, c);
    return { t: block.t, c };
  });
  return canonicalBlocks(blocks);
}

/**
 * What a v1 body holds that v2 draws differently, by kind: lines that read as
 * Markdown structure in v2 (accepted as better formatting, round-3 §2.6), and
 * the fences the conversion rewrites on purpose.
 */
export type LineChange =
  /** A line starting "- ", "* " or "+ ": now a list item. */
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
    if (/^ {0,3}[-*+][ \t]/.test(line)) out.push("dash-line");
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
  /** Accepted Markdown changes in the v1 body. */
  lines: LineChange[];
};

/** Compare a v1 body with its conversion. */
export function compareConversion(v1Body: string, v2Body: string): Comparison {
  const v2 = parseStored(v2Body);
  const before = JSON.stringify(v1Tree(v1Body));
  const after = JSON.stringify(canonicalBlocks(v2));
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
    same: before === after,
    tokenLeft: V1_TOKEN.test(shown),
    labelLeft: labels.some((label) => shown.includes(label) && !v1Shown.includes(label)),
    lines: lineChanges(v1Body),
  };
}
