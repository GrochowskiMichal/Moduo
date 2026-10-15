// The stream's rows (CH29–CH29f, round 5 frames 5–6): the message row, the
// centred day separator, the "New" pill, the event line (§18: one renderer
// for every event type) and "Deleted message". Slack-calm: flat rows, a
// see-through fill on hover; a 32 / 28 / 24 px avatar (`--avatar-feed`); the
// name at the body size but heavier, the time small and grey; 24 / 20 / 16 px
// before a new person (`--feed-person-gap` + the line's 3 px), 6 px between
// one person's lines; one left edge for text, reactions and the reply line.

import { AlertCircle, ArrowRightLeft, Clock, CornerDownRight, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";
import { PersonAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ChipButton } from "@/components/ui/chip";
import { formatPastDay, formatStamp, formatTime } from "@/lib/time-format";
import { cn } from "@/lib/utils";
import { messageTree, toBodyText } from "../markup-v2";
import type { ChatMessage, ChatPerson } from "../model";
import { type BodyContext, MessageBody } from "./message-body";

export function authorName(m: ChatMessage, person: ChatPerson | undefined): string {
  if (m.authorKind === "api_key") return m.authorLabel ?? "An app";
  return person?.name ?? "Former member";
}

/** A centred day separator on a hairline: Today · Yesterday · Mon · Oct 9 · Oct 9, 2025. */
export function DaySeparator({ at }: { at: string }) {
  return (
    <div className="pt-3.5">
      {/* biome-ignore lint/a11y/useSemanticElements: a separator that names its day can't be an <hr> */}
      <div
        role="separator"
        aria-label={formatPastDay(at)}
        className="flex h-(--row-h-sm) items-center gap-2.5 bg-card px-3 text-xs font-medium text-muted-foreground before:h-px before:flex-1 before:bg-hairline after:h-px after:flex-1 after:bg-hairline"
      >
        <span aria-hidden>{formatPastDay(at)}</span>
      </div>
    </div>
  );
}

/** "New" since you last looked: a small pill centred on a hairline at the read mark (CH29d). */
export function NewPill() {
  return (
    // biome-ignore lint/a11y/useSemanticElements: the pill is drawn inside the separator
    <div
      role="separator"
      aria-label="New messages"
      className="mx-3 mt-3 mb-1.5 flex h-4.5 items-center gap-2.5 before:h-px before:flex-1 before:bg-hairline after:h-px after:flex-1 after:bg-hairline"
    >
      <span className="inline-flex h-4.5 items-center rounded-full bg-primary px-2 text-2xs font-semibold text-primary-foreground">
        New
      </span>
    </div>
  );
}

/**
 * Every `kind = 'event'` row draws here (§18): a quiet line with an icon and
 * words per type. Moves are CV-16's; a call's line (Calls) is a new entry in
 * this table, never a new row design.
 */
const EVENT_LINES: Record<string, { icon: typeof ArrowRightLeft; text: (n: number) => string }> = {
  moved_out: {
    icon: ArrowRightLeft,
    text: (n) => (n === 1 ? "A message was moved out" : `${n} messages were moved out`),
  },
  moved_in: {
    icon: ArrowRightLeft,
    text: (n) => (n === 1 ? "A message was moved here" : `${n} messages were moved here`),
  },
};

export function EventLine({ message }: { message: ChatMessage }) {
  const type = typeof message.event?.type === "string" ? message.event.type : "";
  const ids = message.event?.message_ids;
  const n = Array.isArray(ids) ? ids.length : 1;
  const line = EVENT_LINES[type];
  const Icon = line?.icon ?? Clock;
  return (
    <div
      role="note"
      className="flex min-h-(--ctrl-h-xs) items-center gap-2 py-0.75 pl-[calc(var(--pad-x-sm)*2+var(--avatar-feed))] text-xs text-muted-foreground"
    >
      <Icon aria-hidden className="size-icon-xs shrink-0" />
      <span>{line ? line.text(n) : "Something changed in this conversation"}</span>
      <time className="text-subtle-foreground tabular-nums" dateTime={message.createdAt}>
        · {formatTime(message.createdAt)}
      </time>
    </div>
  );
}

function SendState({
  message,
  onRetry,
  onDiscard,
}: {
  message: ChatMessage;
  onRetry?: () => void;
  onDiscard?: () => void;
}) {
  if (message.sendState === "waiting") {
    return (
      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock aria-hidden className="size-icon-xs" />
        Waiting to send
      </p>
    );
  }
  if (message.sendState === "failed") {
    return (
      <div className="mt-1 flex items-center gap-2 text-sm text-foreground">
        <AlertCircle aria-hidden className="size-icon-sm text-muted-foreground" />
        <span title={message.sendError}>Not sent</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
        <Button size="sm" variant="ghost" onClick={onDiscard}>
          Delete
        </Button>
      </div>
    );
  }
  return null;
}

function Reactions({
  message,
  selfId,
  onReact,
}: {
  message: ChatMessage;
  selfId: string | null;
  onReact?: (key: string, on: boolean) => void;
}) {
  const entries = Object.entries(message.reactions).filter(([, ids]) => ids.length > 0);
  if (entries.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {entries.map(([key, ids]) => {
        const mine = !!selfId && ids.includes(selfId);
        return (
          <ChipButton
            key={key}
            size="xs"
            shape="full"
            active={mine}
            aria-pressed={mine}
            aria-label={`${key} ${ids.length}`}
            onClick={() => onReact?.(key, !mine)}
          >
            <span className="text-base leading-none">{key}</span>
            <span className="tabular-nums text-muted-foreground">{ids.length}</span>
          </ChipButton>
        );
      })}
    </div>
  );
}

function RepliesLine({ message, onOpenChain }: { message: ChatMessage; onOpenChain?: () => void }) {
  if (message.replyCount <= 0) return null;
  return (
    <button
      type="button"
      onClick={onOpenChain}
      className="-ml-1 mt-1.5 inline-flex h-(--ctrl-h-sm) items-center gap-2 rounded-md px-1.5 text-sm hover:bg-state-hover"
    >
      <MessageSquare aria-hidden className="size-icon-xs text-subtle-foreground" />
      <span className="font-medium text-foreground">
        {message.replyCount === 1 ? "1 reply" : `${message.replyCount} replies`}
      </span>
      {message.lastReplyAt ? (
        <span className="text-muted-foreground">{formatStamp(message.lastReplyAt)}</span>
      ) : null}
    </button>
  );
}

function QuoteLine({
  quoted,
  name,
  onClick,
}: {
  quoted: ChatMessage;
  name: string;
  onClick?: () => void;
}) {
  const text = quoted.deletedAt
    ? "Deleted message"
    : toBodyText(messageTree(quoted.id, quoted.updatedAt, quoted.body))
        .replace(/\s+/g, " ")
        .slice(0, 140);
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-0.5 flex h-5 max-w-full items-center gap-1.5 overflow-hidden rounded-sm px-1 text-sm text-muted-foreground hover:bg-state-hover"
    >
      <CornerDownRight aria-hidden className="size-icon-xs shrink-0 text-subtle-foreground" />
      <span className="shrink-0 font-medium text-foreground">{name}</span>
      <span className="min-w-0 truncate">{text}</span>
    </button>
  );
}

