// Calendar's capture type, provisional (SH-1): the one-line event ⌘⇧K already
// made with "/event" (a time makes a one-hour block, a date an all-day event),
// now picked with its top-bar number or the type chip (call 90b). Calendar
// replaces it with its own body when the module is rebuilt.

import { Calendar } from "lucide-react";

import { lineCaptureBody } from "../../components/app/capture-line";
import type { CaptureTypeDef } from "../../lib/capture-registry";
import { CAPTURE_ROUTES, canWriteRoute } from "../spine/capture-command";

const route = CAPTURE_ROUTES.find((r) => r.target === "event") ?? CAPTURE_ROUTES[0];

export const calendarCaptureType: CaptureTypeDef = {
  type: "event",
  module: "calendar",
  label: "Event",
  icon: Calendar,
  destination: "Calendar",
  canWrite: (perms) => canWriteRoute(route, perms),
  Body: lineCaptureBody({ target: "event", plural: "events", placeholder: "Capture an event…" }),
};
