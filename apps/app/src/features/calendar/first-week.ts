// The first-week card's rule (CALR-3): a calendar with nothing on it yet (no
// events in the loaded window, no connected account), read cleanly, that the
// person hasn't closed it on. Closing is remembered on this device per person
// and workspace.

export function showFirstWeek(input: {
  loading: boolean;
  faulted: boolean;
  eventCount: number;
  accountCount: number;
  closed: boolean;
}): boolean {
  return (
    !input.loading &&
    !input.faulted &&
    !input.closed &&
    input.eventCount === 0 &&
    input.accountCount === 0
  );
}

function closedKey(userId: string, workspaceId: string): string {
  return `moduo:calendar:first-week-closed:${userId}:${workspaceId}`;
}

export function readFirstWeekClosed(userId: string | null, workspaceId: string | null): boolean {
  if (typeof window === "undefined" || !userId || !workspaceId) return false;
  try {
    return window.localStorage.getItem(closedKey(userId, workspaceId)) === "1";
  } catch {
    return false;
  }
}

export function writeFirstWeekClosed(userId: string | null, workspaceId: string | null): void {
  if (typeof window === "undefined" || !userId || !workspaceId) return;
  try {
    window.localStorage.setItem(closedKey(userId, workspaceId), "1");
  } catch {
    /* storage disabled: it simply shows again next time */
  }
}
