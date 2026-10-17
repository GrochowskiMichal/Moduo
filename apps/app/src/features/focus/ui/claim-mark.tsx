// "<name> is on this" (TV-F6, salvaged from #323): the teammates whose Focus
// session is on a task right now, as small avatars with a quiet live dot and
// the words in the tooltip and the accessible name. Nothing else about their
// session shows (no clock, no queue). Reads the claims the app shell polls
// (`claims.ts`); renders nothing when nobody is on it. The detail panel's
// title row shows one avatar and "+n" (its room is a 280 px panel's);
// TV-F7 reuses it on the Focus screen and rows.

import { useContext } from "react";

import { PersonAvatar } from "../../../components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { WorkspaceContext } from "../../workspaces/workspace-context";
import { onThisLabel, useTaskClaim } from "../claims";

export function TaskClaimMark({
  workspaceId,
  taskId,
  max = 3,
}: {
  workspaceId: string | null | undefined;
  taskId: string;
  /** Avatars drawn before "+n"; the tooltip names everyone. */
  max?: number;
}) {
  const ids = useTaskClaim(workspaceId, taskId);
  // Read without requiring the provider, so a panel renders in isolation.
  const members = useContext(WorkspaceContext)?.members ?? [];
  if (ids.length === 0) return null;
  const people = ids.map((id) => {
    const member = members.find((m) => m.userId === id);
    return { id, name: member?.displayName?.trim() || "Someone", src: member?.avatarUrl ?? null };
  });
  const label = onThisLabel(people.map((p) => p.name));
  const more = people.length - max;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          data-slot="claim-mark"
          className="flex shrink-0 items-center gap-1 px-1"
        >
          <span className="flex -space-x-1">
            {people.slice(0, max).map((p) => (
              <PersonAvatar
                key={p.id}
                id={p.id}
                name={p.name}
                src={p.src}
                className="ring-2 ring-background"
              />
            ))}
          </span>
          {more > 0 ? (
            <span className="font-sans text-xs text-subtle-foreground tabular-nums" aria-hidden>
              +{more}
            </span>
          ) : null}
          <span className="size-1.5 rounded-full bg-muted-foreground" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
