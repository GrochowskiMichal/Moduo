/**
 * The note row menu (specs/notes-refresh.md NR-2 §Sidebar): one list, drawn by
 * both the row's `⋯` and its right-click menu, and by the top bar's `⋯`.
 * View-only members keep only what reads (favorite, export).
 */

import {
  Archive,
  Copy,
  Download,
  FilePlus,
  FolderInput,
  Globe,
  type LucideIcon,
  Star,
  StarOff,
  Trash2,
} from "lucide-react";
import type { SidebarSection } from "./drop-intent";

export type RowAction =
  | "favorite"
  | "unfavorite"
  | "subpage"
  | "duplicate"
  | "move"
  | "export"
  | "publish"
  | "archive"
  | "trash";

export type RowMenuItem =
  | { action: RowAction; label: string; icon: LucideIcon; destructive?: boolean }
  | "separator";

export function rowMenuItems(opts: {
  canEdit: boolean;
  favorite: boolean;
  section?: SidebarSection;
}): RowMenuItem[] {
  const fav: RowMenuItem = opts.favorite
    ? { action: "unfavorite", label: "Remove from favorites", icon: StarOff }
    : { action: "favorite", label: "Add to favorites", icon: Star };
  const exportItem: RowMenuItem = { action: "export", label: "Export .md", icon: Download };
  if (!opts.canEdit) return [fav, exportItem];
  return [
    fav,
    { action: "subpage", label: "New subpage", icon: FilePlus },
    { action: "duplicate", label: "Duplicate", icon: Copy },
    { action: "move", label: "Move to…", icon: FolderInput },
    exportItem,
    { action: "publish", label: "Publish…", icon: Globe },
    "separator",
    { action: "archive", label: "Archive", icon: Archive },
    { action: "trash", label: "Move to trash", icon: Trash2, destructive: true },
  ];
}
