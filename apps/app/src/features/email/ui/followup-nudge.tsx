// The due follow-up nudge at the inbox top (MR-14, X19, AC34): "No reply from
// Anna in 3 days", with Open and Dismiss. Dismiss hides it on this device only;
// the follow-up itself stays on the thread.

import { CornerUpLeft, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

const DAY_MS = 86_400_000;

/** "No reply from Anna in 3 days"; the counterpart is the newest sender that isn't you. */
export function followupNudgeLabel(row: MailThreadRow, selfAddresses: string[], nowMs: number) {
  const self = new Set(selfAddresses.map((a) => a.trim().toLowerCase()));
  const other = [...row.senders].reverse().find((s) => !self.has(s.email.trim().toLowerCase()));
  const who = other ? other.name.trim() || other.email : "them";
  const days = Math.max(0, Math.floor((nowMs - row.lastDateMs) / DAY_MS));
  if (days === 0) return `No reply from ${who} yet`;
  return `No reply from ${who} in ${days} ${days === 1 ? "day" : "days"}`;
}

export function FollowupNudges({
  rows,
  selfAddresses,
  nowMs,
  onOpen,
  onDismiss,
}: {
  rows: readonly MailThreadRow[];
  selfAddresses: string[];
  nowMs: number;
  onOpen: (threadId: string) => void;
  onDismiss: (threadId: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <ul aria-label="Follow-ups due" className="mx-2 mb-2 flex flex-col gap-1">
      {rows.map((row) => (
        <li
          key={row.threadId}
          className="flex items-center gap-2 rounded-md border border-hairline bg-state-hover px-3 py-2 text-sm"
        >
          <CornerUpLeft className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left"
            onClick={() => onOpen(row.threadId)}
          >
            <span className="font-medium text-foreground">
              {followupNudgeLabel(row, selfAddresses, nowMs)}
            </span>
            <span className="text-muted-foreground"> · {row.subject || "(No subject)"}</span>
          </button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Dismiss"
            onClick={() => onDismiss(row.threadId)}
          >
            <X className="size-4" aria-hidden />
            Dismiss
          </Button>
        </li>
      ))}
    </ul>
  );
}
