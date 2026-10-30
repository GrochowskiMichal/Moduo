/**
 * Stored markdown escapes only what would change meaning.
 *
 * `body_md` (MCP reads, the published page, `.md` export) went through
 * Lexical's text export, which puts a backslash before every `* _ ` ~ \` it
 * writes: a key kept in a note reached agents as `sbp\_fc77…`. It escaped
 * nothing at a line start, so a pasted `# comment` line read back as a
 * heading. Here a character carries a backslash only when CommonMark + GFM
 * (the published page) or Lexical's own importer could read it as syntax:
 *
 * - a `* _ ~ ==` run that either reader could open or close emphasis with
 *   AND that has a run in its block to pair with (format markers count), or
 *   that touches a format marker of its own character: `sbp_fc77`, `a * b`
 *   and `~/code` stay bare, `2*3*4` doesn't;
 * - a backtick when the block holds another backtick run or a code span;
 * - a backslash before ASCII punctuation or at the end of a run;
 * - `&` that would start a character reference, and `[` before a `](`
 *   (written `&#91;`: Lexical's link import ignores a backslash);
 * - a block marker at the start of a line (`#`, `>`, `-`, `1.`, fences,
 *   `---`, `| row |`, `|-|`, `[ ]`, `[ref]:`) in a paragraph, quote or list
 *   item, and a heading's closing `#`.
 *
 * Partners are found conservatively (no rule of three, no length matching),
 * so a run may keep a backslash it doesn't strictly need, never the reverse.
 *
 * Full-document export only, inside `$withEscapeCache` (`$notesMarkdown`
 * does both): a selection export slices the text itself and would cut at the
 * wrong offsets. The clipboard puts its literal export first, so this never
 * runs for a copy.
 */

import { $isListItemNode } from "@lexical/list";
import type { TextMatchTransformer } from "@lexical/markdown";
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import { $isTableCellNode } from "@lexical/table";
import {
  $isElementNode,
  $isLineBreakNode,
  $isParagraphNode,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
  type TextFormatType,
  type TextNode,
} from "lexical";

/** Lexical's exporter escapes these itself; a private-use stand-in carries
 * one through it bare. The backslash's stand-in also marks an escape added
 * here. */
const STAND_IN = new Map(
  ["*", "_", "`", "~", "\\"].map((char, i) => [char, String.fromCharCode(0xe000 + i)]),
);
const FROM_STAND_IN = new Map([...STAND_IN].map(([char, standIn]) => [standIn, char]));

