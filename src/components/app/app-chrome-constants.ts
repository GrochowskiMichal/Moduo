import type { TabItem, TaskProjectOption } from "./app-chrome-types";

export function safeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeTaskProject(raw: any): TaskProjectOption {
  return {
    id: raw.id,
    workspaceId: raw.workspaceId ?? raw.workspace_id,
    ownerId: raw.ownerId ?? raw.owner_id,
    name: raw.name ?? "New Project",
    description: raw.description ?? "",
    logoUrl: raw.logoUrl ?? raw.logo_url ?? null,
    position: raw.position ?? `m${Date.now().toString(36)}`,
    createdAt: raw.createdAt ?? raw.created_at ?? nowIso(),
    updatedAt: raw.updatedAt ?? raw.updated_at ?? nowIso(),
    deletedAt: raw.deletedAt ?? raw.deleted_at ?? null,
  };
}

export const baseTabs: TabItem[] = [
  { label: "Dashboard", iconName: "grid", href: "/dashboard" },
  { label: "Notes", iconName: "file-text", href: "/notes", module: "notes" },
  { label: "Plan", iconName: "calendar", href: "/plan" },
  { label: "Mindmap", iconName: "git-branch", href: "/mindmap", module: "mindmap" },
  { label: "Templates", iconName: "edit-3", href: "/templates", module: "templates" },
  { label: "Email", iconName: "mail", href: "/email", module: "email" },
  { label: "CRM", iconName: "folder", href: "/crm" },
  { label: "Forms", iconName: "edit-2", href: "/forms" },
  { label: "Activity", iconName: "bar-chart-2", href: "/activity" },
  { label: "Feed", iconName: "bar-chart-2", href: "/feed" },
  { label: "Files", iconName: "folder", href: "/files" },
  { label: "Brainstorm", iconName: "pen-tool", href: "/brainstorm" },
  { label: "Expanses", iconName: "dollar-sign", href: "/expanses" },
  { label: "Revenue", iconName: "dollar-sign", href: "/revenue" },
  { label: "KPI/OKR", iconName: "tag", href: "/kpi-okr" },
  { label: "Stats", iconName: "bar-chart-2", href: "/stats" },
  { label: "Analytics", iconName: "search", href: "/analytics" },
  { label: "Recordings", iconName: "file-text", href: "/recordings" },
  { label: "Timetracking", iconName: "clock", href: "/timetracking" },
  { label: "Roadmap", iconName: "git-branch", href: "/roadmap" },
];

export const rowStyle = { display: "flex", flexDirection: "row" as const, alignItems: "center" };
export const itemRowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  columnGap: 8,
  minHeight: 32,
} as const;
export const itemNameWrapStyle = { minWidth: 0, display: "flex", alignItems: "center", height: 28 } as const;
export const itemActionsStyle = { display: "flex", alignItems: "center", gap: 4, height: 28 } as const;
export const iconButtonStyle = { display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28 } as const;
export const plusButtonStyle = { display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24 } as const;
export const deleteRevealBaseStyle = {
  overflow: "hidden",
  transition: "max-height 220ms ease, opacity 180ms ease, transform 180ms ease, margin-top 180ms ease",
} as const;
