// The canonical tree: the one shape every way into the stored form agrees on.
// The serializer writes only canonical trees, the parser returns them, and the
// Lexical bridge's export passes through here, so "editor → stored → parser →
// editor" compares like with like. What it changes is listed (and counted in
// the corpus) in docs/build/chat-v2/CV-0-S4.md §Canonical form:
//
// 1. text leaves: no empty ones, no "\n" (a break is a `br`), neighbours with
//    the same marks merged, then re-split into URL / `@channel` / `:name:`;
// 2. bold, italic and strike never start or end on whitespace (Markdown can't
//    write `**a **`): the marks come off the edge spaces, and references,
//    dates, links and breaks end every run of marks;
// 3. a link keeps only http(s) and mailto targets (anything else is its text);
// 4. two paragraphs in a row become one, joined by a line break, and two
//    lists of one kind in a row become one (Lexical merges them as well);
// 5. the message's edges are trimmed (blank lines, and spaces at either end);
// 6. a code block's language is one word or nothing; ids are lower case.

import { type MarkLeaf, type MarkStep, maskOf, planMarks } from "./plan";
import { splitTextTokens, tokenText } from "./tokens";
import {
  ALL_MARKS,
  type Block,
  type CodeLeaf,
  type Inline,
  isIsoDay,
  LANG_RE,
  type LinkLeaf,
  type TextLeaf,
} from "./types";

/** Link targets the stored form keeps. */
export function isAllowedHref(href: string): boolean {
  return /^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(href);
}

const _WS = /\s/;

type Flat = Inline;

/** Text-like leaves turn back into plain text leaves (to be merged and re-split). */
function untokenize(leaf: Inline): Inline {
  if (leaf.t === "url" || leaf.t === "channel" || leaf.t === "emoji") {
    return { t: "text", v: tokenText(leaf), m: leaf.m };
  }
  return leaf;
}

/** Merge neighbours: text with text, code with code, when their marks match. */
function merge<T extends Inline>(leaves: T[]): T[] {
  const out: T[] = [];
  for (const leaf of leaves) {
    const prev = out[out.length - 1];
    if (
      prev &&
      (leaf.t === "text" || leaf.t === "code") &&
      prev.t === leaf.t &&
      (prev as TextLeaf).m === (leaf as TextLeaf).m
    ) {
      out[out.length - 1] = { ...prev, v: (prev as TextLeaf).v + (leaf as TextLeaf).v } as T;
    } else {
      out.push(leaf);
    }
  }
  return out;
}

/** Split text leaves that hold "\n" into text and `br` leaves; drop empty text. */
function splitBreaks(leaves: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const leaf of leaves) {
    if (leaf.t === "text" || leaf.t === "code") {
      const parts = leaf.v.replace(/\r\n?/g, "\n").split("\n");
      parts.forEach((part, i) => {
        if (i > 0) out.push({ t: "br" });
        if (part) out.push({ ...leaf, v: part, m: leaf.m & ALL_MARKS });
      });
    } else if (leaf.t === "url" || leaf.t === "channel" || leaf.t === "emoji") {
      out.push({ ...leaf, m: leaf.m & ALL_MARKS });
    } else {
      out.push(leaf);
    }
  }
  return out;
}

/**
 * Take marks off whitespace where the stored form opens or closes them
 * (./plan.ts): `**a **` can't be written, so the space loses bold. Runs end at
 * references, dates, links and breaks; code keeps its spaces (they sit inside
 * the backticks). Repeats until the plan stops moving (marks only go).
 */
function stripEdgeSpace(leaves: Inline[]): Inline[] {
  let out = leaves;
  for (let guard = 0; guard < 32; guard++) {
    let changed = false;
    const next: Inline[] = [];
    let seg: MarkLeaf[] = [];
    const flush = () => {
      const steps = planMarks(seg);
      seg.forEach((leaf, k) => {
        const opening = maskOf((steps[k] as MarkStep).open);
        const closing = maskOf((steps[k + 1] as MarkStep).close);
        if (leaf.t !== "text" || (opening | closing) === 0) {
          next.push(leaf);
          return;
        }
        if (/^\s+$/.test(leaf.v)) {
          next.push({ ...leaf, m: leaf.m & ~(opening | closing) });
          changed = true;
          return;
        }
        const lead = opening ? (/^\s+/.exec(leaf.v)?.[0] ?? "") : "";
        const trail = closing ? (/\s+$/.exec(leaf.v)?.[0] ?? "") : "";
        if (lead) next.push({ t: "text", v: lead, m: leaf.m & ~opening });
        next.push({ ...leaf, v: leaf.v.slice(lead.length, leaf.v.length - trail.length) });
        if (trail) next.push({ t: "text", v: trail, m: leaf.m & ~closing });
        if (lead || trail) changed = true;
      });
      seg = [];
    };
    for (const leaf of out) {
      if ("m" in leaf) seg.push(leaf);
      else {
        flush();
        next.push(leaf);
      }
    }
    flush();
    out = merge(next);
    if (!changed) break;
  }
  return out;
}

