import { useDraggable } from "@dnd-kit/core";
import type { WidgetType } from "../types";

function WidgetSource({ type, label, description, disabled }: { type: WidgetType; label: string; description: string; disabled: boolean }) {
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
    <div className="h-full">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[12px] uppercase tracking-[0.08em] text-[#7f7f7f]">Widgets</p>
        <button
          onClick={onToggleLock}
          className={`rounded-md px-2 py-1 text-[11px] ${isLocked ? "bg-[#191919] text-[#a2a2a2]" : "bg-[#f2f2f2] text-[#101010]"}`}
        >
          {isLocked ? "Locked" : "Unlocked"}
        </button>
      </div>

      <WidgetSource type="notes" label="Notes" description="Pinned or selected note focus" disabled={isLocked} />
      <WidgetSource type="tasks" label="Tasks" description="Task queue with project filter" disabled={isLocked} />
      <WidgetSource type="clock" label="Timezone Clock" description="List of selected timezone clocks" disabled={isLocked} />
      <WidgetSource type="weather" label="Weather" description="Live weather for any city" disabled={isLocked} />
      <WidgetSource type="stock" label="Stock Tracker" description="Watchlist with price & change" disabled={isLocked} />
      <WidgetSource type="crypto" label="Crypto Tracker" description="Live prices via CoinGecko" disabled={isLocked} />
      <WidgetSource type="pomodoro" label="Pomodoro Tracker" description="Focus and break session timer" disabled={isLocked} />
      <WidgetSource type="hydration" label="Hydration Tracker" description="Track daily water intake" disabled={isLocked} />
      <WidgetSource type="countdown" label="Countdown" description="Live countdown to a target date & time" disabled={isLocked} />

      <p className="mt-4 text-[11px] text-[#707070]">
        {isLocked ? "Unlock to drag, resize, or add widgets." : "Drag widgets onto the board to customize your layout."}
      </p>
    </div>
  );
}
