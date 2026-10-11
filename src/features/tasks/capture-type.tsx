// The Task capture type (tasks-v3 calls 90/90a/90b, TV-U14): what ⌘⇧K opens
// as, filed to your Inbox, never asking where; ⌘N, "+ New" and `c` open it
// "here". Its body lays out its own header row (the type chip, the
// destination, the "From:" chip): features/tasks/capture/task-capture.tsx.

import { CheckSquare } from "lucide-react";
import type { CaptureTypeDef } from "../../lib/capture-registry";
import { CAPTURE_ROUTES, canWriteRoute } from "../spine/capture-command";
import { TaskCaptureBody } from "./capture/task-capture";

const TASK_ROUTE = CAPTURE_ROUTES.find((r) => r.target === "task");

export const taskCaptureType: CaptureTypeDef = {
  type: "task",
  module: "tasks",
  label: "Task",
  icon: CheckSquare,
  destination: "Inbox",
  canWrite: (perms) => (TASK_ROUTE ? canWriteRoute(TASK_ROUTE, perms) : false),
  Body: TaskCaptureBody,
  ownsHeader: true,
};
