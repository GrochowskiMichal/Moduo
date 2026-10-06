import type { IconName } from "../ui/icon";

export type ModuleNavItem = {
  label: string;
  iconName: IconName;
  href: string;
  module?: "notes" | "tasks" | "calendar" | "mindmap" | "templates" | "email" | "chat";
};

/** Anchor coordinates for a floating menu attached to a chip in the top bar. */
export type MenuAnchor = { left: number; top: number };
