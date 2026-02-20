import React, { useEffect, useState } from "react";
import { WidgetConfig } from "../../types";

interface ClockWidgetProps {
  config: WidgetConfig;
  onUpdateConfig: (config: Partial<WidgetConfig>) => void;
  isLocked: boolean;
}

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
];

export function ClockWidget({ config, onUpdateConfig, isLocked }: ClockWidgetProps) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timezones = config.timezones || ["UTC"];

  const removeTimezone = (tz: string) => {
    const newTz = timezones.filter((t) => t !== tz);
    onUpdateConfig({ timezones: newTz });
  };

  const addTimezone = (tz: string) => {
    if (!timezones.includes(tz)) {
      onUpdateConfig({ timezones: [...timezones, tz] });
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#111111] p-4 text-[#e5ecff]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[#94a6cc]">World Clock</h3>
        {!isLocked && (
          <select
            className="bg-[#1a1f2e] text-[#e5ecff] text-[10px] rounded border border-[#2a3041] p-1 outline-none max-w-[100px]"
            onChange={(e) => addTimezone(e.target.value)}
            value=""
          >
            <option value="" disabled>+ Add</option>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 scrollbar-thin scrollbar-thumb-[#2a3041] scrollbar-track-transparent">
        {timezones.map((tz) => {
          let timeString = "--:--";
          let dateString = "";
          try {
            timeString = new Intl.DateTimeFormat("en-US", {
              timeZone: tz,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            }).format(now);
            dateString = new Intl.DateTimeFormat("en-US", {
              timeZone: tz,
              month: "short",
              day: "numeric",
              weekday: "short",
            }).format(now);
          } catch (e) {
            console.error(e);
          }

          const city = tz.split("/").pop()?.replace(/_/g, " ") || tz;

          return (
            <div key={tz} className="flex items-center justify-between group p-2 rounded hover:bg-[#1a1a1a] transition-colors border border-transparent hover:border-[#2a2a2a]">
              <div>
                <div className="text-lg font-mono font-medium leading-none text-[#e5ecff]">{timeString}</div>
                <div className="text-[10px] text-[#7f8ca7] mt-1 uppercase tracking-wide">{city}</div>
                <div className="text-[10px] text-[#555]">{dateString}</div>
              </div>
              {!isLocked && (
                <button
                  className="opacity-0 group-hover:opacity-100 text-[#5f6c87] hover:text-[#ef4444] text-[10px] transition-opacity px-2 py-1"
                  onClick={() => removeTimezone(tz)}
                  title="Remove"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
