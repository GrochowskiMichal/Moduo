// The hover toolbar and the ⋯ menu (spec §3, CH29b; round 5 frame 5). The
// toolbar floats over the row's top edge: your first three quick reactions ·
// Reply · Task · ⋯ (Reply before Task). ⋯ holds the verbs whose blocks exist
// today: Edit (own) · Delete (own) · Pin to conversation · Make a task ·
// Copy link · Mark unread. Mark as decision, Reply to…, Move to…, Make a note
// and Remind me join with their blocks (CV-13, CV-12, CV-16, CV-15, CV-14);
// "any emoji" joins with the picker (CV-7b). Right-click opens the same menu
// with all six quick reactions on top.

import { CheckSquare, Link2, MoreHorizontal, Pencil, Pin, Reply, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FLOATING_SURFACE } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "../model";

/** Moduo's six default quick reactions (spec §6, CH16a); the personal row is CV-7c's. */
export const DEFAULT_QUICK_ROW = ["👍", "✅", "👀", "🙏", "❤️", "😄"] as const;

export type MessageVerbs = {
  onReact: (key: string) => void;
  onReply: () => void;
  onTask: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPin: () => void;
  onCopyLink: () => void;
  onMarkUnread: () => void;
};

const toolButton =
  "inline-flex h-(--ctrl-h-sm) min-w-(--ctrl-h-sm) items-center justify-center gap-1.5 rounded-sm px-1.5 text-muted-foreground outline-none transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-active hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50";

function ActionsMenu({
  message,
  verbs,
  open,
  onOpenChange,
  withReactions,
}: {
  message: ChatMessage;
  verbs: MessageVerbs;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  withReactions: boolean;
}) {
  const pinned = !!message.pinnedAt;
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="More actions" className={toolButton}>
          <MoreHorizontal aria-hidden className="size-icon" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {withReactions ? (
          <>
            <div className="flex items-center justify-between px-1 py-1">
              {DEFAULT_QUICK_ROW.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-label={`React ${key}`}
                  onClick={() => {
                    verbs.onReact(key);
                    onOpenChange(false);
                  }}
                  className={cn(toolButton, "text-base")}
                >
                  {key}
                </button>
              ))}
            </div>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem onSelect={verbs.onReply}>
          <Reply aria-hidden />
          Reply
          <DropdownMenuShortcut>R</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={verbs.onTask}>
          <CheckSquare aria-hidden />
          Make a task
          <DropdownMenuShortcut>T</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={verbs.onPin}>
          <Pin aria-hidden />
          {pinned ? "Unpin" : "Pin to conversation"}
          <DropdownMenuShortcut>P</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={verbs.onCopyLink}>
          <Link2 aria-hidden />
          Copy link
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={verbs.onMarkUnread}>Mark unread</DropdownMenuItem>
        {verbs.onEdit || verbs.onDelete ? <DropdownMenuSeparator /> : null}
        {verbs.onEdit ? (
          <DropdownMenuItem onSelect={verbs.onEdit}>
            <Pencil aria-hidden />
            Edit
            <DropdownMenuShortcut>E</DropdownMenuShortcut>
          </DropdownMenuItem>
        ) : null}
        {verbs.onDelete ? (
          <DropdownMenuItem onSelect={verbs.onDelete}>
            <Trash2 aria-hidden />
            Delete
            <DropdownMenuShortcut>⌘⌫</DropdownMenuShortcut>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The floating toolbar over a row's top edge. */
export function HoverToolbar({
  message,
  verbs,
  menuOpen,
  onMenuOpenChange,
  menuWithReactions,
}: {
  message: ChatMessage;
  verbs: MessageVerbs;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  menuWithReactions: boolean;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Message actions"
      className={cn(
        FLOATING_SURFACE,
        "absolute -top-4 right-(--pad-x-sm) z-10 flex items-center gap-px p-0.5 shadow-md",
      )}
    >
      {DEFAULT_QUICK_ROW.slice(0, 3).map((key) => (
        <button
          key={key}
          type="button"
          aria-label={`React ${key}`}
          onClick={() => verbs.onReact(key)}
          className={cn(toolButton, "text-base")}
        >
          {key}
        </button>
      ))}
      <span aria-hidden className="mx-1 h-4 w-px bg-hairline" />
      <button type="button" onClick={verbs.onReply} className={cn(toolButton, "text-sm")}>
        <Reply aria-hidden className="size-icon" />
        Reply
      </button>
      <button type="button" onClick={verbs.onTask} className={cn(toolButton, "text-sm")}>
        <CheckSquare aria-hidden className="size-icon" />
        Task
      </button>
      <ActionsMenu
        message={message}
        verbs={verbs}
        open={menuOpen}
        onOpenChange={onMenuOpenChange}
        withReactions={menuWithReactions}
      />
    </div>
  );
}
