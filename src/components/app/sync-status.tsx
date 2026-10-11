import { CloudOff, RefreshCw } from "lucide-react";

import { useStoreSnapshot, useWorkspaceStore } from "../../lib/sync/react";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

/** "2 waiting to sync" — captures and check-offs kept on this device. */
export function waitingLabel(pending: number): string {
  return `${pending} waiting to sync`;
}

/**
 * The shared Tasks store for the selected workspace, held for the whole
 * session (TV-D11a): every page opens warm from it, and its Realtime link and
 * outbox keep running whichever module you're in. Also the top bar's quiet
 * sync state: "Offline" while the network is gone (everything reads from the
 * device copy; captures and check-offs wait), and "2 waiting to sync" while
 * they do. Nothing when all is sent (default g).
 *
 * Sits with the global controls left of the Focus timer (principle 48b). At
 * the 1024px minimum width the words shorten to an icon until the right group
 * (an `@container` in app-chrome) is at least `@2xs` wide; the label and
 * tooltip say it in full.
 */
export function TasksSyncStatus() {
  const { runtime, userId } = useAuth();
  const { selectedWorkspaceId, modulePermissions } = useWorkspace();
  const store = useWorkspaceStore(
    runtime,
    userId,
    selectedWorkspaceId,
    modulePermissions.tasks !== "none",
  );
  const { offline, pending, syncError } = useStoreSnapshot(store);
  if (!store || (!offline && pending === 0 && !syncError)) return null;

  // Offline first; then a copy that couldn't be refreshed (a refused session,
  // an ended trial: never shown as if it were live); then what's being sent.
  const words = offline
    ? pending > 0
      ? `Offline · ${waitingLabel(pending)}`
      : "Offline"
    : syncError
      ? "Not up to date"
      : waitingLabel(pending);
  const tip = offline
    ? "You're offline. Tasks show the copy on this device; captures and check-offs sync when you're back."
    : syncError
      ? `Tasks couldn't refresh (${syncError}). Click to try again.`
      : "Sending what you did offline.";
  const Glyph = offline || syncError ? CloudOff : RefreshCw;
  return (
    <Tooltip>
      <TooltipTrigger
        data-slot="sync-status"
        onClick={syncError && !offline ? () => void store.reload() : undefined}
        aria-label={`${words}. ${tip}`}
        className="flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-md font-sans text-xs text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background @2xs:px-2"
      >
        <Glyph className="size-4 @2xs:size-3.5" aria-hidden />
        <span className="hidden @2xs:inline">{words}</span>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}
