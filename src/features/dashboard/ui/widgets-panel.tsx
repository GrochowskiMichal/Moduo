import { useDraggable } from "@dnd-kit/core";
import { Lock, LockOpen } from "lucide-react";
import type { WidgetType } from "../types";

type WidgetSourceType =
  | WidgetType
  | "feed"
  | "world-clock"
  | "server-api-status"
  | "signal";

function WidgetSource({ type, label, description, disabled }: { type: WidgetSourceType; label: string; description: string; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `dashboard-source-${type}`,
    data: { isSource: true, type, label },
    disabled,
  });

  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`mb-2 rounded-xl border px-3 py-2 select-none ${
        disabled ? "cursor-not-allowed border-[#232323] bg-[#111111] opacity-45" : "cursor-grab border-[#2b2b2b] bg-[#151515] hover:bg-[#191919]"
      }`}
    >
      <p className="text-[13px] font-medium text-[#e4e4e4]">{label}</p>
      <p className="mt-1 text-[11px] text-[#8a8a8a]">{description}</p>
    </div>
  );
}

export function WidgetsPanel({ isLocked, onToggleLock }: { isLocked: boolean; onToggleLock: () => void }) {
  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[12px] uppercase tracking-[0.08em] text-[#7f7f7f]">Widgets</p>
        <button
          onClick={onToggleLock}
          aria-label={isLocked ? "Unlock widgets" : "Lock widgets"}
          title={isLocked ? "Unlock widgets" : "Lock widgets"}
          className={`grid h-7 w-7 place-items-center rounded-md ${isLocked ? "text-[#a2a2a2]" : "text-[#f2f2f2]"}`}
        >
          {isLocked ? <Lock size={13} /> : <LockOpen size={13} />}
        </button>
      </div>

      <WidgetSource type="notes" label="Notes" description="Pinned or selected note focus" disabled={isLocked} />
      <WidgetSource type="clock" label="Timezone Clock" description="List of selected timezone clocks" disabled={isLocked} />
      <WidgetSource type="weather" label="Weather" description="Live weather for any city" disabled={isLocked} />
      <WidgetSource type="stock" label="Stock Tracker" description="Watchlist with price & change" disabled={isLocked} />
      <WidgetSource type="crypto" label="Crypto Tracker" description="Live prices via CoinGecko" disabled={isLocked} />
      <WidgetSource type="pomodoro" label="Pomodoro Tracker" description="Focus and break session timer" disabled={isLocked} />
      <WidgetSource type="hydration" label="Hydration Tracker" description="Track daily water intake" disabled={isLocked} />
      <WidgetSource type="countdown" label="Countdown" description="Live countdown to a target date & time" disabled={isLocked} />
      <WidgetSource type="todolist" label="To-do List" description="Checklist with title and actionable items" disabled={isLocked} />
      <WidgetSource type="job-tracker" label="Job Application Tracker" description="Track applications, stages, salary, and offer links" disabled={isLocked} />
      <WidgetSource type="recently-linked" label="Recently Linked" description="Latest connections across your workspace; click to open" disabled={isLocked} />
      <WidgetSource type="contacts-needs-attention" label="Needs Attention" description="Contacts with an overdue follow-up, no recent touch, or a stale lead" disabled={isLocked} />
      <WidgetSource type="contacts-reconnect" label="Reconnect" description="People you’ve gone quiet on — a gentle nudge to reach out" disabled={isLocked} />
      <WidgetSource type="calendar-today" label="Today" description="What’s left on your calendar today, plus unfinished work to move forward" disabled={isLocked} />
      <WidgetSource type="feed" label="Feed" description="Activity stream from your workspace" disabled />
      <WidgetSource type="world-clock" label="World Clock" description="Multi-city world clock view" disabled />
      <WidgetSource type="server-api-status" label="Live Status (Servers & APIs)" description="Monitor uptime and incidents for selected services" disabled />
      <WidgetSource type="signal" label="Signal" description="Track changes of selected internet events and sources" disabled />
    </div>
  );
}
