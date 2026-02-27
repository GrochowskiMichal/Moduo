import type { IconName } from "../ui/icon";

export type TabItem = {
  label: string;
  iconName: IconName;
  href: string;
  module?: "notes" | "tasks" | "mindmap" | "templates" | "email";
};

export type TaskProjectOption = {
  id: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  description: string;
  position: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type MenuAnchor = { left: number; top: number };
