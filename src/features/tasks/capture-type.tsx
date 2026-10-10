// The Task capture type (tasks-v3 calls 90/90a/90b): what ⌘⇧K opens as, filed
// to your Inbox, never asking where. Today it is the one-line capture parsed
// for dates; TV-U14 gives it the destination row and the four pills.

import { CheckSquare } from "lucide-react";

import { lineCaptureBody } from "../../components/app/capture-line";
import type { CaptureTypeDef } from "../../lib/capture-registry";
import { CAPTURE_ROUTES, canWriteRoute } from "../spine/capture-command";

const route = CAPTURE_ROUTES.find((r) => r.target === "task") ?? CAPTURE_ROUTES[0];

export const taskCaptureType: CaptureTypeDef = {
  type: "task",
  module: "tasks",
  label: "Task",
  icon: CheckSquare,
  destination: "Inbox",
  canWrite: (perms) => canWriteRoute(route, perms),
  Body: lineCaptureBody({ target: "task", plural: "tasks", placeholder: "Capture a task…" }),
};
