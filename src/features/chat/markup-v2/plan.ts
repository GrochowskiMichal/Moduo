// Where the stored form opens and closes each mark. The serializer writes
// exactly this plan, and the canonical tree is shaped by it: a delimiter can
// only open before a non-space and close after one, so whitespace sitting at
// a planned open or close loses that mark (./canonical.ts). Sharing the plan
// keeps the two in step: overlapping marks (`**a *b** c*`) close and reopen,
// and the reopen point is an edge too.

import { BOLD, type Inline, ITALIC, type Marks, STRIKE } from "./types";

/** A leaf that can carry marks (references, dates, links and breaks end a run). */
export type MarkLeaf = Extract<Inline, { m: Marks }>;

/** The marks closed before a leaf (innermost first), then opened (outermost first). */
export type MarkStep = { close: Marks[]; open: Marks[] };

/** Which mark opens outermost when several start together and last equally long. */
const OPEN_ORDER = [STRIKE, BOLD, ITALIC];

/**
 * One step per leaf, plus a last step closing what's still open. A leaf closes
 * the lowest mark it doesn't carry and everything opened inside it; it opens
 * what it adds, the longest-lasting outermost (so it rarely has to reopen).
 */
export function planMarks(seg: readonly MarkLeaf[]): MarkStep[] {
  const stack: Marks[] = [];
  const steps: MarkStep[] = [];
  const runLength = (from: number, mark: Marks) => {
    let n = 0;
    while (from + n < seg.length && ((seg[from + n] as MarkLeaf).m & mark) !== 0) n += 1;
    return n;
  };
  seg.forEach((leaf, k) => {
    const close: Marks[] = [];
    const lowest = stack.findIndex((mark) => (leaf.m & mark) === 0);
    if (lowest >= 0) {
      for (let s = stack.length - 1; s >= lowest; s--) close.push(stack[s] as Marks);
      stack.length = lowest;
    }
    const open = OPEN_ORDER.filter((mark) => (leaf.m & mark) !== 0 && !stack.includes(mark));
    open.sort((a, b) => runLength(k, b) - runLength(k, a));
    stack.push(...open);
    steps.push({ close, open });
  });
  steps.push({ close: [...stack].reverse(), open: [] });
  return steps;
}

/** The union of a list of marks. */
export function maskOf(marks: readonly Marks[]): Marks {
  return marks.reduce((m, mark) => m | mark, 0);
}
