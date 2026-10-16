// DB-8 — presentational metadata for the Add-widget gallery (icon + one-line
// description per type). Kept out of the pure catalog so catalog.ts stays
// React/lucide-free for the unit test.

import {
  Activity,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  Clock,
  CloudSun,
  FileText,
  Hourglass,
  Link2,
  type LucideIcon,
  Mail,
  Inbox,
  Pin,
  Repeat,
  Timer,
  Type,
  UserRoundPlus,
  Users,
  UsersRound,
} from "lucide-react";

import type { WidgetType } from "../engine/types";

export const WIDGET_GALLERY_META: Record<WidgetType, { icon: LucideIcon; description: string }> = {
  tasks: { icon: CheckSquare, description: "Your Focus line-up, with inline check-off." },
  notes: { icon: FileText, description: "Recently touched notes." },
  calendar: { icon: CalendarDays, description: "What's left on today's schedule." },
  timetracking: { icon: Timer, description: "Your tracked task time this week." },
  email: { icon: Mail, description: "Unread + snoozed + follow-ups (desktop)." },
  "recently-linked": { icon: Link2, description: "The spine's most recent links." },
  activity: { icon: Activity, description: "Cross-module activity + notifications." },
  "needs-attention": { icon: Users, description: "Contacts that need a nudge." },
  reconnect: { icon: UserRoundPlus, description: "People you haven't touched lately." },
  clock: { icon: Clock, description: "Local time + extra timezones." },
  weather: { icon: CloudSun, description: "Current conditions for a city." },
  pomodoro: { icon: Timer, description: "A focus / break timer." },
  countdown: { icon: Hourglass, description: "Counts down to a date." },
  "quick-capture": { icon: Type, description: "Drop a task into the Inbox." },
  habits: { icon: Repeat, description: "Daily checkboxes + streaks." },
  pinned: { icon: Pin, description: "Pin any note, task, contact…" },
  chat: { icon: Inbox, description: "What's waiting for you in Chat: mentions, replies, messages." },
  team: { icon: UsersRound, description: "What each person has on: Focus, in progress, due." },
  upcoming: { icon: CalendarClock, description: "Your coming days, from Tasks' Upcoming." },
};
