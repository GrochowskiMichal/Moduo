import type { IconName } from "../ui/icon";

export type ModuleNavItem = {
  label: string;
  iconName: IconName;
  href: string;
  module?: "notes" | "tasks" | "mindmap" | "templates" | "email";
};
