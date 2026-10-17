/**
 * The top bar's breadcrumb (specs/notes-refresh.md NR-2, AC5):
 * `Pages › Clients › Acme`, each crumb clickable. The section crumb reveals
 * that section in the sidebar; an ancestor crumb opens that note.
 */

import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { cn } from "@/lib/utils";
import type { Crumb, CrumbSection } from "./breadcrumb";

export function NoteBreadcrumb({
  crumbs,
  onOpenNote,
  onOpenSection,
}: {
  crumbs: Crumb[];
  onOpenNote: (id: string) => void;
  onOpenSection: (section: CrumbSection) => void;
}) {
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
      <ol className="flex min-w-0 items-center gap-0.5 font-sans text-sm text-muted-foreground">
        {crumbs.map((crumb, i) => {
          const current = crumb.kind === "note" && crumb.current;
          return (
            <Fragment key={crumb.kind === "note" ? crumb.id : crumb.section}>
              {i > 0 ? (
                <li aria-hidden className="flex shrink-0 items-center">
                  <ChevronRight className="size-icon-xs" />
                </li>
              ) : null}
              <li
                className={cn(
                  "flex min-w-0 items-center",
                  current ? "shrink-0 max-w-full" : "shrink",
                )}
              >
                {current ? (
                  <span aria-current="page" className="truncate px-1 text-foreground">
                    {crumb.label}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      crumb.kind === "note" ? onOpenNote(crumb.id) : onOpenSection(crumb.section)
                    }
                    className="truncate rounded-sm px-1 py-0.5 outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {crumb.label}
                  </button>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
