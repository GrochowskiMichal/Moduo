export const CALENDAR_VIEW_CHANGE_EVENT = "moduo:calendar:view-change";
export const CALENDAR_DATE_CHANGE_EVENT = "moduo:calendar:date-change";
export const CALENDAR_CREATE_EVENT = "moduo:calendar:create-event";

export type CalendarViewChangeDetail = { viewMode: string };
export type CalendarDateChangeDetail = { date: string };
export type CalendarCreateEventDetail = { startTime?: string; endTime?: string };

export function dispatchCalendarViewChange(viewMode: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<CalendarViewChangeDetail>(CALENDAR_VIEW_CHANGE_EVENT, { detail: { viewMode } })
  );
}

export function dispatchCalendarDateChange(date: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<CalendarDateChangeDetail>(CALENDAR_DATE_CHANGE_EVENT, { detail: { date } })
  );
}

export function dispatchCalendarCreateEvent(startTime?: string, endTime?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<CalendarCreateEventDetail>(CALENDAR_CREATE_EVENT, { detail: { startTime, endTime } })
  );
}
