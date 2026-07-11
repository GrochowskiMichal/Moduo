import { useCallback, useMemo, useState } from "react";

import { useAuth } from "../providers/auth-provider";
import { ENTITY_OPEN_EVENT } from "../lib/entity-open";
import { useWorkspace } from "../providers/workspace-provider";
import { useShortcut } from "../lib/shortcuts";
import {
  groupNotifications,
  notificationDeepLink,
  notificationSummary,
  type NotificationGroup,
} from "../features/spine/notifications";
import { Card } from "./ui/card";
import { Icon } from "./ui/icon";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

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
    notifications,
    notificationsScope,
    notificationsLoading,
    unreadCountWorkspace,
    unreadCountGlobal,
    setNotificationsScope,
    refreshNotifications,
    markNotificationRead,
    markAllNotificationsRead,
  } = useWorkspace();
  const [open, setOpen] = useState(false);

  const activeUnread = useMemo(
    () => (notificationsScope === "workspace" ? unreadCountWorkspace : unreadCountGlobal),
    [notificationsScope, unreadCountGlobal, unreadCountWorkspace],
  );

  // Collapse the feed into target→verb cards (digest-default, AC10).
  const groups = useMemo(() => groupNotifications(notifications), [notifications]);

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
      // Mark every unread row in the card read on open (AC10: mark-on-open).
      const unread = group.items.filter((item) => !item.readAt);
      await Promise.all(unread.map((item) => markNotificationRead(item)));
      // Deep-link through the spine's entity-open event so the entity id rides
      // along and the page selects it (DF-1) — same path as a widget row.
      const link = notificationDeepLink(group);
      if (link) {
        setOpen(false);
        window.dispatchEvent(
          new CustomEvent(ENTITY_OPEN_EVENT, {
            detail: { type: link.entityType, id: link.entityId },
          }),
        );
      }
    },
    [markNotificationRead],
  );

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger
            className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label="Notifications"
          >
            <Icon name="bell" size={14} />
            {activeUnread > 0 ? (
              <span className="absolute -right-1 -top-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warning px-1 text-xs font-semibold text-warning-foreground">
                {Math.min(activeUnread, 99)}
              </span>
            ) : null}
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent>Notifications</TooltipContent>
      </Tooltip>

      <SheetContent side="right" className="w-[420px] max-w-[92vw] gap-3 p-0">
        <SheetHeader className="flex-row items-center justify-between gap-2 border-b border-border">
          <div className="flex flex-col gap-1">
            <SheetTitle>Notifications</SheetTitle>
            <SheetDescription>Stay on top of workspace and global activity.</SheetDescription>
          </div>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => void markAllNotificationsRead()}
          >
            Mark all read
          </button>
        </SheetHeader>

        <div className="flex flex-row gap-2 px-4">
          <button
            type="button"
            className={`rounded-md px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              notificationsScope === "workspace"
                ? "bg-accent text-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
            onClick={() => setNotificationsScope("workspace")}
          >
            Workspace ({unreadCountWorkspace})
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              notificationsScope === "global"
                ? "bg-accent text-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
            onClick={() => setNotificationsScope("global")}
          >
            Global ({unreadCountGlobal})
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {notificationsLoading ? (
            <p className="text-sm text-muted-foreground">Loading notifications...</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notifications yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {groups.map((group) => {
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
                      <p className={`flex-1 text-sm ${unread ? "font-medium text-foreground" : "text-foreground"}`}>
                        {notificationSummary(group, userId)}
                        {group.count > 1 ? (
                          <span className="ml-1 text-xs text-muted-foreground">×{group.count}</span>
                        ) : null}
                      </p>
                    </div>
                    <p className="flex items-center gap-1 pl-3.5 text-xs text-muted-foreground/70">
                      {relativeTime(group.latestAt)}
                      {link ? <span aria-hidden>· opens {link.entityType}</span> : null}
                    </p>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
