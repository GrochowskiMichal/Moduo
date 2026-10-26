/**
 * "Sub-pages (n)" at the foot of a note (MOD-81): the note's real children,
 * always complete and live, so the page agrees with the sidebar tree. Quiet:
 * hidden when the note has none.
 *
 * Compact: the pages wrap as small chips, a few per line, instead of a row
 * each (a page with many sub-pages ran a screen long). Past a handful, the
 * rest fold into "+n more", which opens them all in place.
 */

import { FileText } from "lucide-react";
import { useState } from "react";

import type { Note } from "../model";
import { displayTitle } from "../title";

/** Chips shown before the rest fold into "+n more". */
const FOLD_AFTER = 8;

export function SubpagesList({
  subpages,
  onOpen,
}: {
  subpages: readonly Note[];
  onOpen: (noteId: string) => void;
}) {
  const [all, setAll] = useState(false);
  if (subpages.length === 0) return null;
  const folds = subpages.length > FOLD_AFTER + 1;
  const shown = folds && !all ? subpages.slice(0, FOLD_AFTER) : subpages;
  const chip =
    "inline-flex h-(--ctrl-h-sm) max-w-60 items-center gap-1.5 rounded-md border border-hairline px-2 font-sans text-sm transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
  return (
    <section aria-label="Subpages" className="mt-10 border-t border-hairline pt-4 pb-6">
      <h2 className="mb-2 font-sans text-2xs text-muted-foreground">
        Subpages <span className="tabular-nums">({subpages.length})</span>
      </h2>
      <ul className="flex flex-wrap gap-1.5">
        {shown.map((page) => (
          <li key={page.id} className="min-w-0">
            <button
              type="button"
              onClick={() => onOpen(page.id)}
              className={`${chip} text-foreground`}
            >
              {page.icon ? (
                <span className="shrink-0 leading-none">{page.icon}</span>
              ) : (
                <FileText aria-hidden className="size-icon-sm shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{displayTitle(page.title)}</span>
            </button>
          </li>
        ))}
        {folds ? (
          <li>
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              aria-expanded={all}
              className={`${chip} text-muted-foreground`}
            >
              {all ? "Show fewer" : `+${subpages.length - FOLD_AFTER} more`}
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
