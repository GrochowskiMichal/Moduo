// DB-5 — "Activity" widget (ports CT-5 `spine/activity.ts` + `spine/notifications.ts`).
// Grouped, human-readable cross-module activity + notifications; each row deep-links
// to its target. A neutral dot marks unread (accent is reserved, R5).

import { useMemo } from "react";
import { timeAgo } from "@/features/notes/recent";
import {
  groupNotifications,
  notificationDeepLink,
  notificationSummary,
} from "@/features/spine/notifications";
import { isNotificationEnabled, usePreferencesValue } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

import { useDashboardData } from "../../context/dashboard-data-context";
import { useDensity } from "../../hooks/use-density";
import type { WidgetComponentProps } from "../../registry/types";
import { widgetRowBudget } from "../../widget-density";
import { openEntity } from "../../widget-nav";
import {
  WidgetBodyRoot,
  WidgetEmpty,
  WidgetList,
  WidgetLoading,
  WidgetMore,
  WidgetRow,
} from "./widget-primitives";

export function ActivityFeedWidget({ size }: WidgetComponentProps) {
  const { notifications } = useDashboardData();
  const { userId } = useAuth();
  const density = useDensity();
  // Honour the per-type notification mutes (Settings → Preferences) so Home's
  // Activity widget hides the same types as the bell. DF-19f-notif.
  const prefs = usePreferencesValue();

  // Group + stamp only when the underlying items (or the mute prefs) change.
  const { groups, now } = useMemo(
    () => ({
      groups: groupNotifications(
        notifications.data.filter((item) => isNotificationEnabled(item.op, prefs.notifications)),
      ),
      now: new Date(),
    }),
    [notifications.data, prefs.notifications],
  );

  if (notifications.loading && groups.length === 0) return <WidgetLoading />;
  if (groups.length === 0) return <WidgetEmpty>No activity yet.</WidgetEmpty>;

  const budget = widgetRowBudget(size, density);
  const shown = groups.slice(0, budget);
  const overflow = groups.length - shown.length;

  return (
    <WidgetBodyRoot>
      <WidgetList className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {shown.map((group) => {
          const link = notificationDeepLink(group);
          const unread = group.unreadCount > 0;
          return (
            <WidgetRow
              key={group.key}
              leading={
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    unread ? "bg-foreground" : "bg-transparent",
                  )}
                  aria-hidden
                />
              }
              title={notificationSummary(group, userId)}
              trailing={timeAgo(group.latestAt, now)}
              emphasis={unread}
              onClick={link ? () => openEntity(link.entityType, link.entityId) : undefined}
            />
          );
        })}
      </WidgetList>
      <WidgetMore count={overflow} />
    </WidgetBodyRoot>
  );
}
