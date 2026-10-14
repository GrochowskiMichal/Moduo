// The stored form → the tree. Pure and fast: rows are drawn from this tree,
// cached per message (./cache.ts), never from an editor.
//
// Lines, not CommonMark paragraphs: every "\n" is a line break (chat's
// meaning). A block (quote, list, code) is set off from its neighbours by one
// blank line, which the parser consumes; any other blank line is content.
// Emphasis is a stack that mirrors the serializer: each run of `*` (or a
// `~~`) reads as the marks it closes (innermost first) followed by the marks
// it opens, choosing the reading that closes the fewest. A run may close only
// after a non-space and open only before one, so `5 * 3` stays text, while
// `un*believ*able` and `a**(b)**c` are emphasis like the composer meant. An
// opener never closed is text. `_` means nothing (v1's `_italic_` is
// rewritten to `*italic*` by the conversion). CommonMark's own algorithm was
// tried first and mis-pairs runs the composer can produce (`**a***b**c***`).
// See docs/build/chat-v2/CV-0-S4.md §Constructs.

import { isAllowedHref } from "./canonical";
import { splitTextTokens } from "./tokens";
import {
  type Block,
  BOLD,
  type CodeLeaf,
  type Inline,
  ITALIC,
  isIsoDay,
  LANG_RE,
  type Marks,
  STRIKE,
  type TextLeaf,
  URI_RE,
} from "./types";

const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const WS = /\s/;
/** A link target that is a whole Moduo URI (`[title](moduo://task/…)`: the title goes). */
const WHOLE_URI = new RegExp(`^${URI_RE.source}$`);

type Delim = {
  k: "delim";
  ch: "*" | "~";
  /** The run's length as written. */
  n: number;
  open: boolean;
  close: boolean;
  /** Characters left as text (a run no reading fits, or an opener never closed). */
  lit: number;
};

type Atom =
  | { k: "text"; v: string }
  | Delim
  | { k: "code"; v: string }
  | { k: "ref"; type: string; id: string }
  | { k: "date"; day: string }
  | { k: "br" }
  | { k: "lb" }
  | { k: "link"; href: string; c: Array<TextLeaf | CodeLeaf> };

type Pair = { o: number; c: number; mark: Marks };

/** Marks opened by one run; their nesting order is unknown (`***` opens bold and italic). */
type Group = Array<{ mark: Marks; atom: number }>;

const WIDTH: Record<number, number> = { [BOLD]: 2, [ITALIC]: 1, [STRIKE]: 2 };
const width = (marks: readonly Marks[]) => marks.reduce((n, m) => n + (WIDTH[m] as number), 0);

/** Every non-empty subset of `marks`. */
function subsets(marks: readonly Marks[]): Marks[][] {
  const out: Marks[][] = [];
  for (let bits = 1; bits < 1 << marks.length; bits++) {
    out.push(marks.filter((_, i) => (bits & (1 << i)) !== 0));
  }
  return out;
}

type Reading = { close: Marks[]; open: Marks[] };

/** How a run of asterisks reads against the open `stack`: what it closes, then what it opens. */
function readStars(run: Delim, stack: readonly Group[]): Reading | null {
  // What it can close: part of the innermost group, or all of it and part of the next…
  const closeOptions: Marks[][] = [[]];
  if (run.close) {
    let below: Marks[] = [];
    for (let g = stack.length - 1; g >= 0; g--) {
      const group = (stack[g] as Group).map((o) => o.mark);
      if (group.includes(STRIKE)) break; // a strike closes with its own `~~`
      for (const some of subsets(group)) closeOptions.push([...below, ...some]);
      below = [...below, ...group];
    }
  }
  let best: Reading | null = null;
  for (const close of closeOptions) {
    const rest = run.n - width(close);
    if (rest < 0) continue;
    let open: Marks[] | null = null;
    if (rest === 0) open = [];
    else if (run.open) {
      const fit = rest === 1 ? [ITALIC] : rest === 2 ? [BOLD] : rest === 3 ? [BOLD, ITALIC] : null;
      const stillOpen = stack
        .flatMap((g) => g.map((o) => o.mark))
        .filter((m) => !close.includes(m));
      if (fit?.every((m) => !stillOpen.includes(m))) open = fit;
    }
    if (open === null) continue;
    const fewer =
      !best ||
      close.length < best.close.length ||
      (close.length === best.close.length && open.length < best.open.length);
    if (fewer) best = { close, open };
  }
  return best;
}

