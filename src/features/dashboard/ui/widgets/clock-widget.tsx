import { useEffect, useState } from "react";
import type { WidgetConfig } from "../../types";
import { WidgetShell } from "./widget-shell";

const ZONES = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
];

type Props = {
  config: WidgetConfig;
  isLocked: boolean;
  onUpdateConfig: (patch: Partial<WidgetConfig>) => void;
};

export function ClockWidget({ config, isLocked, onUpdateConfig }: Props) {
  const [now, setNow] = useState(new Date());
  const zones = config.timezones?.length ? config.timezones : ["UTC"];

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <WidgetShell
      config={config}
      title="Timezone Clock"
      controls={
        !isLocked ? (
          <select
            value=""
            onChange={(event) => {
              if (!event.target.value || zones.includes(event.target.value)) return;
              onUpdateConfig({ timezones: [...zones, event.target.value] });
            }}
            className="max-w-[65%] rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#cfcfcf] outline-none"
          >
            <option value="">+ Add</option>
            {ZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        ) : null
      }
    >
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {zones.map((zone) => {
          const time = new Intl.DateTimeFormat("en-US", {
            timeZone: zone,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          }).format(now);
          const date = new Intl.DateTimeFormat("en-US", {
            timeZone: zone,
            month: "short",
            day: "numeric",
            weekday: "short",
          }).format(now);
          return (
            <div key={zone} className="mb-2 flex items-center justify-between rounded-lg border border-[#252525] px-2 py-1">
              <div>
                <p className="text-[14px] font-medium text-[#f1f1f1]">{time}</p>
                <p className="text-[10px] text-[#8d8d8d]">{zone}</p>
                <p className="text-[10px] text-[#737373]">{date}</p>
              </div>
              {!isLocked ? (
                <button
                  className="text-[11px] text-[#8c8c8c] hover:text-[#e9a4a4]"
                  onClick={() => onUpdateConfig({ timezones: zones.filter((item) => item !== zone) })}
                >
                  remove
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </WidgetShell>
  );
}
