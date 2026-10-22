/**
 * "Sub-pages (n)" at the foot of a note (MOD-81): the note's real children,
 * always complete and live, so the page agrees with the sidebar tree. Quiet:
 * hidden when the note has none.
 */

import { FileText } from "lucide-react";
import type { Note } from "../model";
import { displayTitle } from "../title";

export function SubpagesList({
  subpages,
  onOpen,
}: {
  subpages: readonly Note[];
  onOpen: (noteId: string) => void;
}) {
  if (subpages.length === 0) return null;
  return (
    <section aria-label="Sub-pages" className="mt-10 border-t border-hairline pt-4 pb-6">
      <h2 className="mb-2 font-sans text-2xs text-muted-foreground">
        Sub-pages <span className="tabular-nums">({subpages.length})</span>
      </h2>
      <ul>
        {subpages.map((page) => (
          <li key={page.id}>
            <button
              type="button"
              onClick={() => onOpen(page.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left font-sans text-sm text-foreground transition-colors duration-(--motion-fade) hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {page.icon ? (
                <span className="w-5 text-center leading-none">{page.icon}</span>
              ) : (
                <FileText className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{displayTitle(page.title)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
