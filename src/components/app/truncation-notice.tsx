import { AlertTriangle } from "lucide-react";

import { describeTruncation, type Truncation } from "@/lib/paged-select";
import { cn } from "@/lib/utils";

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
      <AlertTriangle className="size-icon-sm shrink-0 text-destructive" aria-hidden />
      <span>
        <span className="text-foreground">Showing {truncated.map(describeTruncation).join(" · ")}.</span>{" "}
        This workspace is larger than a single load — narrow it with search or filters to reach the rest.
      </span>
    </div>
  );
}
