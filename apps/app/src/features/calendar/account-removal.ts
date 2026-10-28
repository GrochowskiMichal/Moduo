// Remove a calendar login with Undo (CALR-20, AC35): a soft delete of each of
// its calendars; Undo restores them through calendar_op_account_restore. A
// remove that fails part-way puts back what it took, then throws.

import type { CalendarRuntime } from "../../lib/runtime.types";

export const REMOVE_CONSEQUENCES =
  "Its calendars and their events leave Moduo. Notes, tasks and people you linked stay, marked “event removed”. Nothing changes in Google.";

type AccountRuntime = { calendar: Pick<CalendarRuntime, "removeAccount" | "restoreAccount"> };

export async function removeCalendarLogin(input: {
  runtime: AccountRuntime;
  workspaceId: string;
  accountIds: readonly string[];
}): Promise<{ undo: () => Promise<void> }> {
  const { runtime, workspaceId } = input;
  const removed: string[] = [];
  const restore = async () => {
    for (const accountId of removed)
      await runtime.calendar.restoreAccount({ workspaceId, accountId });
  };
  try {
    for (const accountId of input.accountIds) {
      await runtime.calendar.removeAccount({ workspaceId, accountId });
      removed.push(accountId);
    }
  } catch (err) {
    await restore();
    throw err;
  }
  return { undo: restore };
}
