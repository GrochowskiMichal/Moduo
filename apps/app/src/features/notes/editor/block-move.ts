/**
 * Moving a top-level block (NR-4, AC7): ⌥⇧↑ / ⌥⇧↓ and the block handle's drag
 * share this one code path.
 *
 * The move is made on the Yjs doc, not through Lexical. The v2 collab binding
 * turns a Lexical move into in-place text rewrites of the blocks it passes
 * (the Yjs elements stay put and swap contents), so a peer typing inside the
 * moved block at that moment would see their words land in a different block.
 * Yjs has no move either: deleting and re-inserting an element drops whatever
 * a peer types into it concurrently. So the moved block keeps its Yjs element
 * and the blocks it jumps over are re-created on its other side, in one
 * transaction. A peer's concurrent text inside the moved block survives; one
 * typed inside a jumped-over block at the same instant is the (much rarer)
 * casualty. The binding then applies the change to the editor like a remote
 * edit, so the caret, which sits in the moved block, stays where it was.
 */

import * as Y from "yjs";

import { NOTES_DOC_ROOT } from "./doc-markdown";

export type BlockMoveDirection = "up" | "down";

/** The Yjs transaction origin of a block move: local, so the engine pushes it. */
export const BLOCK_MOVE_ORIGIN = "notes:block-move";

/** Where a one-step move of block `index` lands, or null at the edge. */
export function stepTarget(
  index: number,
  direction: BlockMoveDirection,
  count: number,
): number | null {
  const to = direction === "up" ? index - 1 : index + 1;
  return to < 0 || to >= count ? null : to;
}

/**
 * Move the top-level block at `from` so it ends up at index `to`. Returns
 * false when nothing moved (same place, or an index out of range).
 */
export function moveBlockInDoc(doc: Y.Doc, from: number, to: number): boolean {
  const root = doc.get(NOTES_DOC_ROOT, Y.XmlElement);
  const count = root.length;
  if (from === to || from < 0 || to < 0 || from >= count || to >= count) return false;
  doc.transact(() => {
    if (to < from) {
      // The blocks [to, from) re-created just after the moved block.
      const span = root.slice(to, from).map((node) => node.clone());
      root.insert(from + 1, span);
      root.delete(to, span.length);
    } else {
      // The blocks (from, to] re-created just before it.
      const span = root.slice(from + 1, to + 1).map((node) => node.clone());
      root.insert(from, span);
      root.delete(from + 1 + span.length, span.length);
    }
  }, BLOCK_MOVE_ORIGIN);
  return true;
}
