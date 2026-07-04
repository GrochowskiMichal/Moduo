import { useDroppable } from "@dnd-kit/core";
import type { ModuoRuntime } from "../../../lib/runtime";
import type { NoteMeta } from "../../notes/types";
import type { WidgetConfig, WidgetInstance } from "../types";
import { WidgetContainer } from "./widget-container";
import { ClockWidget } from "./widgets/clock-widget";
import { CountdownWidget } from "./widgets/countdown-widget";
import { CryptoWidget } from "./widgets/crypto-widget";
import { HydrationWidget } from "./widgets/hydration-widget";
import { JobTrackerWidget } from "./widgets/job-tracker-widget";
import { NotesWidget } from "./widgets/notes-widget";
import { PomodoroWidget } from "./widgets/pomodoro-widget";
import { RecentlyLinkedWidget } from "./widgets/recently-linked-widget";
import { ContactsNeedsAttentionWidget } from "./widgets/contacts-needs-attention-widget";
import { CalendarTodayWidget } from "./widgets/calendar-today-widget";
import { RecentNotesWidget } from "./widgets/recent-notes-widget";
import { ContactsReconnectWidget } from "./widgets/contacts-reconnect-widget";
import { StockWidget } from "./widgets/stock-widget";
import { TodoListWidget } from "./widgets/todo-list-widget";
import { WeatherWidget } from "./widgets/weather-widget";

type Props = {
  widgets: WidgetInstance[];
  gridSize: number;
  isLocked: boolean;
  runtime: ModuoRuntime | null;
  workspaceId: string;
  notes: NoteMeta[];
  onResize: (id: string, w: number, h: number) => void;
  onRemove: (id: string) => void;
  onUpdateConfig: (id: string, patch: Partial<WidgetConfig>) => void;
};

export function DashboardGrid({
  widgets,
  gridSize,
  isLocked,
  runtime,
  workspaceId,
  notes,
  onResize,
  onRemove,
  onUpdateConfig,
}: Props) {
  const { isOver, setNodeRef } = useDroppable({ id: "dashboard-grid", disabled: isLocked });

  return (
    <div
      ref={setNodeRef}
      className={`relative h-full w-full transition-colors ${isOver && !isLocked ? "bg-[#111111]/70" : "bg-transparent"}`}
      style={{
        backgroundImage: isLocked ? "none" : "radial-gradient(#2a2a2a 1px, transparent 1px)",
        backgroundSize: `${gridSize}px ${gridSize}px`,
      }}
    >
      {widgets.map((widget) => (
        <WidgetContainer
          key={widget.id}
          widget={widget}
          gridSize={gridSize}
          isLocked={isLocked}
          onResize={onResize}
          onRemove={onRemove}
        >
          {widget.type === "notes" ? (
            <NotesWidget
              notes={notes}
              workspaceId={workspaceId}
              runtime={runtime}
              config={widget.config}
              isLocked={isLocked}
              onUpdateConfig={(patch) => onUpdateConfig(widget.id, patch)}
            />
          ) : null}
          {widget.type === "clock" ? (
            <ClockWidget config={widget.config} isLocked={isLocked} onUpdateConfig={(patch) => onUpdateConfig(widget.id, patch)} />
          ) : null}
          {widget.type === "weather" ? (
            <WeatherWidget config={widget.config} isLocked={isLocked} onUpdateConfig={(patch) => onUpdateConfig(widget.id, patch)} />
          ) : null}
          {widget.type === "stock" ? (
            <StockWidget config={widget.config} isLocked={isLocked} onUpdateConfig={(patch) => onUpdateConfig(widget.id, patch)} />
          ) : null}
          {widget.type === "crypto" ? (
            <CryptoWidget config={widget.config} isLocked={isLocked} onUpdateConfig={(patch) => onUpdateConfig(widget.id, patch)} />
          ) : null}
          {widget.type === "pomodoro" ? (
            <PomodoroWidget config={widget.config} isLocked={isLocked} onUpdateConfig={(patch) => onUpdateConfig(widget.id, patch)} />
          ) : null}
          {widget.type === "hydration" ? (
            <HydrationWidget config={widget.config} isLocked={isLocked} onUpdateConfig={(patch) => onUpdateConfig(widget.id, patch)} />
          ) : null}
          {widget.type === "countdown" ? (
            <CountdownWidget config={widget.config} isLocked={isLocked} onUpdateConfig={(patch) => onUpdateConfig(widget.id, patch)} />
          ) : null}
          {widget.type === "todolist" ? (
            <TodoListWidget config={widget.config} isLocked={isLocked} onUpdateConfig={(patch) => onUpdateConfig(widget.id, patch)} />
          ) : null}
          {widget.type === "job-tracker" ? (
            <JobTrackerWidget config={widget.config} isLocked={isLocked} onUpdateConfig={(patch) => onUpdateConfig(widget.id, patch)} />
          ) : null}
          {widget.type === "recently-linked" ? (
            <RecentlyLinkedWidget
              runtime={runtime}
              workspaceId={workspaceId}
              config={widget.config}
              isLocked={isLocked}
              onUpdateConfig={(patch) => onUpdateConfig(widget.id, patch)}
            />
          ) : null}
          {widget.type === "contacts-needs-attention" ? (
            <ContactsNeedsAttentionWidget
              runtime={runtime}
              workspaceId={workspaceId}
              config={widget.config}
              isLocked={isLocked}
              onUpdateConfig={(patch) => onUpdateConfig(widget.id, patch)}
            />
          ) : null}
          {widget.type === "contacts-reconnect" ? (
            <ContactsReconnectWidget
              runtime={runtime}
              workspaceId={workspaceId}
              config={widget.config}
              isLocked={isLocked}
              onUpdateConfig={(patch) => onUpdateConfig(widget.id, patch)}
            />
          ) : null}
          {widget.type === "calendar-today" ? (
            <CalendarTodayWidget
              runtime={runtime}
              workspaceId={workspaceId}
              config={widget.config}
              isLocked={isLocked}
              onUpdateConfig={(patch) => onUpdateConfig(widget.id, patch)}
            />
          ) : null}
          {widget.type === "recent-notes" ? (
            <RecentNotesWidget
              runtime={runtime}
              workspaceId={workspaceId}
              config={widget.config}
              isLocked={isLocked}
              onUpdateConfig={(patch) => onUpdateConfig(widget.id, patch)}
            />
          ) : null}
        </WidgetContainer>
      ))}

      {widgets.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p className="text-[26px] text-[#404040]">+</p>
            <p className="text-[13px] text-[#8b8b8b]">Board is empty</p>
            <p className="mt-1 text-[11px] text-[#676767]">{isLocked ? "Unlock to add widgets." : "Drag widgets from the left panel."}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
