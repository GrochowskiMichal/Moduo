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

function GroundRootsIcon({ size = 16, color = "currentColor", className, style }: { size?: number; color?: string; className?: string; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d="M12 4V11.8" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <rect x="3.2" y="11.8" width="17.6" height="2.8" rx="1.4" stroke={color} strokeWidth="1.8" fill="none" />
      <rect x="5.4" y="16.6" width="13.2" height="2.6" rx="1.3" stroke={color} strokeWidth="1.8" fill="none" />
      <rect x="7.6" y="21" width="8.8" height="2.2" rx="1.1" stroke={color} strokeWidth="1.8" fill="none" />
    </svg>
  );
}

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
  | "search"
  | "ground-roots";

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
  "ground-roots": GroundRootsIcon,
};

export function Icon({ name, size = 16, color = "currentColor", className, style }: { name: IconName; size?: number; color?: string; className?: string; style?: CSSProperties; }) {
  const Component = ICONS[name];
  return <Component size={size} color={color} className={className} style={style} />;
}