/** Canonical inline content (rules 1–3, 6). Breaks stay where they are. */
export function canonicalInline(input: readonly Inline[]): Inline[] {
  let leaves: Flat[] = splitBreaks(input.map(untokenize));
  leaves = leaves.flatMap((leaf): Inline[] => {
    if (leaf.t === "ref") {
      return /^[a-z][a-z_]{0,31}$/.test(leaf.type) && /^[0-9a-f-]{36}$/i.test(leaf.id)
        ? [{ t: "ref", type: leaf.type, id: leaf.id.toLowerCase() }]
        : [];
    }
    if (leaf.t === "date") return isIsoDay(leaf.day) ? [leaf] : [];
    if (leaf.t === "link") return canonicalLink(leaf);
    return [leaf];
  });
  leaves = stripEdgeSpace(merge(leaves));
  return leaves.flatMap((leaf): Inline[] => (leaf.t === "text" ? splitTextTokens(leaf) : [leaf]));
}

/** A link: its target checked, its label canonical; a bad target leaves the label as text. */
function canonicalLink(link: LinkLeaf): Inline[] {
  const label = link.c.flatMap((leaf): Array<TextLeaf | CodeLeaf> => {
    const v = leaf.v.replace(/\r\n?|\n/g, " ");
    return v ? [{ ...leaf, v, m: leaf.m & ALL_MARKS }] : [];
  });
  if (label.length === 0) return [];
  if (!isAllowedHref(link.href)) return label;
  const c = stripEdgeSpace(merge(label)) as Array<TextLeaf | CodeLeaf>;
  return [{ t: "link", href: link.href, c }];
}

/** Drop `br`s and whitespace at the start (`side = "start"`) or end of inline content. */
function trimInline(leaves: Inline[], side: "start" | "end"): Inline[] {
  const list = side === "start" ? [...leaves] : [...leaves].reverse();
  for (;;) {
    const head = list[0];
    if (!head) break;
    if (head.t === "br") {
      list.shift();
      continue;
    }
    if (head.t === "text") {
      const v = side === "start" ? head.v.replace(/^\s+/, "") : head.v.replace(/\s+$/, "");
      if (!v) {
        list.shift();
        continue;
      }
      list[0] = { ...head, v };
    }
    break;
  }
  return side === "start" ? list : list.reverse();
}

/** The canonical tree (rules 1–6). Idempotent. */
export function canonicalBlocks(input: readonly Block[]): Block[] {
  const blocks: Block[] = [];
  for (const block of input) {
    if (block.t === "pre") {
      const lang = block.lang?.trim().split(/\s+/)[0] ?? "";
      blocks.push({
        t: "pre",
        v: block.v.replace(/\r\n?/g, "\n"),
        lang: LANG_RE.test(lang) ? lang : null,
      });
    } else if (block.t === "list") {
      if (block.items.length === 0) continue;
      const items = block.items.map((item) => canonicalInline(item));
      const prev = blocks[blocks.length - 1];
      // Two lists of one kind in a row are one list (Lexical merges them too).
      if (prev?.t === "list" && prev.ordered === block.ordered) {
        prev.items.push(...items);
        continue;
      }
      blocks.push({
        t: "list",
        ordered: block.ordered,
        start: block.ordered ? Math.min(Math.max(0, Math.trunc(block.start)), 999_999_999) : 1,
        items,
      });
    } else {
      const c = canonicalInline(block.c);
      const prev = blocks[blocks.length - 1];
      if (block.t === "p" && prev?.t === "p") {
        prev.c = canonicalInline([...prev.c, { t: "br" }, ...c]);
      } else {
        blocks.push({ t: block.t, c });
      }
    }
  }
  // The message's edges: blank lines and outer whitespace go (rule 5).
  const first = blocks[0];
  if (first?.t === "p") first.c = canonicalInline(trimInline(first.c, "start"));
  const last = blocks[blocks.length - 1];
  if (last?.t === "p") last.c = canonicalInline(trimInline(last.c, "end"));
  if (blocks[0]?.t === "p" && (blocks[0] as { c: Inline[] }).c.length === 0) blocks.shift();
  const tail = blocks[blocks.length - 1];
  if (tail?.t === "p" && tail.c.length === 0) blocks.pop();
  return blocks;
}
