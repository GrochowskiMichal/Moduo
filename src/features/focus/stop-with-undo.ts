// Stop with "Focus stopped · Undo" for STOP_UNDO_MS (call 62a), never "are you
// sure?". The one Stop every surface uses: the top-bar timer, Calendar's block,
// and Focus's ⋯ menu (TV-F7).

import { toast } from "sonner";

import { STOP_UNDO_MS, stopFocusSession, undoFocusStop } from "./timer";

export function stopFocusWithUndo(): void {
  if (!stopFocusSession()) return;
  toast("Focus stopped", {
    duration: STOP_UNDO_MS,
    action: { label: "Undo", onClick: () => undoFocusStop() },
  });
}
