// A pasted list in the capture title (tasks-v3 §10, AC10.8; research §4).
// Two or more lines offer "Create n tasks?". Pure, so the clean-up rules are
// unit-tested:
// - blank lines are ignored;
// - bullets (`-`, `*`, `•`, `+`, `–`), numbers (`1.`, `1)`) and `[ ]` boxes
//   are stripped; `[x]` lines are done already, so they're skipped and counted;
// - an indented line is a subtask of the line above it; deeper levels flatten
//   to one (subtasks are one level, 28);
// - at most 500 tasks, parents and subtasks together; the rest is counted.

/** The most tasks one paste makes (spec edge case "Capture and references"). */
export const PASTE_CAP = 500;

export type PastedItem = { title: string; children: string[] };

export type PastedList = {
  /** The tasks to make, in order, each with its subtasks. */
  items: PastedItem[];
  /** How many tasks that is (parents and subtasks). */
  count: number;
  /** Lines checked off already (`[x]`), skipped. */
  skippedDone: number;
  /** Tasks past the cap, not made. */
  overCap: number;
};

const BULLET = /^(?:[-*•+–]|\d{1,3}[.)])\s+/;
const BOX = /^\[( |x|X)\]\s*/;

/** Leading whitespace as a width: a tab counts as four spaces. */
function indentOf(line: string): number {
  const lead = /^[\t ]*/.exec(line)?.[0] ?? "";
  let width = 0;
  for (const ch of lead) width += ch === "\t" ? 4 : 1;
  return width;
}

/** The words of one line, or null when it's done already (`[x]`). */
function cleanLine(line: string): { text: string; done: boolean } {
  let text = line.trim().replace(BULLET, "");
  const box = BOX.exec(text);
  if (box) {
    text = text.slice(box[0].length);
    if (box[1] !== " ") return { text: text.trim(), done: true };
  }
  return { text: text.trim(), done: false };
}

/** Does this paste hold a list (two or more lines with words)? */
export function isPastedList(text: string): boolean {
  return text.split(/\r?\n/).filter((l) => l.trim() !== "").length >= 2;
}

/** Read a pasted list. */
export function parsePastedList(text: string, cap: number = PASTE_CAP): PastedList {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const items: PastedItem[] = [];
  let skippedDone = 0;
  let overCap = 0;
  let count = 0;
  // The indent of the top level: the first line's, or less when a later line sits further left.
  let baseIndent: number | null = null;
  /** The top-level line subtasks attach to; null after one past the cap. */
  let current: PastedItem | null = null;
  for (const line of lines) {
    const indent = indentOf(line);
    const { text: words, done } = cleanLine(line);
    const topLevel = baseIndent === null || indent <= baseIndent;
    if (topLevel) baseIndent = indent;
    if (done) {
      // Done already: skipped. Its own indented lines then stand on their own.
      skippedDone += 1;
      if (topLevel) current = null;
      continue;
    }
    if (!words) continue;
    if (count >= cap) {
      // Past the cap; a dropped line's subtasks go with it.
      if (topLevel) current = null;
      overCap += 1;
      continue;
    }
    if (topLevel || !current) {
      current = topLevel ? { title: words, children: [] } : null;
      items.push(current ?? { title: words, children: [] });
      count += 1;
      continue;
    }
    // Indented under the line above: a subtask of the last top-level line.
    current.children.push(words);
    count += 1;
  }
  return { items, count, skippedDone, overCap };
}

/** "Keep as one": the first line is the title, the rest goes to the description. */
export function keepAsOne(text: string): { title: string; description: string } {
  const lines = text.split(/\r?\n/);
  const first = lines.findIndex((l) => l.trim() !== "");
  if (first === -1) return { title: "", description: "" };
  return {
    title: cleanLine(lines[first]).text,
    description: lines
      .slice(first + 1)
      .join("\n")
      .trim(),
  };
}
