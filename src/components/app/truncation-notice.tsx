import { AlertTriangle } from "lucide-react";

import { describeTruncation, type Truncation } from "../../lib/paged-select";
import { cn } from "../../lib/utils";

type Props = {
  truncated: Truncation[] | undefined;
  className?: string;
};

/**
 * "Showing N of M" — the visible half of SCALE-1.
 *
 * A module read that hits its ceiling drops rows, and the whole point of the
 * block is that this can never again happen silently. Rendered as a strip
 * above the panels (see `FeaturePanelsShell`'s `notice` slot) so it is
 * unmissable without being modal — nothing is broken, the list is just partial.
 *
 * The copy deliberately offers NO remedy: search and filters in these modules
 * run over the loaded bundle, so "narrow it down" would not reach the missing
 * rows. Pagination is the follow-up; until then the honest thing is to say
 * what's loaded and stop.
 *
 * Renders nothing when everything was loaded, which is every workspace today.
 */
export function TruncationNotice({ truncated, className }: Props) {
  if (!truncated || truncated.length === 0) return null;
  return (
    <div
      role="status"
      className={cn(
        "mb-2 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <AlertTriangle className="size-icon-sm shrink-0 opacity-70" aria-hidden />
      <span>
        <span className="text-foreground">Showing {truncated.map(describeTruncation).join(" · ")}.</span>{" "}
        This workspace is bigger than one load — the rest isn’t on screen yet.
      </span>
    </div>
  );
}

/**
 * The `notice` prop for `FeaturePanelsShell` — `undefined` when there's nothing
 * to say, so the shell keeps its original layout instead of always wrapping in
 * the notice container.
 */
export function truncationNotice(truncated: Truncation[] | undefined) {
  if (!truncated || truncated.length === 0) return undefined;
  return <TruncationNotice truncated={truncated} />;
}
