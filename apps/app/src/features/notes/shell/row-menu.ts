/**
 * The note row menu (specs/notes-refresh.md NR-2 §Sidebar): one list, drawn by
 * both the row's `⋯` and its right-click menu. Every note action lives here
 * (the top bar keeps only the breadcrumb, Mike 2026-10-24).
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
  MoveHorizontal,
  Smile,
  Star,
  StarOff,
  Trash2,
  Users,
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
  | "share"
  | "publish"
  | "full-width"
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
  /** The note is shown full width (the item turns it back to reading width). */
  fullWidth?: boolean;
  /** Someone to share with (a workspace of one has nobody: no Share…). */
  canShare?: boolean;
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
            label: "Export with subpages (.zip)",
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
    ...(opts.canShare === false
      ? []
      : [{ action: "share", label: "Share…", icon: Users } as const]),
    { action: "publish", label: "Publish…", icon: Globe },
    {
      action: "full-width",
      label: opts.fullWidth ? "Reading width" : "Full width",
      icon: MoveHorizontal,
    },
    "separator",
    { action: "archive", label: "Archive", icon: Archive },
    { action: "trash", label: "Delete", icon: Trash2, destructive: true },
  ];
}
