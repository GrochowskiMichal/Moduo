// The tree → the stored form. Writes only canonical trees (./canonical.ts) and
// escapes every literal character the parser (or a CommonMark reader such as
// an agent or the export) would take for syntax, so text typed as `*`, `[x]`,
// `- item` or `moduo://…` comes back as typed. Blocks are separated by one
// blank line; inside a block every line break is "\n".

import { canonicalBlocks } from "./canonical";
import { type MarkLeaf, type MarkStep, planMarks } from "./plan";
import { tokenText } from "./tokens";
import { type Block, BOLD, type Inline, ITALIC, STRIKE } from "./types";

/** One stretch of output: literal text (escaped later, with its neighbours known) or syntax. */
type Piece = { s: string; lit: boolean; label: boolean };

const DELIM: Record<number, string> = { [BOLD]: "**", [ITALIC]: "*", [STRIKE]: "~~" };

/** `` `code` `` with a fence longer than any backtick run inside, padded when it must be. */
export function codeSpan(v: string): string {
  const longest = Math.max(0, ...(v.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad =
    v.startsWith("`") ||
    v.endsWith("`") ||
    (v.startsWith(" ") && v.endsWith(" ") && !/^ +$/.test(v));
  return pad ? `${fence} ${v} ${fence}` : `${fence}${v}${fence}`;
}

/** A link target (never with whitespace: ./canonical.ts) with `()<>\` escaped. */
function destination(href: string): string {
  return href.replace(/[()<>\\]/g, (c) => `\\${c}`);
}

/** Open and close marks around a run of leaves that can carry them (./plan.ts). */
function emitSegment(seg: MarkLeaf[], out: Piece[], label: boolean): void {
  const raw = (s: string) => out.push({ s, lit: false, label });
  const steps = planMarks(seg);
  const delimiters = (step: MarkStep) => {
    for (const mark of step.close) raw(DELIM[mark] as string);
    for (const mark of step.open) raw(DELIM[mark] as string);
  };
  seg.forEach((leaf, k) => {
    delimiters(steps[k] as MarkStep);
    if (leaf.t === "code") raw(codeSpan(leaf.v));
    else out.push({ s: leaf.t === "text" ? leaf.v : tokenText(leaf), lit: true, label });
  });
  delimiters(steps[seg.length] as MarkStep);
}

/** One line's leaves (no `br`) as pieces. References, dates and links end every run of marks. */
function emitLeaves(leaves: readonly Inline[], out: Piece[], label: boolean): void {
  let seg: MarkLeaf[] = [];
  const flush = () => {
    if (seg.length) emitSegment(seg, out, label);
    seg = [];
  };
  for (const leaf of leaves) {
    if (leaf.t === "ref") {
      flush();
      out.push({ s: `moduo://${leaf.type}/${leaf.id}`, lit: false, label });
    } else if (leaf.t === "date") {
      flush();
      out.push({ s: `moduo://date/${leaf.day}`, lit: false, label });
    } else if (leaf.t === "link") {
      flush();
      out.push({ s: "[", lit: false, label: true });
      emitLeaves(leaf.c, out, true);
      out.push({ s: `](${destination(leaf.href)})`, lit: false, label: false });
    } else if (leaf.t !== "br") {
      seg.push(leaf);
    }
  }
  flush();
}

/**
 * The index of the character that would start a block (or a heading, rule or
 * setext line for a CommonMark reader) at the start of a line, or -1.
 */
function lineStartEscape(chars: Array<{ ch: string; lit: boolean }>): number {
  let j = 0;
  while (j < chars.length && chars[j]?.lit && /[ \t]/.test(chars[j]?.ch as string)) j += 1;
  const head = chars[j];
  if (!head?.lit) return -1;
  const rest = chars
    .slice(j)
    .map((c) => c.ch)
    .join("");
  const ch = head.ch;
  if (ch === ">") return j;
  if ((ch === "-" || ch === "+") && /^[-+](?:[ \t]|$)/.test(rest)) return j;
  if (ch === "-" && /^-[-\s]*$/.test(rest)) return j;
  if (ch === "=" && /^=+\s*$/.test(rest)) return j;
  if (ch === "_" && /^(?:_\s*){3,}$/.test(rest)) return j;
  if (ch === "#" && /^#{1,6}(?:\s|$)/.test(rest)) return j;
  const ordered = /^(\d{1,9})[.)](?:[ \t]|$)/.exec(rest);
  if (ordered) return j + (ordered[1] as string).length;
  return -1;
}

/** Pieces → text: literal characters escaped where they'd read as syntax. */
function render(pieces: Piece[]): string {
  const chars: Array<{ ch: string; lit: boolean; label: boolean }> = [];
  for (const p of pieces) for (const ch of p.s) chars.push({ ch, lit: p.lit, label: p.label });
  const lineEscape = lineStartEscape(chars);
  let out = "";
  chars.forEach((c, k) => {
    if (!c.lit) {
      out += c.ch;
      return;
    }
    let esc = k === lineEscape;
    switch (c.ch) {
      case "\\":
      case "*":
      case "`":
      case "[":
        esc = true;
        break;
      case "]":
        esc ||= c.label;
        break;
      case "~":
        esc ||= chars[k - 1]?.ch === "~" || chars[k + 1]?.ch === "~";
        break;
      case "<":
        esc ||= /[A-Za-z/!?]/.test(chars[k + 1]?.ch ?? "");
        break;
      case "!":
        // `![x](u)` is an image to a CommonMark reader.
        esc ||= chars[k + 1]?.ch === "[" && chars[k + 1]?.lit === false;
        break;
      case ":": {
        // Text that spells a Moduo URI stays text: `moduo\://task/…`.
        const before = chars
          .slice(Math.max(0, k - 5), k)
          .map((x) => x.ch)
          .join("");
        esc ||= before === "moduo" && chars[k + 1]?.ch === "/" && chars[k + 2]?.ch === "/";
        break;
      }
    }
    out += esc ? `\\${c.ch}` : c.ch;
  });
  return out;
}

/** Split inline content into lines at its `br`s. */
function lines(leaves: readonly Inline[]): Inline[][] {
  const out: Inline[][] = [[]];
  for (const leaf of leaves) {
    if (leaf.t === "br") out.push([]);
    else (out[out.length - 1] as Inline[]).push(leaf);
  }
  return out;
}

function renderLine(line: readonly Inline[]): string {
  const pieces: Piece[] = [];
  emitLeaves(line, pieces, false);
  return render(pieces);
}

function serializeBlock(block: Block): string {
  switch (block.t) {
    case "p":
      return lines(block.c).map(renderLine).join("\n");
    case "quote":
      return lines(block.c)
        .map((line) => {
          const s = renderLine(line);
          return s ? `> ${s}` : ">";
        })
        .join("\n");
    case "pre": {
      const longest = Math.max(0, ...(block.v.match(/`+/g) ?? []).map((run) => run.length));
      const fence = "`".repeat(Math.max(3, longest + 1));
      const open = `${fence}${block.lang ?? ""}`;
      return block.v === "" ? `${open}\n${fence}` : `${open}\n${block.v}\n${fence}`;
    }
    case "list":
      return block.items
        .map((item, k) => {
          const marker = block.ordered ? `${block.start + k}.` : "-";
          const indent = " ".repeat(marker.length + 1);
          return lines(item)
            .map((line, j) => {
              const s = renderLine(line);
              if (j > 0) return indent + s;
              return s ? `${marker} ${s}` : marker;
            })
            .join("\n");
        })
        .join("\n");
  }
}

/** The tree → the stored form (canonicalised first; the result parses back to it). */
export function serializeBlocks(blocks: readonly Block[]): string {
  return canonicalBlocks(blocks).map(serializeBlock).join("\n\n");
}