export type RowHandlers = {
  onReact?: (m: ChatMessage, key: string, on: boolean) => void;
  onOpenChain?: (m: ChatMessage) => void;
  onRetry?: (m: ChatMessage) => void;
  onDiscard?: (m: ChatMessage) => void;
  onPersonClick?: (userId: string) => void;
};

export function MessageRow({
  message,
  first,
  person,
  quoted,
  quotedName,
  ctx,
  selected,
  target,
  domId,
  position,
  setSize,
  handlers,
  toolbar,
  editor,
  onPointerEnter,
  onContextMenu,
}: {
  message: ChatMessage;
  first: boolean;
  person: ChatPerson | undefined;
  quoted?: ChatMessage;
  quotedName?: string;
  ctx: BodyContext;
  selected?: boolean;
  target?: boolean;
  /** The row's id (the feed's `aria-activedescendant` names the selected one). */
  domId?: string;
  /** Its place among the drawn messages, and how many there are (-1: more above). */
  position?: number;
  setSize?: number;
  handlers: RowHandlers;
  /** The hover toolbar, drawn only for the row under the pointer or selected. */
  toolbar?: ReactNode;
  /** Editing in place replaces the body. */
  editor?: ReactNode;
  onPointerEnter?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const name = authorName(message, person);
  const pending = message.sendState === "sending" || message.sendState === "waiting";
  return (
    <div className={first ? "pt-(--feed-person-gap)" : undefined}>
      {/* biome-ignore lint/a11y/useSemanticElements: the feed pattern's rows are articles */}
      <div
        role="article"
        id={domId}
        aria-posinset={position}
        aria-setsize={setSize}
        aria-label={`${name}, ${formatTime(message.createdAt)}`}
        data-message-id={message.id}
        data-selected={selected ? "" : undefined}
        data-target={target ? "" : undefined}
        onPointerEnter={onPointerEnter}
        onContextMenu={onContextMenu}
        className={cn(
          "group/msg relative grid grid-cols-[var(--avatar-feed)_minmax(0,1fr)] gap-x-(--pad-x-sm) rounded-md px-(--pad-x-sm) py-0.75",
          "transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover",
          "data-[selected]:bg-state-selected data-[target]:bg-state-active",
        )}
      >
        {first ? (
          <PersonAvatar
            name={name}
            id={message.authorId ?? message.authorLabel ?? undefined}
            src={person?.avatarUrl}
            size="feed"
            className="mt-0.5"
          />
        ) : (
          <span className="text-right text-md leading-normal" aria-hidden>
            <time
              dateTime={message.createdAt}
              className="align-middle text-2xs whitespace-nowrap text-subtle-foreground tabular-nums opacity-0 transition-opacity duration-(--motion-fade) group-hover/msg:opacity-100 group-data-[selected]/msg:opacity-100"
            >
              {formatTime(message.createdAt)}
            </time>
          </span>
        )}
        <div className="min-w-0">
          {first ? (
            <div className="flex min-w-0 items-baseline gap-2 leading-normal">
              <span
                data-slot="message-author"
                className="truncate text-md font-semibold text-foreground"
              >
                {name}
              </span>
              {message.authorKind === "api_key" ? (
                <span className="text-xs text-muted-foreground">app</span>
              ) : null}
              <time
                dateTime={message.createdAt}
                title={formatStamp(message.createdAt)}
                className="shrink-0 text-xs whitespace-nowrap text-subtle-foreground tabular-nums"
              >
                {formatTime(message.createdAt)}
              </time>
            </div>
          ) : null}
          {quoted && message.replyToId ? (
            <QuoteLine
              quoted={quoted}
              name={quotedName ?? "Someone"}
              onClick={() => handlers.onOpenChain?.(message)}
            />
          ) : null}
          {editor ?? (
            <MessageBody
              message={message}
              ctx={ctx}
              className={pending ? "opacity-60" : undefined}
            />
          )}
          <SendState
            message={message}
            onRetry={() => handlers.onRetry?.(message)}
            onDiscard={() => handlers.onDiscard?.(message)}
          />
          <Reactions
            message={message}
            selfId={ctx.selfId}
            onReact={(key, on) => handlers.onReact?.(message, key, on)}
          />
          <RepliesLine message={message} onOpenChain={() => handlers.onOpenChain?.(message)} />
        </div>
        {toolbar}
      </div>
    </div>
  );
}

/** A deleted message that still has replies: its place in the conversation stays. */
export function DeletedRow({
  message,
  onOpenChain,
}: {
  message: ChatMessage;
  onOpenChain?: (m: ChatMessage) => void;
}) {
  return (
    <div className="pt-(--feed-person-gap)">
      <div className="grid grid-cols-[var(--avatar-feed)_minmax(0,1fr)] gap-x-(--pad-x-sm) px-(--pad-x-sm) py-0.75">
        <span aria-hidden />
        <div className="min-w-0">
          <p className="text-md leading-normal text-muted-foreground italic">Deleted message</p>
          <RepliesLine message={message} onOpenChain={() => onOpenChain?.(message)} />
        </div>
      </div>
    </div>
  );
}
