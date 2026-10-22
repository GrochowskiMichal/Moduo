// The calendar rail's account actions: recolor, remove (keychain cleanup first),
// and the toolbar's refresh (pull from providers on desktop, then re-read).

import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { useTaskCommands } from "../../tasks/tasks-context";
import { cleanupCredentialsForRemoval } from "../caldav-connect";
import type { CalendarAccountModel } from "../events";
import type { CalendarModuleApi } from "../hooks/use-calendar-module";
import type { useCalendarPrefs } from "../hooks/use-calendar-prefs";
import type { useCalendarSync } from "../hooks/use-calendar-sync";

type Input = {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  isDesktop: boolean;
  calendar: CalendarModuleApi;
  updatePrefs: ReturnType<typeof useCalendarPrefs>["updatePrefs"];
  syncNow: ReturnType<typeof useCalendarSync>["syncNow"];
  commands: ReturnType<typeof useTaskCommands>;
};

export function useCalendarAccountActions({
  runtime,
  workspaceId,
  isDesktop,
  calendar,
  updatePrefs,
  syncNow,
  commands,
}: Input) {
  const setAccountColor = useCallback(
    (accountId: string, hue: string) => {
      updatePrefs((prev) => ({ accountColors: { ...prev.accountColors, [accountId]: hue } }));
    },
    [updatePrefs],
  );
  const removeAccount = useCallback(
    (accountId: string) => {
      if (!runtime || !workspaceId) return;
      const removed = calendar.accounts.find((a) => a.id === accountId);
      void (async () => {
        try {
          // Clean up any OS-keychain secret (CalDAV last-row / ICS feed) before
          // the row is gone, then cascade-remove in Supabase.
          if (removed) {
            await cleanupCredentialsForRemoval({
              isDesktop: isDesktop,
              removed,
              allAccounts: calendar.accounts,
            });
          }
          await runtime.calendar.removeAccount({ workspaceId, accountId });
          // Prune the removed account's prefs so the maps don't accrue dead ids.
          updatePrefs((prev) => {
            const { [accountId]: _drop, ...accountColors } = prev.accountColors;
            return {
              hiddenAccountIds: prev.hiddenAccountIds.filter((id) => id !== accountId),
              accountColors,
            };
          });
          await calendar.reload();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Couldn't remove the calendar.");
        }
      })();
    },
    [runtime, workspaceId, isDesktop, calendar, updatePrefs],
  );
  const [reconnectTarget, setReconnectTarget] = useState<CalendarAccountModel | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshCalendars = useCallback(() => {
    setRefreshing(true);
    // Desktop: pull from providers first (no-op on web), then re-read Supabase.
    void syncNow()
      .then(() => Promise.all([calendar.reload(), commands.load()]))
      .catch(() => toast.error("Couldn't refresh calendars — try again."))
      .finally(() => setRefreshing(false));
  }, [syncNow, calendar, commands]);

  return {
    setAccountColor,
    removeAccount,
    reconnectTarget,
    setReconnectTarget,
    refreshing,
    refreshCalendars,
  };
}
