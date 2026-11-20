/**
 * Comments anchored to text (NR-8, specs/notes-refresh.md assumption 20).
 *
 * The note's text carries `@lexical/mark` MarkNodes whose ids are thread ids,
 * so the highlight follows edits (and peers) inside the Yjs doc. A thread is
 * every comment on the note sharing an `anchorId`. This file holds the two
 * halves the panel and the editor plugin share:
 *
 *   - `$`-helpers that read and change marks inside an editor update;
 *   - `groupThreads`, the pure shaping of a note's comments into the panel's
 *     groups: open threads in document order, Detached (the text is gone),
 *     Resolved, and the note-level thread (no anchor: every older comment,
 *     quote-comments included).
 */

import {
  $isMarkNode,
  $unwrapMarkNode,
  $wrapSelectionInMarkNode,
  type MarkNode,
} from "@lexical/mark";
import { $getRoot, $isElementNode, type LexicalNode, type RangeSelection } from "lexical";

import type { SpineComment } from "@/lib/runtime.types";

/** Every mark in the doc, in document order. */
function $marks(): MarkNode[] {
  const out: MarkNode[] = [];
  const walk = (node: LexicalNode) => {
    if ($isMarkNode(node)) out.push(node);
    if ($isElementNode(node)) for (const child of node.getChildren()) walk(child);
  };
  walk($getRoot());
  return out;
}

/** The thread ids anchored in the doc, each once, in document order. */
export function $anchorIdsInOrder(): string[] {
  const seen = new Set<string>();
  for (const mark of $marks()) for (const id of mark.getIDs()) seen.add(id);
  return [...seen];
}

/** Anchor a new thread to the selection. False when nothing is selected. */
export function $anchorSelection(selection: RangeSelection, anchorId: string): boolean {
  if (selection.isCollapsed() || selection.getTextContent().trim() === "") return false;
  $wrapSelectionInMarkNode(selection, selection.isBackward(), anchorId);
  return true;
}

/** Take a thread's highlight out of the doc (resolve): the text stays. */
export function $unanchor(anchorId: string): void {
  for (const mark of $marks()) {
    if (!mark.hasID(anchorId)) continue;
    if (mark.getIDs().length > 1) mark.deleteID(anchorId);
    else $unwrapMarkNode(mark);
  }
}

/** Each thread's first mark, in one walk (the margin measures every open
 * thread on each change; a walk per thread grew with threads × blocks). */
export function $firstMarkKeys(): Map<string, string> {
  const out = new Map<string, string>();
  for (const mark of $marks()) {
    for (const id of mark.getIDs()) if (!out.has(id)) out.set(id, mark.getKey());
  }
  return out;
}

/** The first mark carrying a thread id, for scrolling to it. */
export function $firstMarkKey(anchorId: string): string | null {
  return (
    $marks()
      .find((m) => m.hasID(anchorId))
      ?.getKey() ?? null
  );
}

export type CommentThreadGroup = {
  anchorId: string;
  /** Oldest first. */
  comments: SpineComment[];
  resolved: boolean;
};

export type GroupedThreads = {
  /** Open threads whose text is in the doc, in document order. */
  open: CommentThreadGroup[];
  /** Open threads whose text was deleted: still readable, no highlight. */
  detached: CommentThreadGroup[];
  resolved: CommentThreadGroup[];
  /** Comments with no anchor (every pre-NR-8 comment): the note-level thread. */
  noteLevel: SpineComment[];
};

/**
 * Shape a note's comments for the panel. `docOrder` is `$anchorIdsInOrder()`
 * of the live doc, or null while no editor is open (then no thread counts as
 * detached: nothing proves its text is gone).
 */
export function groupThreads(
  comments: readonly SpineComment[],
  docOrder: readonly string[] | null,
): GroupedThreads {
  const noteLevel: SpineComment[] = [];
  const byAnchor = new Map<string, CommentThreadGroup>();
  for (const c of comments) {
    if (!c.anchorId) {
      noteLevel.push(c);
      continue;
    }
    const group = byAnchor.get(c.anchorId) ?? {
      anchorId: c.anchorId,
      comments: [],
      resolved: false,
    };
    group.comments.push(c);
    if (c.resolvedAt) group.resolved = true;
    byAnchor.set(c.anchorId, group);
  }
  const position = new Map((docOrder ?? []).map((id, i) => [id, i]));
  const open: CommentThreadGroup[] = [];
  const detached: CommentThreadGroup[] = [];
  const resolved: CommentThreadGroup[] = [];
  for (const group of byAnchor.values()) {
    if (group.resolved) resolved.push(group);
    else if (docOrder === null || position.has(group.anchorId)) open.push(group);
    else detached.push(group);
  }
  const at = (g: CommentThreadGroup) => position.get(g.anchorId) ?? Number.MAX_SAFE_INTEGER;
  const firstAt = (g: CommentThreadGroup) => g.comments[0]?.createdAt ?? "";
  open.sort((a, b) => at(a) - at(b) || firstAt(a).localeCompare(firstAt(b)));
  detached.sort((a, b) => firstAt(a).localeCompare(firstAt(b)));
  resolved.sort((a, b) => firstAt(b).localeCompare(firstAt(a)));
  return { open, detached, resolved, noteLevel };
}
