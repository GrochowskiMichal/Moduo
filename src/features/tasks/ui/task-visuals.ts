import type { TaskPriority, TaskWorkflowKind } from "../types";

export function formatTaskDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function statusVisual(
  kind: TaskWorkflowKind,
  colorOverride?: string | null,
  iconOverride?: string | null
): { icon: string; color: string } {
  let visual: { icon: string; color: string };
  switch (kind) {
    case "backlog":
      visual = { icon: "○", color: "#6f7682" };
      break;
    case "todo":
      visual = { icon: "◉", color: "#d9dde5" };
      break;
    case "in_progress":
      visual = { icon: "◔", color: "#f0a43d" };
      break;
    case "in_review":
      visual = { icon: "◉", color: "#9b6dff" };
      break;
    case "done":
      visual = { icon: "◉", color: "#2fbf71" };
      break;
    case "canceled":
      visual = { icon: "⨯", color: "#ff6767" };
      break;
    default:
      visual = { icon: "◉", color: "#8e8e8e" };
      break;
  }
  return {
    icon: iconOverride?.trim() ? iconOverride : visual.icon,
    color: colorOverride?.trim() ? colorOverride : visual.color,
  };
}

export function priorityVisual(priority: TaskPriority): { label: string; icon: string; color: string } {
  if (priority === 0) return { label: "Urgent", icon: "△", color: "#ff5252" };
  if (priority === 1) return { label: "High", icon: "↑", color: "#f0a43d" };
  if (priority === 2) return { label: "Medium", icon: "→", color: "#2f8fff" };
  if (priority === 3) return { label: "Low", icon: "↓", color: "#7f8898" };
  return { label: "None", icon: "—", color: "#616978" };
}
