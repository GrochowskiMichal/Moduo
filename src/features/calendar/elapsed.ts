// Elapsed-block detection (CAL-4, AC8) — the first half of the completion loop.
//
// A task block flags for triage when its END passed while the task is still
// open. Events never triage; done blocks never triage. This is a pure predicate
// over a `now` instant: the grid's 30s client tick (and its tab-wake catch-up)
// simply re-evaluates it, so a block that elapsed while the tab slept flags the
// moment the tick fires on wake — never a missed-forever state.

import type { TaskBlock } from "./lens";

/** True when this block's task is open and its end is at/behind `nowMs`. */
export function isElapsedBlock(
  block: Pick<TaskBlock, "done" | "endMs">,
  nowMs: number,
): boolean {
  return !block.done && block.endMs <= nowMs;
}

/** The visible blocks that have elapsed and want triage (open, end passed). */
export function elapsedBlocks(blocks: TaskBlock[], nowMs: number): TaskBlock[] {
  return blocks.filter((b) => isElapsedBlock(b, nowMs));
}

/** Ids of the elapsed-and-open blocks — the set the strip/grid triage keys off. */
export function elapsedBlockIds(blocks: TaskBlock[], nowMs: number): Set<string> {
  const out = new Set<string>();
  for (const b of blocks) if (isElapsedBlock(b, nowMs)) out.add(b.taskId);
  return out;
}
