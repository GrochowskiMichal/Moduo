import { useMemo, useState } from "react";
import { useWorkspace } from "../providers/workspace-provider";
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

export function NotificationCenter() {
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

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      void refreshNotifications();
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger
            className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            aria-label="Notifications"
          >
            <Icon name="bell" size={16} />
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
          ) : notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notifications yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {notifications.map((notification) => (
                <Card
                  key={notification.id}
                  role="button"
                  tabIndex={0}
                  onClick={async () => {
                    if (!notification.readAt) {
                      await markNotificationRead(notification.id);
                    }
                  }}
                  onKeyDown={async (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      if (!notification.readAt) {
                        await markNotificationRead(notification.id);
                      }
                    }
                  }}
                  className={`cursor-pointer gap-1 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    notification.readAt ? "bg-muted" : "bg-card"
                  }`}
                >
                  <p className="text-sm text-foreground">{notification.eventType}</p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {JSON.stringify(notification.payload)}
                  </p>
                  <p className="text-xs text-muted-foreground/70">
                    {new Date(notification.createdAt).toLocaleString()}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
