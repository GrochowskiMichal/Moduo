import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  groupNotifications,
  type NotificationGroup,
  notificationDeepLink,
  notificationDeepLinkNoun,
  notificationSummary,
} from "../features/spine/notifications";
import { ENTITY_OPEN_EVENT } from "../lib/entity-open";
import { useShortcut } from "../lib/shortcuts";
import { undoToast } from "../lib/undo-toast";
import { useAuth } from "../providers/auth-provider";
import { useWorkspace } from "../providers/workspace-provider";
import { Card } from "./ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Icon } from "./ui/icon";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** The unread badge is capped so a busy feed never renders a 3-digit count. */
const BADGE_CAP = 99;

/** "3 days ago" style relative time, falling back to a locale string. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationCenter() {
  const { userId } = useAuth();
  const {
    // The provider derives these three from one fetch: the active event feed
    // (current workspace, non-dismissed), the full history (incl. read +
    // dismissed) for the "See all" modal, and the legacy cross-workspace
    // invite/membership feed for the Invitations area (DF-21c).
    notifications,
    notificationHistory,
    workspaceInvitations,
    notificationsLoading,
    unreadCountWorkspace,
    refreshNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    dismissNotifications,
    undismissNotifications,
  } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const groups = useMemo(() => groupNotifications(notifications), [notifications]);
  const inviteGroups = useMemo(
    () => groupNotifications(workspaceInvitations),
    [workspaceInvitations],
  );
  const historyGroups = useMemo(
    () => groupNotifications(notificationHistory),
    [notificationHistory],
  );
  const badge = Math.min(unreadCountWorkspace, BADGE_CAP);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        void refreshNotifications();
      }
    },
    [refreshNotifications],
  );

  useShortcut(
    "notifications",
    useCallback(() => handleOpenChange(!open), [handleOpenChange, open]),
  );

  const activateGroup = useCallback(
    async (group: NotificationGroup) => {
      // Mark every unread row in the card read on activate (AC6).
      const unread = group.items.filter((item) => !item.readAt);
      await Promise.all(unread.map((item) => markNotificationRead(item)));
      // Deep-link through the spine's entity-open event so the entity id rides
      // along and the page selects it (DF-1) — same path as a widget row.
      const link = notificationDeepLink(group);
      if (link) {
        setOpen(false);
        setHistoryOpen(false);
        window.dispatchEvent(
          new CustomEvent(ENTITY_OPEN_EVENT, {
            detail: { type: link.entityType, id: link.entityId },
          }),
        );
      }
    },
    [markNotificationRead],
  );

  // Dismiss every row in a card at once, with the app's 8s Undo (DF-5). On
  // failure (op not deployed) surface a toast and skip the Undo (AC5).
  const handleDismiss = useCallback(
    async (group: NotificationGroup) => {
      try {
        await dismissNotifications(group.items);
        undoToast("Notification dismissed", {
          // Restore + own error toast here (per undo-toast.tsx's contract).
          onUndo: () => {
            void undismissNotifications(group.items).catch(() =>
              toast("Couldn't undo — try again."),
            );
          },
        });
      } catch {
        toast("Couldn't dismiss — try again.");
      }
    },
    [dismissNotifications, undismissNotifications],
  );

  const renderGroupCard = useCallback(
    (group: NotificationGroup, opts: { dismissable: boolean }) => {
      const unread = group.unreadCount > 0;
      const link = notificationDeepLink(group);
      return (
        <Card
          key={group.key}
          role="button"
          tabIndex={0}
          onClick={() => void activateGroup(group)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              void activateGroup(group);
            }
          }}
          className={`cursor-pointer gap-1 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            unread ? "bg-secondary" : "bg-muted"
          }`}
        >
          <div className="flex items-start gap-2">
            {/* Unread is signalled by fill + a dot + weight — never color alone. */}
            {unread ? (
              <span
                className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-foreground"
                aria-hidden
              />
            ) : (
              <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0" aria-hidden />
            )}
            <p
              className={`flex-1 text-sm ${unread ? "font-medium text-foreground" : "text-foreground"}`}
            >
              {notificationSummary(group, userId)}
              {group.count > 1 ? (
                <span className="ml-1 text-xs text-muted-foreground">×{group.count}</span>
              ) : null}
            </p>
            {opts.dismissable ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Dismiss notification"
                    className="-mr-1 -mt-0.5 shrink-0 rounded-md px-1 text-base leading-none text-muted-foreground/60 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDismiss(group);
                    }}
                    // Stop Enter/Space from also triggering the card's activate.
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    ×
                  </button>
                </TooltipTrigger>
                <TooltipContent>Dismiss</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          <p className="flex items-center gap-1 pl-3.5 text-xs text-muted-foreground/70">
            {relativeTime(group.latestAt)}
            {link ? (
              <span aria-hidden>· opens {notificationDeepLinkNoun(link.entityType)}</span>
            ) : null}
          </p>
        </Card>
      );
    },
    [activateGroup, handleDismiss, userId],
  );

  const nothingActive = groups.length === 0 && inviteGroups.length === 0;

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger
              className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-label="Notifications"
            >
              <Icon name="bell" size={14} />
              {badge > 0 ? (
                <span className="absolute -right-1 -top-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warning px-1 text-xs font-semibold text-warning-foreground">
                  {badge}
                </span>
              ) : null}
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Notifications</TooltipContent>
        </Tooltip>

        <PopoverContent
          align="end"
          sideOffset={8}
          className="flex w-[380px] max-w-[92vw] flex-col gap-0 p-0"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <PopoverTitle>Notifications</PopoverTitle>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => void markAllNotificationsRead()}
            >
              Mark all read
            </button>
          </div>

          <div className="max-h-[26rem] overflow-y-auto p-2">
            {notificationsLoading && nothingActive ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                Loading notifications…
              </p>
            ) : nothingActive ? (
              <div className="flex flex-col items-center gap-1 px-2 py-8 text-center">
                <p className="text-sm text-foreground">You're all caught up.</p>
                <p className="text-xs text-muted-foreground">
                  New mentions and activity will show here.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {inviteGroups.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <div className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Invitations
                    </div>
                    {inviteGroups.map((group) => renderGroupCard(group, { dismissable: false }))}
                  </div>
                ) : null}
                {groups.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {inviteGroups.length > 0 ? (
                      <div className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Activity
                      </div>
                    ) : null}
                    {groups.map((group) => renderGroupCard(group, { dismissable: true }))}
                  </div>
                ) : (
                  <p className="px-2 py-1 text-center text-xs text-muted-foreground">
                    No new activity.
                  </p>
                )}
              </div>
            )}
          </div>

          {historyGroups.length > 0 ? (
            <div className="border-t border-border p-2">
              <button
                type="button"
                className="w-full rounded-md px-2 py-1.5 text-center text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  setOpen(false);
                  setHistoryOpen(true);
                }}
              >
                See all
              </button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>

      {/* The "See all" history modal — the full current-workspace event history,
          including already-read and dismissed rows (AC2). */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-md gap-0 p-0">
          <DialogHeader className="border-b border-border px-4 py-3">
            <DialogTitle>All notifications</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto p-2">
            {historyGroups.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                No notifications yet.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {historyGroups.map((group) => renderGroupCard(group, { dismissable: false }))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
