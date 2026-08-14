// The quiet auto-built activity trail shared by ContactHub + CompanyHub.
// Capped like the EntityHub sections ("Show all (N)") so a busy record never
// ends in a wall of near-identical rows. Read-only, derived, never entered.

import { useEffect, useState } from "react";

import { Eyebrow } from "@/components/ui/eyebrow";
import { spineActivityLine, spineActorName } from "../../spine/activity";
import type { ActivityEntry } from "../../tasks/model";
import { timeAgo } from "../rollup";

const CAP = 6;

export function ActivityTrail({
  activity,
  currentUserId,
  now,
  entityId,
}: {
  activity: ActivityEntry[];
  currentUserId: string | null;
  now: Date;
  /** Collapses back when the selected record changes. */
  entityId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [entityId]);

  if (activity.length === 0) return null;
  const rows = expanded ? activity : activity.slice(0, CAP);

  return (
    <section className="space-y-1">
      <Eyebrow as="h3">Activity</Eyebrow>
      <ul className="space-y-1">
        {rows.map((entry) => (
          <li key={entry.id} className="flex items-baseline gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              <span className="text-foreground">{spineActorName(entry, currentUserId)}</span>{" "}
              {spineActivityLine(entry)}
            </span>
            <span className="shrink-0 text-2xs text-muted-foreground/70">{timeAgo(entry.createdAt, now)}</span>
          </li>
        ))}
      </ul>
      {activity.length > CAP && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="rounded-sm font-sans text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Show all ({activity.length})
        </button>
      ) : null}
    </section>
  );
}
