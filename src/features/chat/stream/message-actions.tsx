// The hover toolbar and the ⋯ menu (spec §3, CH29b; round 5 frame 5). The
// toolbar floats over the row's top edge: your first three quick reactions ·
// Reply · Task · ⋯ (Reply before Task). ⋯ holds the verbs whose blocks exist
// today: Edit (own) · Delete (own) · Pin to conversation · Make a task ·
// Copy link · Mark unread. Reply to… and Wrap up (a root with replies) came with CV-12;
// Mark as decision, Move to…, Make a note and Remind me join with their
// blocks (CV-14, CV-16, CV-15).
// Right-click opens the same menu with your whole quick row on top and
// "Customize…" (CV-7c, CH16a); "any emoji" shows once the picker passes
// `onAnyEmoji` (CV-7b).

import {
  Check,
  CheckSquare,
  CornerUpLeft,
  Link2,
  MessageSquareLock,
  MoreHorizontal,
  Pencil,
  Pin,
  Reply,
  SmilePlus,
  Trash2,
} from "lucide-react";
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

export type MessageVerbs = {
  onReact: (key: string) => void;
  /** Settings → Chat, where your quick row is set. */
  onCustomize?: () => void;
  /** The full picker (CV-7b's seam). Absent: no ☺ button. */
  onAnyEmoji?: () => void;
  onReply: () => void;
  /** An announcement channel you can't post in: a direct message to the author (CH50). */
  onReplyPrivately?: () => void;
  /** "Reply to…": attach this message to an earlier one's chain (absent: no item). */
  onReplyTo?: () => void;
  /** Wrap up this root's chain (absent: no item). */
  onWrapUp?: () => void;
  onTask: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /** Pinning writes (a reader on a paused plan or a viewer can't): absent = no item. */
  onPin?: () => void;
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
  quickRow,
}: {
  message: ChatMessage;
  verbs: MessageVerbs;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  withReactions: boolean;
  quickRow: readonly string[];
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
              {quickRow.map((key) => (
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
            {verbs.onCustomize ? (
              <DropdownMenuItem onSelect={verbs.onCustomize}>Customize…</DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem onSelect={verbs.onReply}>
          <Reply aria-hidden />
          Reply
          <DropdownMenuShortcut>R</DropdownMenuShortcut>
        </DropdownMenuItem>
        {verbs.onReplyPrivately ? (
          <DropdownMenuItem onSelect={verbs.onReplyPrivately}>
            <MessageSquareLock aria-hidden />
            Reply privately
          </DropdownMenuItem>
        ) : null}
        {verbs.onReplyTo ? (
          <DropdownMenuItem onSelect={verbs.onReplyTo}>
            <CornerUpLeft aria-hidden />
            Reply to…
          </DropdownMenuItem>
        ) : null}
        {verbs.onWrapUp ? (
          <DropdownMenuItem onSelect={verbs.onWrapUp}>
            <Check aria-hidden />
            Wrap up
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={verbs.onTask}>
          <CheckSquare aria-hidden />
          Make a task
          <DropdownMenuShortcut>T</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {verbs.onPin ? (
          <DropdownMenuItem onSelect={verbs.onPin}>
            <Pin aria-hidden />
            {pinned ? "Unpin" : "Pin to conversation"}
            <DropdownMenuShortcut>P</DropdownMenuShortcut>
          </DropdownMenuItem>
        ) : null}
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
  quickRow,
}: {
  message: ChatMessage;
  verbs: MessageVerbs;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  menuWithReactions: boolean;
  /** Your quick row, resolved (CV-7c): the first three show here. */
  quickRow: readonly string[];
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
      {quickRow.slice(0, 3).map((key) => (
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
      {verbs.onAnyEmoji ? (
        <button
          type="button"
          aria-label="Any emoji"
          onClick={verbs.onAnyEmoji}
          className={toolButton}
        >
          <SmilePlus aria-hidden className="size-icon" />
        </button>
      ) : null}
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
        quickRow={quickRow}
      />
    </div>
  );
}
