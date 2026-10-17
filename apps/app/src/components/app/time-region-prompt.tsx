// The travel prompt (TV-D14, REPLAN 76): when this device's time zone isn't
// the person's saved one, a quiet toast asks once per zone (time-region.ts
// decides when). Renders nothing; mounted once in the app chrome.

import { useEffect } from "react";
import { toast } from "sonner";

import { getRuntime } from "../../lib/runtime";
import { onTravelPrompt, saveTimeRegion, zoneCity } from "../../lib/time-region";

export function TimeRegionPrompt() {
  useEffect(() => {
    onTravelPrompt(({ deviceZone, savedZone }) => {
      const here = zoneCity(deviceZone);
      const there = zoneCity(savedZone);
      toast(`Your computer is on ${here} time now.`, {
        id: `time-zone-${deviceZone}`,
        description: `Use ${here} time in Moduo? Repeats, reminders, due times and time reports follow your time zone.`,
        duration: 30_000,
        action: {
          label: `Use ${here} time`,
          onClick: () => {
            const runtime = getRuntime();
            if (!runtime) return;
            saveTimeRegion(runtime.preferences, { timeZone: deviceZone }).then(
              () => toast(`Moduo is on ${here} time.`),
              () =>
                toast.error("Couldn't change your time zone. Try it in Settings → Time & region."),
            );
          },
        },
        cancel: { label: `Keep ${there}`, onClick: () => {} },
      });
    });
    return () => onTravelPrompt(null);
  }, []);
  return null;
}
