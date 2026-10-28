// A SearchHit snippet (GS-2, specs/global-search.md Assumption 2) marks its
// matches between U+E000 and U+E001: plain text the client splits and draws,
// never HTML. These are the pieces to draw, markers removed.

import { SEARCH_SNIPPET_END, SEARCH_SNIPPET_START } from "@contracts/search";

export type SnippetSegment = { text: string; marked: boolean };

/** Plain and marked runs, in order; a stray end marker is dropped and an
 * unclosed start marks to the end, so a marker is never drawn. */
export function snippetSegments(snippet: string): SnippetSegment[] {
  const out: SnippetSegment[] = [];
  let marked = false;
  let text = "";
  const flush = () => {
    if (!text) return;
    const last = out.at(-1);
    if (last && last.marked === marked) last.text += text;
    else out.push({ text, marked });
    text = "";
  };
  for (const ch of snippet) {
    if (ch === SEARCH_SNIPPET_START || ch === SEARCH_SNIPPET_END) {
      const next = ch === SEARCH_SNIPPET_START;
      if (next !== marked) {
        flush();
        marked = next;
      }
      continue;
    }
    text += ch;
  }
  flush();
  return out;
}