/** The emphasis stack over `atoms`: the matched (opener, closer, mark) pairs. */
function processEmphasis(atoms: Atom[]): Pair[] {
  const pairs: Pair[] = [];
  const stack: Group[] = [];
  atoms.forEach((atom, k) => {
    if (atom.k !== "delim") return;
    let reading: Reading | null = null;
    if (atom.ch === "*") {
      reading = readStars(atom, stack);
    } else {
      const top = stack[stack.length - 1];
      const strikeOpen = stack.some((g) => g.some((o) => o.mark === STRIKE));
      if (atom.close && top?.some((o) => o.mark === STRIKE))
        reading = { close: [STRIKE], open: [] };
      else if (atom.open && !strikeOpen) reading = { close: [], open: [STRIKE] };
    }
    if (!reading) {
      atom.lit = atom.n;
      return;
    }
    for (const mark of reading.close) {
      for (let g = stack.length - 1; g >= 0; g--) {
        const group = stack[g] as Group;
        const at = group.findIndex((o) => o.mark === mark);
        if (at < 0) continue;
        pairs.push({ o: (group[at] as { atom: number }).atom, c: k, mark });
        group.splice(at, 1);
        if (group.length === 0) stack.splice(g, 1);
        break;
      }
    }
    if (reading.open.length) stack.push(reading.open.map((mark) => ({ mark, atom: k })));
  });
  // An opener never closed was text all along.
  for (const group of stack) {
    for (const o of group) (atoms[o.atom] as Delim).lit += WIDTH[o.mark] as number;
  }
  return pairs;
}

/** The marks each atom sits inside, from the matched pairs. */
function marksPerAtom(count: number, pairs: Pair[]): Marks[] {
  const depth = {
    [BOLD]: new Array<number>(count + 1).fill(0),
    [ITALIC]: new Array<number>(count + 1).fill(0),
    [STRIKE]: new Array<number>(count + 1).fill(0),
  } as Record<number, number[]>;
  for (const p of pairs) {
    const d = depth[p.mark] as number[];
    d[p.o + 1] = (d[p.o + 1] as number) + 1;
    d[p.c] = (d[p.c] as number) - 1;
  }
  const out: Marks[] = new Array(count);
  const run = { [BOLD]: 0, [ITALIC]: 0, [STRIKE]: 0 } as Record<number, number>;
  for (let k = 0; k < count; k++) {
    let m = 0;
    for (const mark of [BOLD, ITALIC, STRIKE]) {
      run[mark] = (run[mark] as number) + ((depth[mark] as number[])[k] as number);
      if ((run[mark] as number) > 0) m |= mark;
    }
    out[k] = m;
  }
  return out;
}

/** Atoms → leaves, emphasis applied, text merged. `extra` adds marks to all (a link's outside). */
function atomsToLeaves(atoms: Atom[], extra: Marks = 0): Inline[] {
  const pairs = processEmphasis(atoms);
  const marks = marksPerAtom(atoms.length, pairs);
  const out: Inline[] = [];
  const pushText = (v: string, m: Marks) => {
    const prev = out[out.length - 1];
    if (prev && prev.t === "text" && prev.m === m) prev.v += v;
    else out.push({ t: "text", v, m });
  };
  atoms.forEach((atom, k) => {
    const m = ((marks[k] as Marks) | extra) as Marks;
    switch (atom.k) {
      case "text":
        pushText(atom.v, m);
        break;
      case "delim":
        if (atom.lit > 0) pushText(atom.ch.repeat(atom.lit), m);
        break;
      case "lb":
        pushText("[", m);
        break;
      case "code":
        out.push({ t: "code", v: atom.v, m });
        break;
      case "ref":
        out.push({ t: "ref", type: atom.type, id: atom.id });
        break;
      case "date":
        out.push({ t: "date", day: atom.day });
        break;
      case "br":
        out.push({ t: "br" });
        break;
      case "link":
        out.push({
          t: "link",
          href: atom.href,
          c: atom.c.map((leaf) => ({ ...leaf, m: leaf.m | m })),
        });
        break;
    }
  });
  return out;
}

/** A link destination right after `](`: `<…>` or a run without spaces, balanced parens. */
function parseDestination(src: string, from: number): { href: string; end: number } | null {
  let i = from;
  let href = "";
  if (src[i] === "<") {
    i += 1;
    while (i < src.length && src[i] !== ">") {
      const ch = src[i] as string;
      if (ch === "\n" || ch === "<") return null;
      if (ch === "\\" && ASCII_PUNCT.test(src[i + 1] ?? "")) {
        href += src[i + 1];
        i += 2;
        continue;
      }
      href += ch;
      i += 1;
    }
    if (src[i] !== ">") return null;
    i += 1;
  } else {
    let depth = 0;
    while (i < src.length) {
      const ch = src[i] as string;
      if (WS.test(ch) || ch.charCodeAt(0) < 0x20) break;
      if (ch === "\\" && ASCII_PUNCT.test(src[i + 1] ?? "")) {
        href += src[i + 1];
        i += 2;
        continue;
      }
      if (ch === "(") depth += 1;
      if (ch === ")") {
        if (depth === 0) break;
        depth -= 1;
      }
      href += ch;
      i += 1;
    }
    if (depth !== 0) return null;
  }
  if (src[i] !== ")") return null;
  return { href, end: i + 1 };
}

