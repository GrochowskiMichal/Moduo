// The page's faults, loading shape and first week in one place (CALR-3), so
// the page view only wires them: the scoped sync status (banner, stale marks,
// the empty-hint guard), the last known shape the skeletons draw (remembered
// once a clean load lands) and whether the first-week card shows. It hands
// the page its banner and the first-week overlay ready to place.

import { useCallback, useEffect, useMemo, useState } from "react";

import { dispatchCreateNew } from "../../../components/app/create-events";
import { dispatchOpenSettings } from "../../settings/settings-events";
import type { CalendarAccountModel, CalendarEventModel, EventChip } from "../events";
import { readFirstWeekClosed, showFirstWeek, writeFirstWeekClosed } from "../first-week";
import { localDayKey } from "../lens";
import { allDayRowsOf, readLoadShape, writeLoadShape } from "../load-shape";
import { calendarSyncStatus } from "../sync-status";
import { FirstWeekCard } from "./first-week-card";
import { SyncBanner } from "./sync-banner";

export function useCalendarFaults(input: {
  userId: string | null;
  workspaceId: string | null;
  accounts: CalendarAccountModel[];
  /** The calendar's own events (busy blocks left out). */
  events: CalendarEventModel[];
  degraded: boolean;
  /** Tasks or events still loading. */
  loading: boolean;
  days: readonly Date[];
  allDayByDay: ReadonlyMap<string, readonly EventChip[]>;
  /** Try again: sync the accounts and read again. */
  onRetry: () => void;
  retrying: boolean;
}) {
  const { userId, workspaceId, accounts, events, degraded, loading, days, allDayByDay } = input;

  const syncStatus = useMemo(
    () => calendarSyncStatus({ accounts, degraded }),
    [accounts, degraded],
  );

  // Read once per person and workspace: the skeleton draws the shape the last
  // visit ended with, not one this visit is still writing.
  const loadShape = useMemo(() => readLoadShape(userId, workspaceId), [userId, workspaceId]);

  const allDayRows = useMemo(
    () => allDayRowsOf(days.map(localDayKey), allDayByDay),
    [days, allDayByDay],
  );
  useEffect(() => {
    if (loading || degraded) return;
    writeLoadShape(userId, workspaceId, { allDayRows });
  }, [loading, degraded, userId, workspaceId, allDayRows]);

  const rememberPlanShape = useCallback(
    (planGroups: number[]) => writeLoadShape(userId, workspaceId, { planGroups }),
    [userId, workspaceId],
  );

  const [closed, setClosed] = useState(() => readFirstWeekClosed(userId, workspaceId));
  useEffect(() => {
    setClosed(readFirstWeekClosed(userId, workspaceId));
  }, [userId, workspaceId]);
  const closeFirstWeek = useCallback(() => {
    writeFirstWeekClosed(userId, workspaceId);
    setClosed(true);
  }, [userId, workspaceId]);

  const firstWeek = showFirstWeek({
    loading,
    faulted: syncStatus.faulted,
    eventCount: events.filter((e) => !e.id.startsWith("busy:")).length,
    accountCount: accounts.filter((a) => !a.deletedAt).length,
    closed,
  });

  const banner = (
    <SyncBanner status={syncStatus} onRetry={input.onRetry} retrying={input.retrying} />
  );
  const firstWeekOverlay = firstWeek ? (
    <FirstWeekCard
      onNewEvent={dispatchCreateNew}
      onConnectGoogle={() => dispatchOpenSettings({ section: "integrations" })}
      onClose={closeFirstWeek}
    />
  ) : null;

  // The empty hint never speaks over a fault, nor beside the first-week card.
  const hideEmptyHint = syncStatus.faulted || firstWeek;

  return {
    loading,
    hideEmptyHint,
    syncStatus,
    loadShape,
    rememberPlanShape,
    banner,
    firstWeekOverlay,
  };
}
