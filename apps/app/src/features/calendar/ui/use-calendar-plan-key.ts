// ⌥3 opens Plan while the right panel is closed; once it shows, the panel's
// own ⌥3 takes over. The side panels otherwise follow the app's own rules
// (remembered per module, never folded by Calendar).

import { useAppHotkeys } from "../../../lib/hotkeys";
import { dispatchLayoutPanelsSet, useFeaturePanelState } from "../../layout/panel-events";

export function useCalendarPlanKey(showPlan: (view: "tasks") => void): void {
  const panels = useFeaturePanelState("calendar");
  useAppHotkeys(
    {
      "calendar.plan": () => {
        showPlan("tasks");
        dispatchLayoutPanelsSet({ feature: "calendar", left: panels.left, right: true });
      },
    },
    { enabled: !panels.right },
  );
}
