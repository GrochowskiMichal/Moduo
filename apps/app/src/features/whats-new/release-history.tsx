// Settings → About's "What's new" (REL-4): the latest releases, each opening
// What's new on its notes. The full list is on moduo.app/changelog.

import { ChevronRight } from "lucide-react";

import { Eyebrow } from "../../components/ui/eyebrow";
import { formatReleaseDate, RELEASES, type Release } from "./releases";
import { openWhatsNew } from "./whats-new-store";

/** How many releases About lists. */
export const ABOUT_RELEASES_SHOWN = 5;

export function ReleaseHistory({ releases = RELEASES }: { releases?: Release[] }) {
  const recent = releases.slice(0, ABOUT_RELEASES_SHOWN);
  return (
    <section aria-label="What's new" className="flex flex-col gap-1">
      <Eyebrow as="h4" className="mb-1">
        What's new
      </Eyebrow>
      {recent.length ? (
        <ul className="-mx-2 flex flex-col">
          {recent.map((release) => (
            <li key={release.version}>
              <button
                type="button"
                onClick={() => openWhatsNew({ version: release.version })}
                className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm min-h-(--row-h) transition-colors duration-(--motion-fast) ease-(--ease-out) hover:bg-state-hover active:bg-state-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span className="font-medium text-foreground tabular-nums">{release.version}</span>
                <span className="shrink-0 text-subtle-foreground tabular-nums">
                  {formatReleaseDate(release.date)}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {release.highlights[0] ?? ""}
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Release notes will show here after the next update.
        </p>
      )}
    </section>
  );
}
