// One message row (specs/chat.md §Message). Grouped rows drop the avatar +
// header and show the time in the gutter on hover. The hover toolbar is
// absolutely positioned and fades in (never reflows — R6). Right-click opens
// the same actions as a context menu; every action is also keyboard-reachable
// through the toolbar's "More" menu.

import { formatDistanceToNowStrict } from "date-fns";
import {
  AlertCircle,
  Bot,
  CheckSquare,
  Copy,
  EyeOff,
  Link2,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  SmilePlus,
  Trash2,
} from "lucide-react";
import { memo, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SELECTED_OPTION } from "@/components/ui/selection";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { QUICK_REACTIONS } from "../emoji";
import type { ComposerPick } from "../markup";
import type { ChatMessage, ChatPerson } from "../model";
import { Composer, type ComposerProps } from "./composer";
import { EmojiPicker } from "./emoji-picker";
import { MessageBody } from "./message-body";
import { PersonAvatar } from "./person-avatar";

const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const FULL = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" });

export type MessageActions = {
  onReact: (m: ChatMessage, emoji: string) => void;
  onReply?: (m: ChatMessage) => void;
  onStartEdit: (m: ChatMessage) => void;
  onSaveEdit: (m: ChatMessage, text: string, picks: ComposerPick[]) => void;
  onCancelEdit: () => void;
  onDelete: (m: ChatMessage) => void;
  onPin: (m: ChatMessage, pinned: boolean) => void;
  onMarkUnread?: (m: ChatMessage) => void;
  onCopyLink: (m: ChatMessage) => void;
  onCopyText: (m: ChatMessage) => void;
  onCreateTask: (m: ChatMessage) => void;
  onRetry: (m: ChatMessage) => void;
  onPersonClick?: (userId: string) => void;
};

type Props = {
  message: ChatMessage;
  grouped: boolean;
  selfId: string | null;
  personOf: (id: string) => ChatPerson | undefined;
  isOnline: (id: string) => boolean;
  editing: boolean;
  editInitial?: { text: string; picks: ComposerPick[] };
  composerBase: Pick<ComposerProps, "runtime" | "workspaceId" | "selfId" | "people">;
  highlighted?: boolean;
  /** Thread panel rows don't offer "reply in thread". */
  inThread?: boolean;
  actions: MessageActions;
};

function ReactionPill({
  emoji,
  users,
  selfId,
  personOf,
  onToggle,
}: {
  emoji: string;
  users: string[];
  selfId: string | null;
  personOf: (id: string) => ChatPerson | undefined;
  onToggle: () => void;
}) {
  const mine = selfId ? users.includes(selfId) : false;
  const names = users.map((u) => (u === selfId ? "You" : (personOf(u)?.name ?? "Someone")));
  const who =
    names.length <= 3
      ? names.join(", ")
      : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={mine}
          aria-label={`${emoji} ${users.length}, ${who}`}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs tabular-nums transition-colors",
            mine
              ? `${SELECTED_OPTION} text-foreground`
              : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
          )}
        >
          <span className="text-sm leading-none">{emoji}</span>
          <span>{users.length}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {who} reacted with {emoji}
      </TooltipContent>
    </Tooltip>
  );
}

function MenuItems({
  m,
  own,
  inThread,
  actions,
  Item,
  Separator,
}: {
  m: ChatMessage;
  own: boolean;
  inThread?: boolean;
  actions: MessageActions;
  Item: typeof DropdownMenuItem | typeof ContextMenuItem;
  Separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator;
}) {
  return (
    <>
      {!inThread && actions.onReply ? (
        <Item onSelect={() => actions.onReply?.(m)}>
          <MessageSquareText aria-hidden /> Reply in thread
        </Item>
      ) : null}
      <Item onSelect={() => actions.onCreateTask(m)}>
        <CheckSquare aria-hidden /> Create task from message
      </Item>
      <Item onSelect={() => actions.onPin(m, !m.pinnedAt)}>
        {m.pinnedAt ? <PinOff aria-hidden /> : <Pin aria-hidden />}
        {m.pinnedAt ? "Unpin" : "Pin to conversation"}
      </Item>
      {!inThread && actions.onMarkUnread && !own ? (
        <Item onSelect={() => actions.onMarkUnread?.(m)}>
          <EyeOff aria-hidden /> Mark unread
        </Item>
      ) : null}
      <Separator />
      <Item onSelect={() => actions.onCopyText(m)}>
        <Copy aria-hidden /> Copy text
      </Item>
      <Item onSelect={() => actions.onCopyLink(m)}>
        <Link2 aria-hidden /> Copy link
      </Item>
      {own ? (
        <>
          <Separator />
          <Item onSelect={() => actions.onStartEdit(m)}>
            <Pencil aria-hidden /> Edit
          </Item>
          <Item onSelect={() => actions.onDelete(m)} className="text-danger focus:text-danger">
            <Trash2 aria-hidden /> Delete
          </Item>
        </>
      ) : null}
    </>
  );
}

