// DB-5 — the type → component half of the registry (app-only; pulls React, so
// it never enters a vitest graph — the pure metadata lives in catalog.ts). The
// 9 module widgets ship real bodies; the other 7 render ComingSoonWidget until
// DB-6/DB-7 replace their entries.

import type { WidgetType } from "../engine/types";
import { ActivityFeedWidget } from "../ui/widgets/activity-feed-widget";
import { CalendarTodayWidget } from "../ui/widgets/calendar-today-widget";
import { ChatWidget } from "../ui/widgets/chat-widget";
import { ClockWidget } from "../ui/widgets/clock-widget";
import { CountdownWidget } from "../ui/widgets/countdown-widget";
import { EmailInboxWidget } from "../ui/widgets/email-inbox-widget";
import { HabitsWidget } from "../ui/widgets/habits-widget";
import { NeedsAttentionWidget } from "../ui/widgets/needs-attention-widget";
import { NotesWidget } from "../ui/widgets/notes-widget";
import { PinnedWidget } from "../ui/widgets/pinned-widget";
import { PomodoroWidget } from "../ui/widgets/pomodoro-widget";
import { QuickCaptureWidget } from "../ui/widgets/quick-capture-widget";
import { RecentlyLinkedWidget } from "../ui/widgets/recently-linked-widget";
import { ReconnectWidget } from "../ui/widgets/reconnect-widget";
import { TasksWidget } from "../ui/widgets/tasks-widget";
import { TimetrackingWidget } from "../ui/widgets/timetracking-widget";
import { WeatherWidget } from "../ui/widgets/weather-widget";
import { WIDGET_CATALOG } from "./catalog";
import type { WidgetComponent, WidgetDefinition } from "./types";

const WIDGET_COMPONENTS: Record<WidgetType, WidgetComponent> = {
  tasks: TasksWidget,
  notes: NotesWidget,
  calendar: CalendarTodayWidget,
  timetracking: TimetrackingWidget,
  email: EmailInboxWidget,
  "recently-linked": RecentlyLinkedWidget,
  activity: ActivityFeedWidget,
  "needs-attention": NeedsAttentionWidget,
  reconnect: ReconnectWidget,
  // DB-6 (utility + new) + DB-7 (habits):
  clock: ClockWidget,
  weather: WeatherWidget,
  pomodoro: PomodoroWidget,
  countdown: CountdownWidget,
  "quick-capture": QuickCaptureWidget,
  habits: HabitsWidget,
  pinned: PinnedWidget,
  chat: ChatWidget,
};

export function getWidgetComponent(type: WidgetType): WidgetComponent {
  return WIDGET_COMPONENTS[type];
}

export function getWidgetDefinition(type: WidgetType): WidgetDefinition {
  return { ...WIDGET_CATALOG[type], Component: WIDGET_COMPONENTS[type] };
}
