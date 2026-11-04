// Subscriptions (X6, AC29): every newsletter sender, when they last mailed
// you, Unsubscribe (the engine picks one-click, mailto or the web page, AC19)
// and "Done all from them".

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

import { formatLastMailed } from "./format";
import { groupBySender, type SenderGroup } from "./newsletter-groups";

export function SubscriptionsView({
  rows,
  nowMs,
  onUnsubscribe,
  onDoneAll,
  unsubscribed,
}: {
  rows: readonly MailThreadRow[];
  nowMs: number;
  onUnsubscribe: (group: SenderGroup) => void;
  onDoneAll: (group: SenderGroup) => void;
  /** Senders already unsubscribed this session. */
  unsubscribed?: ReadonlySet<string>;
}) {
  const groups = groupBySender(rows);
  if (groups.length === 0) {
    return <EmptyState title="No subscriptions" description="Newsletters you get show up here." />;
  }
  return (
    <ul aria-label="Subscriptions" className="flex flex-col divide-y divide-border">
      {groups.map((g) => {
        const done = unsubscribed?.has(g.email) ?? false;
        return (
          <li key={g.email} className="flex items-center gap-3 px-4 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                {g.name || g.email}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {g.email} · {formatLastMailed(g.lastDateMs, nowMs)} · {g.threadIds.length}{" "}
                {g.threadIds.length === 1 ? "thread" : "threads"}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={done}
              onClick={() => onUnsubscribe(g)}
              aria-label={`Unsubscribe from ${g.name || g.email}`}
            >
              {done ? "Unsubscribed" : "Unsubscribe"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDoneAll(g)}
              aria-label={`Done all from ${g.name || g.email}`}
            >
              Done all
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
