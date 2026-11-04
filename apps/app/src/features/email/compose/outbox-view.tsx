// The Outbox view (AC22): messages in the undo window, waiting offline or
// retrying, with Undo (Edit) while still cancellable. The rail shows Outbox
// only when it's non-empty.

import { Button } from "@/components/ui/button";
import type { MailOutboxItem } from "@/lib/runtime.types.mail-compose";

export function outboxLabel(item: MailOutboxItem, nowMs: number): string {
  if (item.lastError) return `Retrying: ${item.lastError}`;
  if (item.state === "sending") return "Sending…";
  if (item.notBeforeMs > nowMs) return `Sends in ${Math.ceil((item.notBeforeMs - nowMs) / 1000)} s`;
  return "Waiting for connection";
}

export function OutboxView(props: {
  items: MailOutboxItem[];
  nowMs: number;
  onEdit: (outboxId: string) => void;
}) {
  if (props.items.length === 0) return null;
  return (
    <ul aria-label="Outbox" className="flex flex-col divide-y divide-border">
      {props.items.map((item) => (
        <li key={item.id} className="flex items-center gap-3 px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-foreground">{item.subject || "(no subject)"}</span>
            <span className="truncate text-sm text-muted-foreground">
              {item.to.join(", ")} · {outboxLabel(item, props.nowMs)}
            </span>
          </div>
          {item.state === "queued" && item.notBeforeMs > props.nowMs && (
            <Button variant="ghost" size="sm" onClick={() => props.onEdit(item.id)}>
              Edit
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
