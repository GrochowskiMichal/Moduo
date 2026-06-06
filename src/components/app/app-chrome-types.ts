import type { IconName } from "../ui/icon";

export type ModuleNavItem = {
  label: string;
  iconName: IconName;
  href: string;
  module?: "notes" | "tasks" | "mindmap" | "templates" | "email";
  /** If true, hidden on web builds (Tauri-only feature). */
  desktopOnly?: boolean;
};

/** Anchor coordinates for a floating menu attached to a chip in the top bar. */
export type MenuAnchor = { left: number; top: number };
