/**
 * Notes right panel — Outline variant (NO-7, AC8): a live headings TOC for the
 * open note. Derives from the note's own Y.Doc (so it tracks edits without a
 * server round-trip); a click asks the page to scroll the editor to the
 * matching heading, and the heading you're reading under is marked.
 */

import { useEffect, useState } from "react";
import type * as Y from "yjs";

import { cn } from "@/lib/utils";

import { tryDeriveNoteBody } from "../editor/doc-markdown";
import { extractOutline, type OutlineHeading } from "../outline";

type Props = {
  doc: Y.Doc | null;
  onNavigate: (heading: OutlineHeading) => void;
};

/** How far under the pane's top edge a heading still counts as "here". */
const READING_LINE_PX = 96;

/**
 * The outline entry (1-based, as `OutlineHeading.index`) for the section the
 * editor pane is scrolled to: the last heading above the reading line, else
 * the first. Follows the pane's scroll; re-attaches when the note changes.
 */
function useCurrentHeading(count: number, key: unknown): number | null {
  const [current, setCurrent] = useState<number | null>(null);
  useEffect(() => {
    if (count === 0) return;
    let pane: HTMLElement | null = null;
    let frame = 0;
    let tries = 0;
    const measure = () => {
      frame = 0;
      if (!pane) return;
      const top = pane.getBoundingClientRect().top + READING_LINE_PX;
      const els = pane.querySelectorAll("[contenteditable] :is(h1, h2, h3, h4, h5, h6)");
      let at = els.length > 0 ? 1 : null;
      els.forEach((el, i) => {
        if (el.getBoundingClientRect().top <= top) at = i + 1;
      });
      setCurrent(at);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    // The editor may still be mounting: look for its pane for a few frames.
    const attach = () => {
      pane = document.querySelector<HTMLElement>(".notes-editor-v2");
      if (!pane) {
        if (tries++ < 30) frame = requestAnimationFrame(attach);
        return;
      }
      pane.addEventListener("scroll", onScroll, { passive: true });
      measure();
    };
    // Next frame: the pane's headings are drawn by then.
    frame = requestAnimationFrame(attach);
    return () => {
      cancelAnimationFrame(frame);
      pane?.removeEventListener("scroll", onScroll);
    };
  }, [count, key]);
  return count === 0 ? null : current;
}

export function NoteOutlinePanel({ doc, onNavigate }: Props) {
  const [headings, setHeadings] = useState<OutlineHeading[]>([]);
  const current = useCurrentHeading(headings.length, doc);

  useEffect(() => {
    if (!doc) {
      setHeadings([]);
      return;
    }
    const recompute = () => setHeadings(extractOutline(tryDeriveNoteBody(doc)?.md ?? ""));
    recompute();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onUpdate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(recompute, 250);
    };
    doc.on("update", onUpdate);
    return () => {
      doc.off("update", onUpdate);
      if (timer) clearTimeout(timer);
    };
  }, [doc]);

  if (headings.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-sm text-muted-foreground">
        Headings you add appear here.
      </p>
    );
  }

  return (
    <nav
      className="flex min-h-0 flex-col gap-0.5 overflow-y-auto scrollbar-thin py-1"
      aria-label="Outline"
    >
      {headings.map((h) => (
        <button
          key={h.index}
          type="button"
          onClick={() => onNavigate(h)}
          aria-current={current === h.index ? "location" : undefined}
          // Indent by heading level — runtime geometry, not a design-system value.
          style={{ paddingLeft: `${(h.level - 1) * 12 + 8}px` }}
          className={cn(
            "truncate rounded-md py-1 pr-2 text-left text-sm hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            current === h.index ? "bg-state-active text-foreground" : "text-muted-foreground",
          )}
        >
          {h.text}
        </button>
      ))}
    </nav>
  );
}
