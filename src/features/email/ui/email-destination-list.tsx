// The Snoozed / Follow-ups destination views (EM-6, DESIGN_BRIEF §3). When a rail
// destination is selected the center swaps from the inbox to this list of cloud
// tissue refs — snoozed threads (with "returns <when>" + Unsnooze) or awaiting
// follow-ups (with the deadline + Clear, and "Make a task" in EM-8). Tokens-only.

import { Clock3, CornerUpLeft } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { Eyebrow } from "../../../components/ui/eyebrow";
import type { EmailThreadRef } from "../../../lib/runtime.types";
import { isFollowUpDue } from "../refs";
import { formatSnoozeUntil } from "../snooze";

export type DestinationMode = "snoozed" | "followups";

type Props = {
  mode: DestinationMode;
  refs: EmailThreadRef[];
  /** now, for the "returns/by <when>" labels + overdue styling. */
  now: number;
  onUnsnooze?: (ref: EmailThreadRef) => void;
  onClearFollowUp?: (ref: EmailThreadRef) => void;
  /** Convert the follow-up to a task (wired in EM-8). */
  onMakeTask?: (ref: EmailThreadRef) => void;
};

function RefCard({
  refRow,
  mode,
  now,
  onUnsnooze,
  onClearFollowUp,
  onMakeTask,
}: {
  refRow: EmailThreadRef;
  mode: DestinationMode;
  now: number;
} & Pick<Props, "onUnsnooze" | "onClearFollowUp" | "onMakeTask">) {
  const nowDate = new Date(now);
  const when =
    mode === "snoozed"
      ? refRow.snoozeUntil
        ? `Returns ${formatSnoozeUntil(refRow.snoozeUntil, nowDate)}`
        : ""
      : refRow.followUpAt
        ? isFollowUpDue(refRow, now)
          ? "No reply yet"
          : `Follow up ${formatSnoozeUntil(refRow.followUpAt, nowDate)}`
        : "";

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {refRow.fromName?.trim() || refRow.fromAddr || "Unknown sender"}
        </span>
        {when ? (
          <span
            className={
              "shrink-0 text-2xs tabular-nums " +
              (mode === "followups" && isFollowUpDue(refRow, now)
                ? "text-warning"
                : "text-muted-foreground")
            }
          >
            {when}
          </span>
        ) : null}
      </div>
      <div className="truncate text-sm text-foreground">
        {refRow.subject || "(No subject)"}
      </div>
      {refRow.snippet ? (
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
          {refRow.snippet}
        </p>
      ) : null}

      <div className="mt-2 flex items-center gap-1.5">
        {mode === "snoozed" && onUnsnooze ? (
          <Button size="sm" variant="secondary" onClick={() => onUnsnooze(refRow)}>
            <CornerUpLeft aria-hidden />
            Unsnooze
          </Button>
        ) : null}
        {mode === "followups" ? (
          <>
            {onMakeTask ? (
              <Button size="sm" variant="secondary" onClick={() => onMakeTask(refRow)}>
                Make a task
              </Button>
            ) : null}
            {onClearFollowUp ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => onClearFollowUp(refRow)}
              >
                Clear
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

export function EmailDestinationList({
  mode,
  refs,
  now,
  onUnsnooze,
  onClearFollowUp,
  onMakeTask,
}: Props) {
  if (refs.length === 0) {
    return mode === "snoozed" ? (
      <EmptyState
        icon={Clock3}
        title="Nothing snoozed"
        description="Snooze a thread to have it return to the inbox later."
      />
    ) : (
      <EmptyState
        icon={CornerUpLeft}
        title="No follow-ups"
        description="Set a reminder on a sent thread to follow up if there's no reply."
      />
    );
  }

  return (
    <div className="scrollbar-thin flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-2">
      <Eyebrow as="div" className="px-1">
        {mode === "snoozed" ? "Snoozed" : "Follow-ups"}
      </Eyebrow>
      {refs.map((refRow) => (
        <RefCard
          key={refRow.id}
          refRow={refRow}
          mode={mode}
          now={now}
          onUnsnooze={onUnsnooze}
          onClearFollowUp={onClearFollowUp}
          onMakeTask={onMakeTask}
        />
      ))}
    </div>
  );
}
