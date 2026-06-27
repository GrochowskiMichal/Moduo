import type { ModuleNavItem } from "./app-chrome-types";

export function safeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export const baseModulesNavItems: ModuleNavItem[] = [
  { label: "Grid", iconName: "grid", href: "/" },
  { label: "Notes", iconName: "file-text", href: "/notes", module: "notes" },
  { label: "Tasks", iconName: "check-square", href: "/tasks", module: "tasks" },
  { label: "Mindmap", iconName: "git-branch", href: "/mindmap", module: "mindmap" },
  { label: "Email", iconName: "mail", href: "/email", module: "email" },
  { label: "Contacts", iconName: "contact", href: "/contacts" },
];

export const rowStyle = { display: "flex", flexDirection: "row" as const, alignItems: "center" };
export const itemRowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  columnGap: 8,
  minHeight: 32,
} as const;
export const itemNameWrapStyle = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  height: 28,
} as const;
export const itemActionsStyle = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  height: 28,
} as const;
export const iconButtonStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
} as const;
export const plusButtonStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
} as const;
export const deleteRevealBaseStyle = {
  overflow: "hidden",
  transition:
    "max-height 220ms ease, opacity 180ms ease, transform 180ms ease, margin-top 180ms ease",
} as const;
