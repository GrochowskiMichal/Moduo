import {
  BarChart2,
  Calendar,
  CheckSquare,
  Clock3,
  DollarSign,
  Edit2,
  Edit3,
  FileText,
  Folder,
  GitBranch,
  Grid2x2,
  LogOut,
  Mail,
  PenTool,
  Search,
  Settings,
  Tag,
  Trash2,
  Bell,
} from "lucide-react";
import type { CSSProperties } from "react";

export type IconName =
  | "bell"
  | "edit-2"
  | "settings"
  | "log-out"
  | "trash-2"
  | "grid"
  | "calendar"
  | "file-text"
  | "mail"
  | "check-square"
  | "tag"
  | "edit-3"
  | "clock"
  | "pen-tool"
  | "git-branch"
  | "folder"
  | "bar-chart-2"
  | "dollar-sign"
  | "search";

const ICONS: Record<IconName, any> = {
  bell: Bell,
  "edit-2": Edit2,
  settings: Settings,
  "log-out": LogOut,
  "trash-2": Trash2,
  grid: Grid2x2,
  calendar: Calendar,
  "file-text": FileText,
  mail: Mail,
  "check-square": CheckSquare,
  tag: Tag,
  "edit-3": Edit3,
  clock: Clock3,
  "pen-tool": PenTool,
  "git-branch": GitBranch,
  folder: Folder,
  "bar-chart-2": BarChart2,
  "dollar-sign": DollarSign,
  search: Search,
};

export function Icon({ name, size = 16, color = "currentColor", className, style }: { name: IconName; size?: number; color?: string; className?: string; style?: CSSProperties; }) {
  const Component = ICONS[name];
  return <Component size={size} color={color} className={className} style={style} />;
}
