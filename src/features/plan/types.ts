export type PlanViewMode = "slot" | "board" | "timeline";

// Re-export for unified use
export type { CalendarViewMode, CalendarEvent, CalendarEventDraft, CalendarSource, CalendarAccount } from "../calendar/types";
export type { Task, TaskWorkflowState, TaskProject, TaskPriority, TaskWorkflowKind } from "../tasks/types";
