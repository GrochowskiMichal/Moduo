// The Task capture type (tasks-v3 calls 90/90a/90b, TV-U14): what ⌘⇧K opens
// as, filed to your Inbox, never asking where; ⌘N, "+ New" and `c` open it
// "here". Its body lays out its own header row (the type chip, the
// destination, the "From:" chip): features/tasks/capture/task-capture.tsx.

import { CheckSquare } from "lucide-react";
import { lazy, Suspense } from "react";

import type { CaptureBodyProps, CaptureTypeDef } from "../../lib/capture-registry";
import { attachCaptureFiles } from "../attachments/capture";
import { canWriteRoute, CAPTURE_ROUTES } from "../spine/capture-command";
import { registerCaptureAttachments, registerCaptureTemplates } from "./capture/capture-hooks";
import { taskTemplatesForCapture } from "./templates/capture-provider";

// TV-D15: `/template` and More → Template… (shown once the runtime has templates).
registerCaptureTemplates(taskTemplatesForCapture);
// AT-3: files pasted or dropped on a capture attach once the task exists.
registerCaptureAttachments(attachCaptureFiles);

// The body (Lexical title editor, chrono-node parser) is its own async chunk,
// off the first load. It is warmed once the app is idle so ⌘⇧K still opens
// straight into a typing-ready line.
const loadTaskCapture = () => import("./capture/task-capture");
const LazyTaskCaptureBody = lazy(() =>
  loadTaskCapture().then((m) => ({ default: m.TaskCaptureBody })),
);
if (typeof window !== "undefined") {
  const warm = () => void loadTaskCapture();
  if ("requestIdleCallback" in window) window.requestIdleCallback(warm, { timeout: 4000 });
  else setTimeout(warm, 2000);
}

function TaskCaptureBody(props: CaptureBodyProps) {
  return (
    <Suspense fallback={<div className="h-24" aria-busy="true" />}>
      <LazyTaskCaptureBody {...props} />
    </Suspense>
  );
}

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
