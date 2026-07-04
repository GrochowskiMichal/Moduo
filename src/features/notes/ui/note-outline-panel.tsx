/**
 * Notes right panel — Outline variant (NO-7, AC8): a live headings TOC for the
 * open note. Derives from the note's own Y.Doc (so it tracks edits without a
 * server round-trip); a click asks the page to scroll the editor to the
 * matching heading.
 */

import { useEffect, useState } from "react";
import type * as Y from "yjs";

import { deriveBody } from "../sync/doc-text";
import { extractOutline, type OutlineHeading } from "../outline";

type Props = {
  doc: Y.Doc | null;
  onNavigate: (heading: OutlineHeading) => void;
};

export function NoteOutlinePanel({ doc, onNavigate }: Props) {
  const [headings, setHeadings] = useState<OutlineHeading[]>([]);

  useEffect(() => {
    if (!doc) {
      setHeadings([]);
      return;
    }
    const recompute = () => setHeadings(extractOutline(deriveBody(doc).md));
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
    <nav className="flex min-h-0 flex-col gap-0.5 overflow-y-auto scrollbar-thin py-1" aria-label="Outline">
      {headings.map((h) => (
        <button
          key={h.index}
          type="button"
          onClick={() => onNavigate(h)}
          // Indent by heading level — runtime geometry, not a design-system value.
          style={{ paddingLeft: `${(h.level - 1) * 12 + 8}px` }}
          className="truncate rounded-md py-1 pr-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {h.text}
        </button>
      ))}
    </nav>
  );
}
