/**
 * Small DOM bridges from the right panel into the open editor (lifted from the
 * classic page): scroll to a quoted snippet (older quote-comments), jump to
 * an outline heading. Best-effort by design: text edited
 * away degrades to a quiet notice.
 */

import { toast } from "sonner";

import { findQuoteOffset } from "../comments/quote";
import type { OutlineHeading } from "../outline";

const EDITOR_SELECTOR = ".notes-editor-v2";

export function scrollEditorToQuote(quote: string): void {
  const editorEl = document.querySelector(EDITOR_SELECTOR);
  if (!editorEl) return;
  if (findQuoteOffset(editorEl.textContent ?? "", quote) === null) {
    toast.info("That text isn’t in the note anymore.");
    return;
  }
  const firstWord = quote.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  for (const b of editorEl.querySelectorAll("p, h1, h2, h3, h4, li, blockquote")) {
    if ((b.textContent ?? "").toLowerCase().includes(firstWord)) {
      b.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
  }
}

export function scrollEditorToHeading(h: OutlineHeading): void {
  const editorEl = document.querySelector(EDITOR_SELECTOR);
  if (!editorEl) return;
  const headings = editorEl.querySelectorAll("h1, h2, h3, h4, h5, h6");
  headings[h.index - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
}
