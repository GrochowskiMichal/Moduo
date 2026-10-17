// Opening the app's capture from anywhere (tasks-v3 call 90). The shell
// (components/app/capture-shell.tsx) listens; a capture type's own body can
// open it again (a refused capture's "Restore") without importing the shell.

import type { CaptureRequest } from "./capture-registry";

export const CAPTURE_OPEN_EVENT = "moduo:capture:open";

/**
 * Open the capture as Task: with no request, to your Inbox (⌘⇧K, the bottom
 * bar); with one, "here" (⌘N, "+ New", `c`: tasks-v3 call 90).
 */
export function dispatchOpenCapture(request?: CaptureRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<CaptureRequest | undefined>(CAPTURE_OPEN_EVENT, { detail: request }),
  );
}
