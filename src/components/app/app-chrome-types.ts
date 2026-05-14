import type { IconName } from "../ui/icon";

export type ModuleNavItem = {
  label: string;
  iconName: IconName;
  href: string;
  module?: "notes" | "tasks" | "mindmap" | "templates" | "email";
};

/** Used by the legacy per-route picker menus (see AppChromeMenus). */
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

/** Anchor coordinates for a floating menu attached to a chip in the top bar. */
export type MenuAnchor = { left: number; top: number };
