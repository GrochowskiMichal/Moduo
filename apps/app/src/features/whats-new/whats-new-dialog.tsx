// What's new (REL-4): one release's notes in three groups (New, Improved,
// Fixed), with every earlier release one click away and the full changelog on
// moduo.app. Mounted once app-wide; opens only from a click (whats-new-store).

import { ArrowUpRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Eyebrow } from "../../components/ui/eyebrow";
import { CHANGELOG_URL } from "../settings/about";
import {
  formatReleaseDate,
  groupItems,
  RELEASES,
  type Release,
  type ReleaseGroup,
} from "./releases";
import { closeWhatsNew, useWhatsNewState } from "./whats-new-store";

// Fixed chrome, so each heading is a literal (DESIGN_RULES R12).
const GROUP_HEADINGS: Record<ReleaseGroup["key"], React.ReactNode> = {
  new: <Eyebrow as="h3">New</Eyebrow>,
  improved: <Eyebrow as="h3">Improved</Eyebrow>,
  fixed: <Eyebrow as="h3">Fixed</Eyebrow>,
};

export function WhatsNewDialog({
  releases = RELEASES,
  onOpenExternal,
}: {
  releases?: Release[];
  /** Opens a link outside the app (the system browser on desktop). */
  onOpenExternal?: (href: string) => void;
}) {
  const { open, version, upcoming } = useWhatsNewState();
  const all = upcoming
    ? [upcoming, ...releases.filter((r) => r.version !== upcoming.version)]
    : releases;

  const [shown, setShown] = useState<string | null>(version);
  // The clicked row leaves the list, so focus stays in the notes instead.
  const notesRef = useRef<HTMLDivElement>(null);
  const show = (next: string) => {
    setShown(next);
    notesRef.current?.focus();
  };
  // Each open starts on the release it was opened for.
  useEffect(() => {
    if (open) setShown(version);
  }, [open, version]);

  const release = all.find((r) => r.version === shown) ?? all[0] ?? null;
  const others = all.filter((r) => r !== release);
  const groups = release ? groupItems(release) : [];

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : closeWhatsNew())}>
      <DialogContent className="gap-5">
        <DialogHeader>
          <DialogTitle>What's new</DialogTitle>
          <DialogDescription>
            {release
              ? `Moduo ${release.version} · ${formatReleaseDate(release.date)}`
              : "Release notes will show here after the next update."}
          </DialogDescription>
        </DialogHeader>

        {release ? (
          <div
            ref={notesRef}
            tabIndex={-1}
            className="flex max-h-96 flex-col gap-5 overflow-y-auto outline-none"
          >
            {groups.length ? (
              groups.map((group) => (
                <section key={group.key} aria-label={group.label} className="flex flex-col gap-2">
                  {GROUP_HEADINGS[group.key]}
                  <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-foreground marker:text-subtle-foreground">
                    {group.items.map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                </section>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Reliability improvements.</p>
            )}

            {others.length ? (
              <section aria-label="Earlier releases" className="flex flex-col gap-1">
                {release === all[0] ? (
                  <Eyebrow as="h3" className="mb-1">
                    Earlier releases
                  </Eyebrow>
                ) : (
                  <Eyebrow as="h3" className="mb-1">
                    Other releases
                  </Eyebrow>
                )}
                <ul className="flex flex-col">
                  {others.map((r) => (
                    <li key={r.version}>
                      <button
                        type="button"
                        onClick={() => show(r.version)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm min-h-(--row-h) transition-colors duration-(--motion-fast) ease-(--ease-out) hover:bg-state-hover active:bg-state-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        <span className="font-medium text-foreground tabular-nums">
                          {r.version}
                        </span>
                        <span className="shrink-0 text-subtle-foreground tabular-nums">
                          {formatReleaseDate(r.date)}
                        </span>
                        {r.highlights[0] ? (
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {r.highlights[0]}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button asChild variant="ghost" size="sm">
            <a
              href={CHANGELOG_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                if (!onOpenExternal) return;
                event.preventDefault();
                onOpenExternal(CHANGELOG_URL);
              }}
            >
              Full changelog
              <ArrowUpRight aria-hidden />
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
