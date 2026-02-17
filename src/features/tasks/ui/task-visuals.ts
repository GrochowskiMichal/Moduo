import type { TaskPriority, TaskWorkflowKind } from "../types";

export function formatTaskDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function statusVisual(kind: TaskWorkflowKind): { icon: string; color: string } {
  switch (kind) {
    case "backlog":
      return { icon: "○", color: "#6f7682" };
    case "todo":
      return { icon: "◉", color: "#d9dde5" };
    case "in_progress":
      return { icon: "◔", color: "#f0a43d" };
    case "in_review":
      return { icon: "◉", color: "#9b6dff" };
    case "done":
      return { icon: "◉", color: "#2fbf71" };
    case "canceled":
      return { icon: "⨯", color: "#ff6767" };
    default:
      return { icon: "◉", color: "#8e8e8e" };
  }
}

export function priorityVisual(priority: TaskPriority): { label: string; icon: string; color: string } {
  if (priority === 0) return { label: "Urgent", icon: "△", color: "#ff5252" };
  if (priority === 1) return { label: "High", icon: "↑", color: "#f0a43d" };
  if (priority === 2) return { label: "Medium", icon: "→", color: "#2f8fff" };
  if (priority === 3) return { label: "Low", icon: "↓", color: "#7f8898" };
  return { label: "None", icon: "—", color: "#616978" };
}
