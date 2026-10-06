import type { ModuleNavItem } from "./app-chrome-types";

export function safeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export const baseModulesNavItems: ModuleNavItem[] = [
  { label: "Home", iconName: "home", href: "/" },
  { label: "Notes", iconName: "file-text", href: "/notes", module: "notes" },
  { label: "Tasks", iconName: "check-square", href: "/tasks", module: "tasks" },
  { label: "Calendar", iconName: "calendar", href: "/calendar", module: "calendar" },
  // Mindmap is hidden from the alpha nav (DF-4) — the module rethink is scheduled
  // after Email + Dashboard. The /mindmap route + its layout entry stay wired
  // (route-tree.tsx, routeToFeatureLayout) so it's still reachable directly.
  { label: "Email", iconName: "mail", href: "/email", module: "email" },
  { label: "Contacts", iconName: "contact", href: "/contacts" },
  // Chat (specs/chat.md): always listed — Duo/Team/Founder workspaces get the
  // module, everyone else gets the locked explainer + upgrade path.
  { label: "Chat", iconName: "message-square", href: "/chat", module: "chat" },
];

// Routes that are intentionally reachable but NOT shown in the nav — kept wired
// for later work but hidden from the alpha. The app-chrome "bounce unknown
// routes home" guard must exempt these, or a direct visit gets redirected to the
// first nav tab. Mindmap is hidden pending its post-Email/Dashboard rethink (DF-4).
export const hiddenReachableRoutes: readonly string[] = ["/mindmap"];

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
