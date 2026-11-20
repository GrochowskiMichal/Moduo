// "New events go to" in Settings › Integrations, on the same synced calendar
// prefs the Calendar page reads.

import type { CalendarAccountModel } from "../events";
import { useCalendarPrefs } from "../hooks/use-calendar-prefs";
import {
  chosenNewEventsTo,
  newEventsCalendars,
  resolveNewEventsTo,
  withNewEventsTo,
} from "../new-events-to";
import { NewEventsToField } from "./new-events-to-field";

export function NewEventsToSetting({
  accounts,
  workspaceId,
  userId,
}: {
  accounts: readonly CalendarAccountModel[];
  workspaceId: string;
  userId: string;
}) {
  const { prefs, updatePrefs } = useCalendarPrefs(userId);
  return (
    <NewEventsToField
      calendars={newEventsCalendars(accounts)}
      to={resolveNewEventsTo(chosenNewEventsTo(prefs, workspaceId), accounts)}
      onChange={(id) => updatePrefs((prev) => withNewEventsTo(prev, workspaceId, id))}
    />
  );
}
