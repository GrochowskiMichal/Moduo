// The calendar's scoped sync banner (CALR-3, AC2), between the toolbar and the
// week: which account didn't sync, what is stale since when, what is current,
// and Try again. Nothing when everything synced.

import { AlertTriangle } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { type CalendarSyncStatus, syncBannerText } from "../sync-status";

export function SyncBanner({
  status,
  onRetry,
  retrying = false,
}: {
  status: CalendarSyncStatus;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const text = syncBannerText(status);
  if (!text) return null;
  return (
    <div
      role="status"
      data-sync-banner
      className="mb-2 flex shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground"
    >
      <AlertTriangle aria-hidden className="size-icon-sm shrink-0 text-warning" />
      <span className="min-w-0 flex-1 text-foreground">{text}</span>
      <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
        {retrying ? "Trying…" : "Try again"}
      </Button>
    </div>
  );
}
