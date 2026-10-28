// GS-10 (specs/global-search.md Q16, AC13): a note opened from a body hit (⌘K
// or the Notes sidebar search) scrolls to the first match and highlights the
// query's word-starts until you click or type.
//
// Paint only: the matches are DOM Ranges in the CSS Custom Highlight registry,
// styled by `::highlight(note-search-match)` in notes-prose.css. Nothing is
// written into the editor, so nothing reaches the note's Yjs document or a
// collaborator's screen. The ranges are re-found after every update (the doc
// arrives from the pull, a teammate edits), and the first one is scrolled to
// once.

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect, useRef, useSyncExternalStore } from "react";

import {
  clearEntityOpenHighlight,
  entityOpenHighlight,
  subscribeEntityOpenHighlight,
} from "@/lib/entity-open";
import { searchHighlightRanges, searchHighlightTerms } from "@/lib/search-highlight";

export const SEARCH_HIGHLIGHT_NAME = "note-search-match";

/** The query's matches in the note's text, in document order. A word split
 * across formats ("**kum**quat") is matched per run. */
export function noteMatchRanges(root: HTMLElement, query: string): Range[] {
  const terms = searchHighlightTerms(query);
  if (terms.length === 0) return [];
  const doc = root.ownerDocument;
  const out: Range[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const { start, end } of searchHighlightRanges(node.nodeValue ?? "", terms)) {
      const range = doc.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      out.push(range);
    }
  }
  return out;
}

/** Keys that don't count as typing. */
const MODIFIERS = new Set(["Shift", "Meta", "Control", "Alt", "CapsLock"]);

function highlightRegistry(): HighlightRegistry | null {
  if (typeof CSS === "undefined" || !CSS.highlights || typeof Highlight === "undefined") {
    return null;
  }
  return CSS.highlights;
}

export function SearchHighlightPlugin({ noteId }: { noteId: string }) {
  const [editor] = useLexicalComposerContext();
  const query = useSyncExternalStore(
    subscribeEntityOpenHighlight,
    () => entityOpenHighlight(noteId),
    () => null,
  );
  // Whether this note has landed on its match: leaving it then spends the mark,
  // so coming back later opens where you were, not at the match again.
  const landed = useRef(false);

  useEffect(() => {
    landed.current = false;
    if (!query) return;
    const registry = highlightRegistry();
    let frame = 0;
    // A frame already queued when the effect ends must not paint again.
    let live = true;
    const paint = () => {
      frame = 0;
      if (!live) return;
      const root = editor.getRootElement();
      if (!root) return;
      const ranges = noteMatchRanges(root, query);
      if (ranges.length === 0) {
        registry?.delete(SEARCH_HIGHLIGHT_NAME);
        return;
      }
      registry?.set(SEARCH_HIGHLIGHT_NAME, new Highlight(...ranges));
      if (!landed.current) {
        landed.current = true;
        ranges[0]!.startContainer.parentElement?.scrollIntoView({ block: "center" });
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const onPointerDown = () => clearEntityOpenHighlight(noteId);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!MODIFIERS.has(event.key)) clearEntityOpenHighlight(noteId);
    };
    const offRoot = editor.registerRootListener((root, prev) => {
      prev?.removeEventListener("pointerdown", onPointerDown);
      prev?.removeEventListener("keydown", onKeyDown);
      root?.addEventListener("pointerdown", onPointerDown);
      root?.addEventListener("keydown", onKeyDown);
      schedule();
    });
    const offUpdate = editor.registerUpdateListener(schedule);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      offUpdate();
      offRoot();
      const root = editor.getRootElement();
      root?.removeEventListener("pointerdown", onPointerDown);
      root?.removeEventListener("keydown", onKeyDown);
      registry?.delete(SEARCH_HIGHLIGHT_NAME);
    };
  }, [editor, noteId, query]);

  useEffect(
    () => () => {
      if (landed.current) clearEntityOpenHighlight(noteId);
    },
    [noteId],
  );

  return null;
}
