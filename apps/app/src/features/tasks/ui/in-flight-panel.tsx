// In flight, the right panel's alongside view (Tasks v3 TV-F8; call 5's
// reshape of TV-F4, calls 72/72a; prototype round-2a frame 1): what I handed
// off and am waiting on, each with when I'll check back, and what my agents
// are doing. A card brightens when its check-back comes due (my reminder
// arrives on its own too), or when my agent needs me, is ready or failed.
// Click a card for the task's details ("← In flight"); Pick up puts it back
// at the top of Focus and ends the wait; Later checks back tomorrow.

import { Hourglass, Paperclip, Play } from "lucide-react";
import { useContext, useMemo } from "react";

import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { IconButton } from "../../../components/ui/icon-button";
import { MetaCount } from "../../../components/ui/meta-count";
import { formatAge, formatWhen } from "../../../lib/time-format";
import { cn } from "../../../lib/utils";
import { filesLabel } from "../../attachments/files";
import { agentLineText } from "../../spine/agent-session";
import { WorkspaceContext } from "../../workspaces/workspace-context";
import type { InFlightItem } from "../focus-screen";
import { useMinuteTick } from "../use-today";
import { waitingLabel } from "./focus-hand-off";

/** "check in 12m" within the hour, else "check back 3:00 PM" / "check back Fri, 9:00 AM". */
export function checkBackWords(at: number, now: Date): string {
  const minutes = Math.ceil((at - now.getTime()) / 60_000);
  if (minutes <= 60) return `check in ${Math.max(1, minutes)}m`;
  return `check back ${formatWhen(at, now)}`;
}

/** "Waiting on Sam", "Waiting on Sam and 2 more". */
export function waitingWords(item: InFlightItem, name: (id: string | null) => string | null) {
  const [first, ...rest] = item.waiting;
  if (!first) return null;
  const label = waitingLabel(first, name);
  return rest.length > 0 ? `Waiting on ${label} and ${rest.length} more` : `Waiting on ${label}`;
}

export function InFlightPanel({
  items,
  canEdit,
  bucketNameById,
  onOpenTask,
  onPickUp,
  onLater,
  fileCounts,
}: {
  items: readonly InFlightItem[];
  canEdit: boolean;
  bucketNameById: (id: string) => string;
  onOpenTask: (id: string) => void;
  onPickUp: (item: InFlightItem) => void;
  onLater: (item: InFlightItem) => void;
  /** Task id → its finished files (AT-3's 📎 mark beside the project). */
  fileCounts?: ReadonlyMap<string, number>;
}) {
  // "since 2h", "check in 12m": the words move on by the minute.
  const tick = useMinuteTick(items.length > 0);
  const members = useContext(WorkspaceContext)?.members;
  const names = useMemo(
    () => new Map((members ?? []).map((m) => [m.userId, m.displayName?.trim() || "Member"])),
    [members],
  );
  const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);

  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing in flight"
        description="When you’re waiting on someone, Hand off W in Focus keeps the task here, with a check-back if you want one. Your agents’ work shows here too."
      />
    );
  }
  const now = new Date();
  return (
    <ul
      className="flex flex-col gap-2 px-3 pt-0.5 pb-3"
      aria-label="In flight"
      data-slot="in-flight"
      data-tick={tick}
    >
      {items.map((item) => (
        <InFlightCard
          key={item.task.id}
          item={item}
          now={now}
          canEdit={canEdit}
          projectName={bucketNameById(item.task.bucketId)}
          files={fileCounts?.get(item.task.id) ?? 0}
          waiting={waitingWords(item, name)}
          onOpen={() => onOpenTask(item.task.id)}
          onPickUp={() => onPickUp(item)}
          onLater={() => onLater(item)}
        />
      ))}
    </ul>
  );
}

function InFlightCard({
  item,
  now,
  canEdit,
  projectName,
  files,
  waiting,
  onOpen,
  onPickUp,
  onLater,
}: {
  item: InFlightItem;
  now: Date;
  canEdit: boolean;
  projectName: string;
  files: number;
  waiting: string | null;
  onOpen: () => void;
  onPickUp: () => void;
  onLater: () => void;
}) {
  const { task, agent, due } = item;
  const when = due
    ? "check back now"
    : item.nextCheckBack !== null
      ? checkBackWords(item.nextCheckBack, now)
      : `since ${formatAge(item.since, now)}`;
  return (
    <li
      data-slot="in-flight-card"
      data-task-id={task.id}
      data-due={due ? "true" : undefined}
      className={cn(
        "group flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 transition-colors duration-(--motion-fade) ease-(--ease-out)",
        item.attention
          ? "border-primary/40 bg-state-selected"
          : "border-hairline hover:bg-state-hover",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`${task.title || "Untitled"}: open its details`}
          className="min-w-0 flex-1 rounded-sm text-left font-sans text-sm font-medium text-foreground break-words focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {task.title || "Untitled"}
        </button>
        {canEdit && !item.attention ? (
          <IconButton
            icon={Play}
            label="Pick up"
            tooltip="Pick up: back to the top of Focus"
            onClick={onPickUp}
            className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
          />
        ) : null}
      </div>
      <p className="flex items-center gap-2 font-sans text-xs text-subtle-foreground break-words">
        <span className="min-w-0">{projectName}</span>
        <MetaCount icon={Paperclip} count={files} label={filesLabel} />
      </p>
      {waiting ? (
        <p
          className={cn(
            "flex items-start gap-1.5 font-sans text-xs break-words",
            due ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <Hourglass className="mt-px size-icon-xs shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            {waiting} · {when}
          </span>
        </p>
      ) : null}
      {agent ? (
        // Status, not conversation (call 52): a name and a word, no AI badge.
        <p className="flex items-start gap-1.5 font-sans text-xs text-muted-foreground break-words">
          <span
            aria-hidden
            className="mt-1.5 size-1.5 shrink-0 rounded-full bg-subtle-foreground"
          />
          <span className="min-w-0 flex-1">{agentLineText(agent, now)}</span>
        </p>
      ) : null}
      {canEdit && item.attention ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" onClick={onPickUp}>
            Pick up
          </Button>
          {due ? (
            <Button size="sm" variant="ghost" onClick={onLater}>
              Check back tomorrow
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
