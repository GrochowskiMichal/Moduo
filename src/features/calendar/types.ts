// ⚠ LEGACY (pre-Wave-2). These types back the OLD localStorage calendar and
// the desktop OAuth/sync engine only. The calendar of record is the Wave 2
// rebuild: ../lens.ts (grid model, CalendarView = day|week), ../prefs.ts
// (view state + prefs). Do NOT import CalendarViewMode into new grid code.
// The localStorage event store retires with CAL-2; the OAuth/sync types are
// reused by CAL-6's mirror (specs/calendar.md, assumption 4).

export type CalendarViewMode = "day" | "week" | "month";

export type CalendarProvider = "google" | "outlook" | "apple" | "local";

export type CalendarAccount = {
  id: string;
  provider: CalendarProvider;
  email: string;
  displayName: string;
  connected: boolean;
  lastSyncAt: string | null;
};

export type CalendarSource = {
  id: string;
  accountId: string;
  name: string;
  color: string;
  visible: boolean;
};

export type CalendarEvent = {
  id: string;
  calendarId: string;
  title: string;
  description: string;
  location: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  color: string;
  recurring: boolean;
  recurrenceRule: string | null;
  attendees: CalendarAttendee[];
  reminders: number[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  externalProvider?: CalendarProvider;
  externalId?: string;
  externalICalUid?: string;
};

export type CalendarAttendee = {
  email: string;
  name: string;
  status: "accepted" | "declined" | "tentative" | "pending";
};

export type CalendarEventDraft = {
  title: string;
  description: string;
  location: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  calendarId: string;
  color: string;
  reminders: number[];
};
