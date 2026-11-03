// "Couldn't sync N actions" (AC12): failures are never silent. Retry sends
// them again; Discard drops them and puts the threads back as the server has them.

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { MailOpRecord } from "@/lib/runtime.types.mail-engine";

export function failedActionsLabel(n: number): string {
  return n === 1 ? "Couldn't sync 1 action" : `Couldn't sync ${n} actions`;
}

export function FailedActionsBar({
  failed,
  onRetry,
  onDiscard,
}: {
  failed: readonly MailOpRecord[];
  onRetry: (opIds: string[]) => void;
  onDiscard: (opIds: string[]) => void;
}) {
  if (failed.length === 0) return null;
  const ids = failed.map((o) => o.opId);
  const reason = failed[failed.length - 1]?.lastError;
  return (
    <div
      role="status"
      className="mx-2 mb-2 flex items-center gap-2 rounded-md border border-hairline bg-state-hover px-3 py-2 text-sm"
    >
      <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium text-foreground">{failedActionsLabel(failed.length)}</span>
        {reason ? <span className="text-muted-foreground"> · {reason}</span> : null}
      </span>
      <Button size="sm" variant="ghost" onClick={() => onDiscard(ids)}>
        Discard
      </Button>
      <Button size="sm" variant="secondary" onClick={() => onRetry(ids)}>
        Retry
      </Button>
    </div>
  );
}
