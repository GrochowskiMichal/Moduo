import {
  BarChart2,
  Bell,
  Calendar,
  CheckSquare,
  Clock3,
  Contact,
  DollarSign,
  Edit2,
  Edit3,
  FileText,
  Folder,
  GitBranch,
  Grid2x2,
  House,
  LogOut,
  Mail,
  MessageSquare,
  PenTool,
  Search,
  Settings,
  Tag,
  Trash2,
  UserPlus,
} from "lucide-react";
import type { CSSProperties } from "react";

function GroundRootsIcon({
  size = 16,
  color = "currentColor",
  className,
  style,
}: {
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
}) {
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
      <rect
        x="3.2"
        y="11.8"
        width="17.6"
        height="2.8"
        rx="1.4"
        stroke={color}
        strokeWidth="1.8"
        fill="none"
      />
      <rect
        x="5.4"
        y="16.6"
        width="13.2"
        height="2.6"
        rx="1.3"
        stroke={color}
        strokeWidth="1.8"
        fill="none"
      />
      <rect
        x="7.6"
        y="21"
        width="8.8"
        height="2.2"
        rx="1.1"
        stroke={color}
        strokeWidth="1.8"
        fill="none"
      />
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
  | "home"
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
  | "contact"
  | "bar-chart-2"
  | "dollar-sign"
  | "search"
  | "user-plus"
  | "message-square"
  | "ground-roots";

export type IconSize = "sm" | "md" | "lg";

const SIZE_MAP: Record<IconSize, number> = {
  sm: 16,
  md: 20,
  lg: 24,
};

function resolveSize(size: IconSize | number | undefined): number {
  if (size === undefined) return SIZE_MAP.sm;
  if (typeof size === "number") return size;
  return SIZE_MAP[size];
}

const ICONS: Record<IconName, any> = {
  bell: Bell,
  "edit-2": Edit2,
  settings: Settings,
  "log-out": LogOut,
  "trash-2": Trash2,
  grid: Grid2x2,
  home: House,
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
  contact: Contact,
  "bar-chart-2": BarChart2,
  "dollar-sign": DollarSign,
  search: Search,
  "user-plus": UserPlus,
  "message-square": MessageSquare,
  "ground-roots": GroundRootsIcon,
};

export function Icon({
  name,
  size,
  color = "currentColor",
  className,
  style,
}: {
  name: IconName;
  /**
   * Token-driven enum: "sm" (16px), "md" (20px), "lg" (24px). A raw
   * number is accepted for legacy call sites; prefer the enum so the
   * scale stays consistent across the app.
   */
  size?: IconSize | number;
  color?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const Component = ICONS[name];
  const resolved = resolveSize(size);
  return <Component size={resolved} color={color} className={className} style={style} />;
}