/** Inline content (one paragraph, quote or item; "\n" is a line break). */
export function parseInline(src: string): Inline[] {
  const atoms: Atom[] = [];
  const pushText = (v: string) => {
    const prev = atoms[atoms.length - 1];
    if (prev && prev.k === "text") prev.v += v;
    else atoms.push({ k: "text", v });
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (ch === "\\") {
      const next = src[i + 1];
      if (next !== undefined && ASCII_PUNCT.test(next)) {
        pushText(next);
        i += 2;
      } else {
        pushText("\\");
        i += 1;
      }
      continue;
    }
    if (ch === "`") {
      let run = 1;
      while (src[i + run] === "`") run += 1;
      // The closing run: exactly as long, on the same line (code never holds a break).
      let j = i + run;
      let close = -1;
      while (j < src.length && src[j] !== "\n") {
        if (src[j] === "`") {
          let r = 1;
          while (src[j + r] === "`") r += 1;
          if (r === run) {
            close = j;
            break;
          }
          j += r;
        } else {
          j += 1;
        }
      }
      if (close < 0) {
        pushText("`".repeat(run));
        i += run;
        continue;
      }
      let v = src.slice(i + run, close);
      if (v.length >= 2 && v.startsWith(" ") && v.endsWith(" ") && !/^ +$/.test(v)) {
        v = v.slice(1, -1);
      }
      atoms.push({ k: "code", v });
      i = close + run;
      continue;
    }
    if (ch === "m" && src.startsWith("moduo://", i)) {
      URI_RE.lastIndex = i;
      const hit = URI_RE.exec(src);
      if (hit) {
        if (hit[1] !== undefined) {
          if (isIsoDay(hit[1])) {
            atoms.push({ k: "date", day: hit[1] });
            i += hit[0].length;
            continue;
          }
        } else {
          atoms.push({ k: "ref", type: hit[2] as string, id: (hit[3] as string).toLowerCase() });
          i += hit[0].length;
          continue;
        }
      }
      pushText(ch);
      i += 1;
      continue;
    }
    if (ch === "[") {
      atoms.push({ k: "lb" });
      i += 1;
      continue;
    }
    if (ch === "]") {
      let lb = -1;
      for (let k = atoms.length - 1; k >= 0; k--) {
        if ((atoms[k] as Atom).k === "lb") {
          lb = k;
          break;
        }
      }
      const dest = lb >= 0 && src[i + 1] === "(" ? parseDestination(src, i + 2) : null;
      const label = lb >= 0 ? atoms.slice(lb + 1) : [];
      const plainLabel = label.every((a) => a.k === "text" || a.k === "delim" || a.k === "code");
      if (dest && plainLabel && label.length > 0) {
        const uri = WHOLE_URI.exec(dest.href);
        if (uri || isAllowedHref(dest.href)) {
          atoms.length = lb;
          // An earlier `[` can't open a link around this one: it's text now.
          atoms.forEach((a, k) => {
            if (a.k === "lb") atoms[k] = { k: "text", v: "[" };
          });
          if (uri && uri[1] !== undefined && isIsoDay(uri[1]))
            atoms.push({ k: "date", day: uri[1] });
          else if (uri && uri[2] !== undefined) {
            // `[title](moduo://task/…)`: the title is dropped, never stored or drawn.
            atoms.push({ k: "ref", type: uri[2], id: (uri[3] as string).toLowerCase() });
          } else {
            const leaves = atomsToLeaves(label) as Array<TextLeaf | CodeLeaf>;
            atoms.push({ k: "link", href: dest.href, c: leaves });
          }
          i = dest.end;
          continue;
        }
      }
      if (lb >= 0) atoms[lb] = { k: "text", v: "[" };
      pushText("]");
      i += 1;
      continue;
    }
    if (ch === "*" || ch === "~") {
      let run = 1;
      while (src[i + run] === ch) run += 1;
      const before = src[i - 1];
      const after = src[i + run];
      const open = after !== undefined && !WS.test(after);
      const close = before !== undefined && !WS.test(before);
      if ((ch === "~" && run !== 2) || (!open && !close)) {
        pushText(ch.repeat(run));
      } else {
        atoms.push({ k: "delim", ch, n: run, open, close, lit: 0 });
      }
      i += run;
      continue;
    }
    if (ch === "\n") {
      atoms.push({ k: "br" });
      i += 1;
      continue;
    }
    pushText(ch);
    i += 1;
  }
  // Merge text the atoms split, then find URLs, `@channel` and `:name:` in it.
  const leaves = atomsToLeaves(atoms);
  return leaves.flatMap((leaf): Inline[] => (leaf.t === "text" ? splitTextTokens(leaf) : [leaf]));
}