function MessageItemImpl({
  message: m,
  grouped,
  selfId,
  personOf,
  isOnline,
  editing,
  editInitial,
  composerBase,
  highlighted,
  inThread,
  actions,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const author = m.authorId ? personOf(m.authorId) : undefined;
  const isApp = m.authorKind === "api_key";
  const authorName = isApp ? (m.authorLabel ?? "App") : (author?.name ?? "Former member");
  const own = m.authorId === selfId;
  const deleted = Boolean(m.deletedAt);
  const mentionsMe =
    !!selfId && (m.mentionedUserIds.includes(selfId) || m.body.includes("<!channel>"));
  const interactive = !deleted && !m.pending && !m.failed;
  const reactions = Object.entries(m.reactions);
  const created = new Date(m.createdAt);
  const toolbarPinned = pickerOpen || menuOpen;

  const row: ReactNode = (
    <div
      id={`msg-${m.id}`}
      data-message-id={m.id}
      className={cn(
        "group/message relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 rounded-md px-2 transition-colors duration-(--motion-fade)",
        grouped ? "py-0.5" : "pt-2 pb-0.5",
        // Mentions and the deep-linked message are STATUS accents (R5), not
        // selection, so they compose --primary directly.
        mentionsMe && !deleted ? "bg-primary/8" : "hover:bg-state-hover",
        highlighted && "bg-primary/14",
        editing && "bg-accent/40",
      )}
    >
      {mentionsMe && !deleted ? (
        <span
          className="absolute top-1 bottom-1 left-0 w-0.5 rounded-full bg-primary"
          aria-hidden
        />
      ) : null}

      {/* Gutter: avatar on the first row of a group, the time on hover otherwise. */}
      <div className="flex justify-center">
        {grouped ? (
          <time
            dateTime={m.createdAt}
            title={FULL.format(created)}
            className="pt-0.5 text-2xs text-muted-foreground tabular-nums opacity-0 transition-opacity duration-(--motion-fade) group-hover/message:opacity-100"
          >
            {TIME.format(created)}
          </time>
        ) : isApp ? (
          <span
            className="mt-0.5 grid size-8 place-items-center rounded-avatar border border-border bg-muted"
            title={`${authorName} — an app connected over an API key`}
          >
            <Bot className="size-icon-sm text-muted-foreground" aria-hidden />
          </span>
        ) : (
          <button
            type="button"
            className="mt-0.5 rounded-avatar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => m.authorId && actions.onPersonClick?.(m.authorId)}
            aria-label={authorName}
          >
            <PersonAvatar person={author} online={m.authorId ? isOnline(m.authorId) : undefined} />
          </button>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        {!grouped ? (
          <div className="flex items-baseline gap-2">
            <span className="truncate font-display text-sm font-medium text-foreground">
              {authorName}
            </span>
            {isApp ? (
              <span className="shrink-0 rounded-sm border border-border px-1 font-display text-2xs text-muted-foreground">
                App
              </span>
            ) : null}
            <time
              dateTime={m.createdAt}
              title={FULL.format(created)}
              className="shrink-0 text-2xs text-muted-foreground tabular-nums"
            >
              {TIME.format(created)}
            </time>
            {m.pinnedAt ? (
              <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
                <Pin className="size-icon-xs" aria-hidden /> Pinned
              </span>
            ) : null}
          </div>
        ) : m.pinnedAt ? (
          <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
            <Pin className="size-icon-xs" aria-hidden /> Pinned
          </span>
        ) : null}

        {deleted ? (
          <p className="text-sm text-muted-foreground italic">This message was deleted.</p>
        ) : editing && editInitial ? (
          <div className="py-1">
            <Composer
              {...composerBase}
              placeholder="Edit message"
              initial={editInitial}
              autoFocus
              compact
              onSubmit={(text, picks) => actions.onSaveEdit(m, text, picks)}
              onCancel={actions.onCancelEdit}
            />
          </div>
        ) : (
          <MessageBody
            body={m.body}
            selfId={selfId}
            personOf={personOf}
            onPersonClick={actions.onPersonClick}
            edited={Boolean(m.editedAt)}
            className={cn(m.pending && "opacity-60")}
          />
        )}

        {m.failed ? (
          <div className="flex items-center gap-2 text-xs text-danger">
            <AlertCircle className="size-icon-sm" aria-hidden />
            <span>Not sent.</span>
            <button
              type="button"
              className="font-medium underline-offset-2 hover:underline"
              onClick={() => actions.onRetry(m)}
            >
              Retry
            </button>
            <button
              type="button"
              className="text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => actions.onDelete(m)}
            >
              Discard
            </button>
          </div>
        ) : null}

        {reactions.length > 0 && !deleted ? (
          <div className="flex flex-wrap items-center gap-1 pt-1">
            {reactions.map(([emoji, users]) => (
              <ReactionPill
                key={emoji}
                emoji={emoji}
                users={users}
                selfId={selfId}
                personOf={personOf}
                onToggle={() => actions.onReact(m, emoji)}
              />
            ))}
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Add reaction"
                  className="inline-flex h-6 items-center rounded-full border border-border bg-card px-1.5 text-muted-foreground opacity-0 transition-opacity duration-(--motion-fade) hover:text-foreground focus-visible:opacity-100 group-hover/message:opacity-100"
                >
                  <SmilePlus className="size-icon-sm" aria-hidden />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-2">
                <EmojiPicker
                  onPick={(e) => {
                    setPickerOpen(false);
                    actions.onReact(m, e);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>
        ) : null}

        {!inThread && m.replyCount > 0 && actions.onReply ? (
          <button
            type="button"
            onClick={() => actions.onReply?.(m)}
            className="group/thread mt-1 flex w-fit max-w-full items-center gap-2 rounded-md border border-transparent px-1.5 py-1 text-left transition-colors hover:border-border hover:bg-card"
          >
            <span className="flex -space-x-1.5">
              {m.replyUserIds.slice(0, 3).map((id) => (
                <PersonAvatar
                  key={id}
                  person={personOf(id)}
                  size="sm"
                  className="ring-2 ring-card rounded-avatar"
                />
              ))}
            </span>
            <span className="text-xs font-medium text-foreground">
              {m.replyCount} {m.replyCount === 1 ? "reply" : "replies"}
            </span>
            {m.lastReplyAt ? (
              <span className="truncate text-xs text-muted-foreground">
                Last reply {formatDistanceToNowStrict(new Date(m.lastReplyAt), { addSuffix: true })}
              </span>
            ) : null}
            <span className="text-xs text-muted-foreground opacity-0 transition-opacity duration-(--motion-fade) group-hover/thread:opacity-100">
              View thread
            </span>
          </button>
        ) : null}
      </div>

      {/* Hover toolbar — absolutely placed, fades (no reflow). */}
      {interactive && !editing ? (
        <div
          className={cn(
            "absolute -top-3 right-2 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-0.5 transition-opacity duration-(--motion-fade)",
            toolbarPinned
              ? "opacity-100"
              : "pointer-events-none opacity-0 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 group-hover/message:pointer-events-auto group-hover/message:opacity-100",
          )}
          style={{ boxShadow: "var(--shadow-sm)", zIndex: "var(--z-sticky)" }}
        >
          {QUICK_REACTIONS.slice(0, 3).map((emoji) => (
            <Button
              key={emoji}
              variant="ghost"
              size="icon"
              aria-label={`React with ${emoji}`}
              onClick={() => actions.onReact(m, emoji)}
              style={{ height: "var(--ctrl-h-sm)", width: "var(--ctrl-h-sm)" }}
              className="text-sm"
            >
              {emoji}
            </Button>
          ))}
          <Popover open={pickerOpen && reactions.length === 0} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Add reaction"
                style={{ height: "var(--ctrl-h-sm)", width: "var(--ctrl-h-sm)" }}
              >
                <SmilePlus aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto p-2">
              <EmojiPicker
                onPick={(e) => {
                  setPickerOpen(false);
                  actions.onReact(m, e);
                }}
              />
            </PopoverContent>
          </Popover>
          {!inThread && actions.onReply ? (
            <IconButton
              icon={MessageSquareText}
              label="Reply in thread"
              onClick={() => actions.onReply?.(m)}
            />
          ) : null}
          {own ? (
            <IconButton icon={Pencil} label="Edit" onClick={() => actions.onStartEdit(m)} />
          ) : null}
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="More actions"
                style={{ height: "var(--ctrl-h-sm)", width: "var(--ctrl-h-sm)" }}
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <MenuItems
                m={m}
                own={own}
                inThread={inThread}
                actions={actions}
                Item={DropdownMenuItem}
                Separator={DropdownMenuSeparator}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
  );

  if (!interactive || editing) return row;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <div className="flex items-center gap-0.5 px-1 pb-1">
          {QUICK_REACTIONS.map((emoji) => (
            <ContextMenuItem
              key={emoji}
              onSelect={() => actions.onReact(m, emoji)}
              className="justify-center px-1.5 text-base"
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </ContextMenuItem>
          ))}
        </div>
        <ContextMenuSeparator />
        <MenuItems
          m={m}
          own={own}
          inThread={inThread}
          actions={actions}
          Item={ContextMenuItem}
          Separator={ContextMenuSeparator}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export const MessageItem = memo(MessageItemImpl);
