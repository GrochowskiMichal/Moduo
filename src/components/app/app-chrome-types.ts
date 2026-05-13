import type { IconName } from "../ui/icon";

export type ModuleNavItem = {
  label: string;
  iconName: IconName;
  href: string;
  module?: "notes" | "tasks" | "mindmap" | "templates" | "email";
  /** If true, hidden on web builds (Tauri-only feature). */
  desktopOnly?: boolean;
};

export type TaskProjectOption = {
  id: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  description: string;
  logoUrl: string | null;
  position: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type MenuAnchor = { left: number; top: number };