// ── blocks ──────────────────────────────────────────────────────────────────

const FENCE_OPEN = /^ {0,3}(`{3,})([^`]*)$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const BULLET = /^( {0,3})([-*+])(?:[ \t](.*))?$/;
const ORDERED = /^( {0,3})(\d{1,9})([.)])(?:[ \t](.*))?$/;

type Marker = { ordered: boolean; char: string; number: number; indent: number; content: string };

function listMarker(line: string): Marker | null {
  const b = BULLET.exec(line);
  if (b) {
    return {
      ordered: false,
      char: b[2] as string,
      number: 1,
      indent: (b[1] as string).length + 2,
      content: b[3] ?? "",
    };
  }
  const o = ORDERED.exec(line);
  if (o) {
    return {
      ordered: true,
      char: o[3] as string,
      number: Number(o[2]),
      indent: (o[1] as string).length + (o[2] as string).length + 2,
      content: o[4] ?? "",
    };
  }
  return null;
}

/** Whether `line` starts a block while a paragraph is open (CommonMark's interrupt rules). */
function interrupts(line: string, prev: string | undefined): boolean {
  if (FENCE_OPEN.test(line) || QUOTE.test(line)) return true;
  const marker = listMarker(line);
  if (!marker) return false;
  if (prev === "") return true;
  if (marker.content.trim() === "") return false;
  return !marker.ordered || marker.number === 1;
}

/** The stored form → canonical blocks (for canonical input; other input reads leniently). */
export function parseStored(stored: string): Block[] {
  if (stored === "") return [];
  const lines = stored.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  const separator = () => {
    if (lines[i] === "") i += 1;
  };
  while (i < lines.length) {
    const line = lines[i] as string;
    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      const size = (fence[1] as string).length;
      const word = (fence[2] as string).trim().split(/\s+/)[0] ?? "";
      const closing = new RegExp(`^ {0,3}\`{${size},}[ \\t]*$`);
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !closing.test(lines[i] as string)) {
        body.push(lines[i] as string);
        i += 1;
      }
      i += 1; // the closing fence (or the end)
      blocks.push({ t: "pre", v: body.join("\n"), lang: LANG_RE.test(word) ? word : null });
      separator();
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length) {
        const q = QUOTE.exec(lines[i] as string);
        if (!q) break;
        body.push(q[1] as string);
        i += 1;
      }
      blocks.push({ t: "quote", c: parseInline(body.join("\n")) });
      separator();
      continue;
    }
    const first = listMarker(line);
    if (first) {
      const items: string[][] = [];
      let marker: Marker | null = first;
      while (marker) {
        const item = [marker.content];
        const indent = marker.indent;
        i += 1;
        for (;;) {
          const next = lines[i];
          if (next === undefined || next === "") break;
          if (/^\s+$/.test(next)) {
            item.push(next.length > indent ? next.slice(indent) : "");
          } else if (next.startsWith(" ".repeat(indent))) {
            item.push(next.slice(indent));
          } else {
            break;
          }
          i += 1;
        }
        items.push(item);
        const following = lines[i] === undefined ? null : listMarker(lines[i] as string);
        marker =
          following && following.ordered === first.ordered && following.char === first.char
            ? following
            : null;
      }
      blocks.push({
        t: "list",
        ordered: first.ordered,
        start: first.ordered ? first.number : 1,
        items: items.map((item) => parseInline(item.join("\n"))),
      });
      separator();
      continue;
    }
    const para: string[] = [line];
    i += 1;
    while (i < lines.length && !interrupts(lines[i] as string, lines[i - 1])) {
      para.push(lines[i] as string);
      i += 1;
    }
    // The blank line before the next block is its separator, not content.
    if (i < lines.length && para.length > 1 && para[para.length - 1] === "") para.pop();
    else if (i < lines.length && para.length === 1 && para[0] === "") continue;
    blocks.push({ t: "p", c: parseInline(para.join("\n")) });
  }
  return blocks;
}
