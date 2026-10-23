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
  FolderTree,
  Globe,
  type LucideIcon,
  Smile,
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
  | "icon"
  | "export"
  | "export-tree"
  | "publish"
  | "archive"
  | "trash";

export type RowMenuItem =
  { action: RowAction; label: string; icon: LucideIcon; destructive?: boolean } | "separator";

export function rowMenuItems(opts: {
  canEdit: boolean;
  favorite: boolean;
  section?: SidebarSection;
  /** The note has sub-pages: offer them in one .zip too. */
  hasChildren?: boolean;
}): RowMenuItem[] {
  const fav: RowMenuItem = opts.favorite
    ? { action: "unfavorite", label: "Remove from favorites", icon: StarOff }
    : { action: "favorite", label: "Add to favorites", icon: Star };
  const exports: RowMenuItem[] = [
    { action: "export", label: "Export .md", icon: Download },
    ...(opts.hasChildren
      ? [
          {
            action: "export-tree",
            label: "Export with sub-pages (.zip)",
            icon: FolderTree,
          } as const,
        ]
      : []),
  ];
  if (!opts.canEdit) return [fav, ...exports];
  return [
    fav,
    { action: "subpage", label: "New subpage", icon: FilePlus },
    { action: "duplicate", label: "Duplicate", icon: Copy },
    { action: "move", label: "Move to…", icon: FolderInput },
    { action: "icon", label: "Change icon…", icon: Smile },
    ...exports,
    { action: "publish", label: "Publish…", icon: Globe },
    "separator",
    { action: "archive", label: "Archive", icon: Archive },
    { action: "trash", label: "Move to trash", icon: Trash2, destructive: true },
  ];
}
