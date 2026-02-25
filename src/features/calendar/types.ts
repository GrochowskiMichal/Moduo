export type CalendarViewMode = "day" | "week" | "month";

export type CalendarProvider = "google" | "outlook" | "local";

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
