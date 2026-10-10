// Calendar's capture type, provisional (SH-1): the one-line event ⌘⇧K already
// made with "/event" (a time makes a one-hour block, a date an all-day event),
// now picked with its top-bar number or the type chip (call 90b). Calendar
// replaces it with its own body when the module is rebuilt.

import { Calendar } from "lucide-react";

import { lineCaptureType } from "../../components/app/capture-line";

export const calendarCaptureType = lineCaptureType({
  target: "event",
  module: "calendar",
  label: "Event",
  icon: Calendar,
  destination: "Calendar",
  plural: "events",
  placeholder: "Capture an event…",
});