/** Formats written as markers around a run, and the marker's character. */
const MARKERS: [TextFormatType, string][] = [
  ["bold", "*"],
  ["italic", "*"],
  ["strikethrough", "~"],
  ["highlight", "="],
];

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const REFERENCE = /&(?:#\d{1,7};|#[xX][0-9a-fA-F]{1,6};|[A-Za-z][A-Za-z0-9]{1,31};)/y;

type CharClass = "space" | "punct" | "word";

/** One side of a run as each reader sees it: Lexical's importer (ASCII
 * punctuation only) and micromark, the published page (Unicode punctuation
 * and symbols, read per UTF-16 unit, so an emoji counts as a word). `marker`
 * holds the delimiter or format-marker characters found there. */
interface Side {
  lexical: CharClass;
  page: CharClass;
  marker: string;
}

const SPACE: Side = { lexical: "space", page: "space", marker: "" };
const punct = (marker = ""): Side => ({ lexical: "punct", page: "punct", marker });

function sideOf(unit: string): Side {
  if (/\s/.test(unit)) return SPACE;
  return {
    lexical: ASCII_PUNCTUATION.test(unit) ? "punct" : "word",
    page: /[\p{P}\p{S}]/u.test(unit) ? "punct" : "word",
    marker: "*_~=`".includes(unit) ? unit : "",
  };
}

/** The marker characters written around a run (a backtick fence for code). */
function markerChars(node: TextNode): string {
  if (node.hasFormat("code")) return "`";
  return MARKERS.filter(([format]) => node.hasFormat(format))
    .map(([, char]) => char)
    .join("");
}

const hasMarkers = (node: TextNode) => markerChars(node) !== "";

/** The block a run belongs to: emphasis never pairs across blocks. A table
 * cell's paragraphs share one line of the table, so the cell is the block. */
function $blockOf(node: LexicalNode): ElementNode | null {
  for (let parent = node.getParent(); parent; parent = parent.getParent()) {
    if (parent.isInline()) continue;
    const cell = parent.getParent();
    return $isTableCellNode(cell) ? cell : parent;
  }
  return null;
}

/** What the output holds just outside one end of a run's text: a formatted
 * run's own markers (its edge spaces go outside them), or its neighbour. */
function $edge(node: TextNode, forward: boolean): Side {
  const own = markerChars(node);
  if (own !== "") return punct(own);
  const sibling = forward ? node.getNextSibling() : node.getPreviousSibling();
  if (sibling === null) {
    // A block edge reads as a line end; an inline parent's edge is its bracket.
    return node.getParent()?.isInline() ? punct() : SPACE;
  }
  if ($isLineBreakNode(sibling)) return SPACE;
  if (!$isTextNode(sibling)) return punct(); // links, chips, embeds: brackets
  const markers = markerChars(sibling);
  if (markers !== "") return punct(markers);
  const text = sibling.getTextContent();
  return text === "" ? punct() : sideOf(forward ? text[0]! : text[text.length - 1]!);
}

interface Run {
  key: string;
  start: number;
  end: number;
  char: string;
  canOpen: boolean;
  canClose: boolean;
  /** Next to a marker of its own character (unescaped, the two merge), or
   * at a formatted run's inner edge (where it decides whether the run's own
   * markers flank). */
  touches: boolean;
}

/** CommonMark's flanking rules (GFM's `~` and Lexical's `==` follow `*`);
 * micromark also lets a run open before, or close after, another `* _ ~`. */
function commonMark(
  char: string,
  before: CharClass,
  after: CharClass,
  markerBefore = false,
  markerAfter = false,
) {
  const left = markerAfter || (after !== "space" && (after !== "punct" || before !== "word"));
  const right = markerBefore || (before !== "space" && (before !== "punct" || after !== "word"));
  if (char !== "_") return { canOpen: left, canClose: right };
  return {
    canOpen: left && (!right || before !== "word"),
    canClose: right && (!left || after !== "word"),
  };
}

/** Whether either reader could open or close emphasis with this run. */
function flanking(char: string, before: Side, after: Side) {
  const lexical = commonMark(char, before.lexical, after.lexical);
  const attention = (side: Side) => /[*_~]/.test(side.marker);
  const page = commonMark(char, before.page, after.page, attention(before), attention(after));
  return {
    canOpen: lexical.canOpen || page.canOpen,
    canClose: lexical.canClose || page.canClose,
  };
}

/** The run `text[start..end)`, or null for a lone `=` that touches no `=`
 * marker (Lexical's highlight is `==`). `bounds` is where a formatted run's
 * markers sit (inside its edge spaces). */
function $runAt(
  node: TextNode,
  text: string,
  start: number,
  end: number,
  bounds: { first: number; last: number },
): Run | null {
  const char = text[start]!;
  const before = start <= bounds.first ? $edge(node, false) : sideOf(text[start - 1]!);
  const after = end >= bounds.last ? $edge(node, true) : sideOf(text[end]!);
  const innerEdge = hasMarkers(node) && (start <= bounds.first || end >= bounds.last);
  const touches = innerEdge || before.marker.includes(char) || after.marker.includes(char);
  if (char === "=" && end - start < 2 && !touches) return null;
  return { key: node.getKey(), start, end, char, touches, ...flanking(char, before, after) };
}

/** The delimiter runs of one text node that isn't code. */
function $runsOf(node: TextNode): Run[] {
  const text = node.getTextContent();
  const marked = hasMarkers(node);
  const bounds = {
    first: marked ? text.length - text.trimStart().length : 0,
    last: marked ? text.trimEnd().length : text.length,
  };
  const runs: Run[] = [];
  for (let start = 0; start < text.length;) {
    let end = start + 1;
    while (end < text.length && text[end] === text[start]) end++;
    const run = "*_~=`".includes(text[start]!) ? $runAt(node, text, start, end, bounds) : null;
    if (run) runs.push(run);
    start = end;
  }
  return runs;
}

/** Every delimiter run in a block, in order: text runs plus the markers
 * formatted runs are wrapped in (which pair with anything) and code fences. */
function $blockRuns(block: ElementNode): Run[] {
  const runs: Run[] = [];
  const marker = (node: LexicalNode, char: string): Run => ({
    key: node.getKey(),
    start: -1,
    end: -1,
    char,
    canOpen: true,
    canClose: true,
    touches: false,
  });
  const visit = (node: LexicalNode) => {
    if ($isTextNode(node)) {
      const chars = [...markerChars(node)];
      for (const char of chars) runs.push(marker(node, char));
      if (!node.hasFormat("code")) runs.push(...$runsOf(node));
      for (const char of chars) runs.push(marker(node, char));
    } else if ($isElementNode(node)) {
      for (const child of node.getChildren()) visit(child);
    }
  };
  for (const child of block.getChildren()) visit(child);
  return runs;
}

/** The runs that need a backslash, as `nodeKey:start`: a run that touches
 * its own marker, one that could pair with a later closer or an earlier
 * opener of its character, a backtick beside any other. Linear: one pass
 * each way. */
function escapedRuns(runs: Run[]): Set<string> {
  const openerBefore: boolean[] = [];
  const closerAfter: boolean[] = [];
  let seen = new Set<string>();
  runs.forEach((run, i) => {
    openerBefore[i] = seen.has(run.char);
    if (run.canOpen) seen.add(run.char);
  });
  seen = new Set();
  for (let i = runs.length - 1; i >= 0; i--) {
    closerAfter[i] = seen.has(runs[i]!.char);
    if (runs[i]!.canClose) seen.add(runs[i]!.char);
  }
  const backticks = runs.filter((run) => run.char === "`").length;
  const escaped = new Set<string>();
  runs.forEach((run, i) => {
    const pairs =
      run.char === "`"
        ? backticks > 1
        : (run.canOpen && closerAfter[i]) || (run.canClose && openerBefore[i]);
    if (run.start >= 0 && (run.touches || pairs)) escaped.add(`${run.key}:${run.start}`);
  });
  return escaped;
}

let blockEscapes: WeakMap<ElementNode, Set<string>> | null = null;

/** Run an export with each block's escapes worked out once. An export reads
 * one frozen state, so a block can't change under it; per run, the work
 * would be quadratic in the block (a pasted log is one paragraph). */
export function $withEscapeCache<T>(exportMarkdown: () => T): T {
  if (blockEscapes) return exportMarkdown();
  blockEscapes = new WeakMap();
  try {
    return exportMarkdown();
  } finally {
    blockEscapes = null;
  }
}

function $escapesOf(block: ElementNode): Set<string> {
  const cached = blockEscapes?.get(block);
  if (cached) return cached;
  const escaped = escapedRuns($blockRuns(block));
  blockEscapes?.set(block, escaped);
  return escaped;
}

const LINE_MARKERS: RegExp[] = [
  /^#{1,6}(?:[ \t]|$)/, // heading
  /^>/, // quote
  /^[-+*](?:[ \t]|$)/, // bullet
  /^(?:`{3,}|~{3,})/, // fence
  /^\[(?:\s|x|X)?\][ \t]/, // Lexical's checkbox
  /^\[[^\]]*\]:/, // link reference definition
  /^\|.+\|\s?$/, // Lexical's table row
  /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/, // divider
];
const ORDERED_MARKER = /^\d{1,9}[.)](?:[ \t]|$)/;
const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/;
const TABLE_DELIMITER_ROW = /^(?=.*\|)(?=.*-)[|:\- \t]+$/;

/** The text of a run's line from the run on, up to the next line break. */
function $lineFrom(node: TextNode, text: string): string {
  let line = text;
  for (
    let next = node.getNextSibling();
    next && !$isLineBreakNode(next);
    next = next.getNextSibling()
  ) {
    line += next.getTextContent();
  }
  return line;
}

/** Where a block marker sits at the start of this run's line, if it does.
 * Returns the index of the character to escape. */
function $lineMarkerAt(node: TextNode, text: string): number | null {
  if (hasMarkers(node)) return null; // the line starts with the run's marker
  const parent = node.getParent();
  const previous = node.getPreviousSibling();
  if (previous !== null && !$isLineBreakNode(previous)) return null;
  const isBlock =
    ($isParagraphNode(parent) && !$isTableCellNode(parent.getParent())) ||
    $isQuoteNode(parent) ||
    $isListItemNode(parent);
  if (!isBlock) return null;
  const line = $lineFrom(node, text);
  const indent = line.length - line.replace(/^[ \t]+/, "").length;
  const rest = line.slice(indent);
  if (indent >= text.length) return null;
  if (LINE_MARKERS.some((marker) => marker.test(rest))) return indent;
  const ordered = rest.match(ORDERED_MARKER);
  if (ordered) return indent + ordered[0].search(/[.)]/);
  const continues = previous !== null;
  if (continues && (SETEXT_UNDERLINE.test(rest) || TABLE_DELIMITER_ROW.test(rest))) return indent;
  return null;
}

/** A heading's trailing `#` run reads as a closing sequence and vanishes. */
function $closingHashAt(node: TextNode, text: string): number | null {
  if (!$isHeadingNode(node.getParent()) || node.getNextSibling() !== null) return null;
  const match = text.match(/(?:^|[ \t])(#+)[ \t]*$/);
  return match ? text.length - match[0].length + match[0].indexOf("#") : null;
}

/** A backslash before punctuation or at the run's end, and an `&` that
 * starts a character reference. */
function markCharacters(text: string, marks: boolean[]) {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") {
      marks[i] = i === text.length - 1 || ASCII_PUNCTUATION.test(text[i + 1]!);
    } else if (text[i] === "&") {
      REFERENCE.lastIndex = i;
      marks[i] = REFERENCE.test(text);
    }
  }
}

/** Per character: does it need escaping to stay literal? */
function $literalMarks(node: TextNode, text: string): boolean[] {
  const marks = Array.from({ length: text.length }, () => false);
  const runs = $runsOf(node);
  const block = $blockOf(node);
  const escaped = runs.length > 0 && block ? $escapesOf(block) : new Set<string>();
  for (const run of runs) {
    if (escaped.has(`${run.key}:${run.start}`)) marks.fill(true, run.start, run.end);
  }
  markCharacters(text, marks);
  for (const at of [$lineMarkerAt(node, text), $closingHashAt(node, text)]) {
    if (at === null) continue;
    // A marker that is a delimiter goes literal as a whole run.
    const run = runs.find((r) => r.start <= at && at < r.end);
    if (run) marks.fill(true, run.start, run.end);
    else marks[at] = true;
  }
  return marks;
}

/** One character as handed to Lexical's exporter: a character it escapes
 * stays bare as a stand-in unless marked, any other marked character gets
 * a stand-in backslash, and `[` opening a link is a reference (Lexical's
 * link import ignores a backslash there, and leaves it behind). */
function stagedChar(char: string, marked: boolean, opensLink: boolean): string {
  if (char === "&") return marked ? "&#38;" : char;
  if (char === "[" && opensLink) return "&#91;";
  const standIn = STAND_IN.get(char);
  if (standIn !== undefined) return marked ? char : standIn;
  return marked ? STAND_IN.get("\\")! + char : char;
}

function staged(text: string, marks: boolean[]): string {
  const linkEnd = text.lastIndexOf("](");
  let out = "";
  for (let i = 0; i < text.length; i++) out += stagedChar(text[i]!, marks[i]!, i < linkEnd);
  return out;
}

/** `NOTES_TRANSFORMERS`' text export: a run inside its format markers, with
 * only the escapes listed above. Code runs keep the default path (never
 * escaped); text holding a stand-in character keeps Lexical's escaping. */
export const STORED_TEXT_EXPORT: TextMatchTransformer = {
  dependencies: [],
  type: "text-match",
  regExp: /(?!)/,
  export: (node, _exportChildren, exportFormat) => {
    if (!$isTextNode(node) || node.hasFormat("code")) return null;
    const text = node.getTextContent();
    if ([...FROM_STAND_IN.keys()].some((standIn) => text.includes(standIn))) return null;
    const out = exportFormat(node, staged(text, $literalMarks(node, text)));
    return Array.from(out, (char) => FROM_STAND_IN.get(char) ?? char).join("");
  },
};
