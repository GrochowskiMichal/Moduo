// The Task capture type (tasks-v3 calls 90/90a/90b): what ⌘⇧K opens as, filed
// to your Inbox, never asking where. Today it is the one-line capture parsed
// for dates; TV-U14 gives it the destination row and the four pills.

import { CheckSquare } from "lucide-react";

import { lineCaptureType } from "../../components/app/capture-line";

export const taskCaptureType = lineCaptureType({
  target: "task",
  module: "tasks",
  label: "Task",
  icon: CheckSquare,
  destination: "Inbox",
  plural: "tasks",
  placeholder: "Capture a task…",
});
