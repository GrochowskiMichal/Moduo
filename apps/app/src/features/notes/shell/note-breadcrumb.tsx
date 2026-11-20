/**
 * The top bar's breadcrumb (specs/notes-refresh.md NR-2, AC5):
 * `Pages › Clients › Acme`, each crumb clickable. The section crumb reveals
 * that section in the sidebar; an ancestor crumb opens that note.
 *
 * A deep path keeps the section, the parent and the note, and folds the rest
 * into "…" (named in its tooltip). Ancestors keep a readable width; the open
 * note's own title is what truncates, never the path to it.
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
  const folded = crumbs.length > 4 ? crumbs.slice(1, -2) : [];
  const shown: Array<Crumb | { kind: "fold" }> =
    folded.length > 0 ? [crumbs[0]!, { kind: "fold" }, ...crumbs.slice(-2)] : crumbs;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
      <ol className="flex min-w-0 items-center gap-0.5 font-sans text-sm text-muted-foreground">
        {shown.map((crumb, i) => {
          if (crumb.kind === "fold") {
            return (
              <Fragment key="fold">
                <li aria-hidden className="flex shrink-0 items-center">
                  <ChevronRight className="size-icon-xs" />
                </li>
                <li
                  className="shrink-0 px-1"
                  title={folded.map((c) => c.label).join(" › ")}
                  aria-label={folded.map((c) => c.label).join(", ")}
                >
                  …
                </li>
              </Fragment>
            );
          }
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
                  "flex items-center",
                  current ? "min-w-0 shrink" : "max-w-40 shrink-0",
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
