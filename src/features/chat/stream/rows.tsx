// The stream's rows (CH29–CH29f, round 5 frames 5–6): the message row, the
// centred day separator, the "New" pill, the event line (§18: one renderer
// for every event type) and "Deleted message". Slack-calm: flat rows, a
// see-through fill on hover; a 32 / 28 / 24 px avatar (`--avatar-feed`); the
// name at the body size but heavier, the time small and grey; 24 / 20 / 16 px
// before a new person (`--feed-person-gap` + the line's 3 px), 6 px between
// one person's lines; one left edge for text, reactions and the reply line.

import {
  AlertCircle,
  ArrowRightLeft,
  Check,
  ChevronRight,
  Clock,
  CornerDownRight,
  Flag,
  MessageSquare,
} from "lucide-react";
import type { ReactNode } from "react";
import { PersonAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Reactions } from "@/components/ui/reactions";
import { Reference } from "@/features/spine/references/ui/reference";
import { formatPastDay, formatStamp, formatTime } from "@/lib/time-format";
import { cn } from "@/lib/utils";
import { groupMessageReactions, reactedBy, reactionName } from "../../spine/reactions";
import { excerptOf } from "../chains";
import { customGlyph, useCustomEmoji } from "../emoji/context";
import type { ChatMessage, ChatPerson } from "../model";
import { MadeFromLine } from "./made-from";
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
const messages = (n: number) => (n === 1 ? "a message" : `${n} messages`);

const EVENT_LINES: Record<
  string,
  { icon: typeof ArrowRightLeft; text: (who: string, n: number) => string; refKey: string }
> = {
  // CV-16's two lines: who moved how many, and where to / from (a reference:
  // "Private item" for whoever can't read that conversation).
  moved_out: {
    icon: ArrowRightLeft,
    text: (who, n) => `${who} moved ${messages(n)} to`,
    refKey: "to",
  },
  moved_in: {
    icon: ArrowRightLeft,
    text: (who, n) => `${who} moved ${messages(n)} here from`,
    refKey: "from",
  },
};

/** The conversation a move line names, from its `moduo://chat_channel/<id>`. */
export function eventConversationId(event: ChatMessage["event"], key: string): string | null {
  const ref = event?.[key];
  if (typeof ref !== "string") return null;
  const m = /^moduo:\/\/chat_channel\/([0-9a-f-]{36})$/i.exec(ref);
  return m?.[1] ?? null;
}

/** The words of an event line, without its reference (also its accessible name). */
export function eventLineText(message: ChatMessage, actor: string): string | null {
  const type = typeof message.event?.type === "string" ? message.event.type : "";
  const line = EVENT_LINES[type];
  if (!line) return null;
  const count = message.event?.count;
  const ids = message.event?.ids;
  const n = typeof count === "number" ? count : Array.isArray(ids) ? ids.length : 1;
  return line.text(actor, n);
}

export function EventLine({ message, actor }: { message: ChatMessage; actor?: string }) {
  const type = typeof message.event?.type === "string" ? message.event.type : "";
  const line = EVENT_LINES[type];
  const Icon = line?.icon ?? Clock;
  const text = eventLineText(message, actor ?? "Someone");
  const where = line ? eventConversationId(message.event, line.refKey) : null;
  return (
    <div
      role="note"
      className="flex min-h-(--ctrl-h-xs) items-center gap-2 py-0.75 pl-[calc(var(--pad-x-sm)*2+var(--avatar-feed))] text-xs text-muted-foreground"
    >
      <Icon aria-hidden className="size-icon-xs shrink-0" />
      <span className="flex min-w-0 items-center gap-1">
        <span>{text ?? "Something changed in this conversation"}</span>
        {where ? <Reference type="chat_channel" id={where} display="chip" /> : null}
      </span>
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
  if (message.sendState === "failed" && message.sendRetry === false) {
    // Nothing left to send (its files all stopped): say why; Delete only.
    return (
      <div className="mt-1 flex items-center gap-2 text-sm text-foreground">
        <AlertCircle aria-hidden className="size-icon-sm text-muted-foreground" />
        <span>Not sent · {message.sendError}</span>
        <Button size="sm" variant="ghost" onClick={onDiscard}>
          Delete
        </Button>
      </div>
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

/** The kit's reaction chips (CV-7c): yours on the active fill, who on hover. */
function MessageReactions({
  message,
  selfId,
  personOf,
  onReact,
}: {
  message: ChatMessage;
  selfId: string | null;
  personOf: (id: string) => ChatPerson | undefined;
  onReact?: (key: string, on: boolean) => void;
}) {
  const groups = groupMessageReactions(
    message.reactions,
    selfId,
    (id) => personOf(id)?.name ?? null,
  );
  const emoji = useCustomEmoji();
  if (groups.length === 0) return null;
  return (
    <Reactions
      className="mt-1.5"
      onToggle={onReact}
      glyph={customGlyph(emoji)}
      items={groups.map((g) => ({
        key: g.key,
        count: g.count,
        mine: g.mine,
        label: reactionName(g.key),
        who: reactedBy(g.people),
      }))}
    />
  );
}

/** A person's first name ("You" for yourself), for the chain lines. */
export function firstName(
  id: string | null,
  selfId: string | null,
  personOf: (id: string) => ChatPerson | undefined,
): string {
  if (!id) return "Someone";
  if (id === selfId) return "You";
  const name = personOf(id)?.name ?? "Former member";
  return name.split(/\s+/)[0] || name;
}

const repliesText = (n: number) => (n === 1 ? "1 reply" : `${n} replies`);

/**
 * Under a chain's root (round 4 frame 4 "stream", round 5 frame 5): up to
 * three faces · "4 replies" · "Alex, Jana, Mike" · ›, and "· Reopened by
 * Mike" after a reopen. A wrapped root says instead (frame 4 "wrapped"):
 * "✓ Wrapped up by Sofia: Jana "Got them…" · 4 replies ›".
 */
export function ChainLine({
  message,
  settled,
  ctx,
  onOpenChain,
}: {
  message: ChatMessage;
  /** The reply that settled it, when the store holds it. */
  settled?: ChatMessage;
  ctx: Pick<BodyContext, "selfId" | "personOf">;
  onOpenChain?: () => void;
}) {
  if (message.replyCount <= 0) return null;
  const name = (id: string | null) => firstName(id, ctx.selfId, ctx.personOf);
  if (message.wrappedAt) {
    const by = message.wrappedBy === ctx.selfId ? "you" : name(message.wrappedBy);
    return (
      <button
        type="button"
        data-slot="chain-wrapped"
        onClick={onOpenChain}
        className="-ml-1 mt-1.5 inline-flex h-(--ctrl-h-sm) max-w-full items-center gap-2 rounded-md border border-hairline px-1.5 text-sm text-muted-foreground hover:bg-state-hover"
      >
        <Check aria-hidden className="size-icon-xs shrink-0" />
        <span className="shrink-0 font-medium text-foreground">
          Wrapped up by {by}
          {settled ? ":" : ""}
        </span>
        {settled ? (
          <span className="min-w-0 truncate">
            {name(settled.authorId)} “{excerptOf(settled, 80)}”
          </span>
        ) : null}
        <span className="shrink-0">· {repliesText(message.replyCount)} ›</span>
      </button>
    );
  }
  const faces = message.replyUserIds.slice(0, 3);
  return (
    <button
      type="button"
      data-slot="chain-replies"
      onClick={onOpenChain}
      className="-ml-1 mt-1.5 inline-flex h-(--ctrl-h-sm) max-w-full items-center gap-2 rounded-md px-1.5 text-sm hover:bg-state-hover"
    >
      {faces.length > 0 ? (
        <span aria-hidden className="flex shrink-0 -space-x-1">
          {faces.map((id) => {
            const p = ctx.personOf(id);
            return (
              <PersonAvatar
                key={id}
                name={p?.name ?? "Former member"}
                id={id}
                src={p?.avatarUrl}
                size="icon"
                className="ring-2 ring-card"
              />
            );
          })}
        </span>
      ) : (
        <MessageSquare aria-hidden className="size-icon-xs text-subtle-foreground" />
      )}
      <span className="shrink-0 font-medium text-foreground">
        {repliesText(message.replyCount)}
      </span>
      {faces.length > 0 ? (
        <span className="min-w-0 truncate text-muted-foreground">
          {faces.map((id) => name(id)).join(", ")}
        </span>
      ) : null}
      {message.reopenedAt && message.reopenedBy ? (
        <span data-slot="chain-reopened" className="shrink-0 text-muted-foreground">
          · Reopened by {message.reopenedBy === ctx.selfId ? "you" : name(message.reopenedBy)}
        </span>
      ) : null}
      <ChevronRight aria-hidden className="size-icon-xs shrink-0 text-subtle-foreground" />
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
  const text = excerptOf(quoted);
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
  /** A reply's quote line: jump to the message it answers. */
  onJumpTo?: (m: ChatMessage) => void;
  onRetry?: (m: ChatMessage) => void;
  onDiscard?: (m: ChatMessage) => void;
  onPersonClick?: (userId: string) => void;
  /** A person's card, previewed on hover over an author's name (CV-8b). */
  personPreview?: (userId: string) => ReactNode;
  /** CV-9: a message's files (previews and chips), under its words. */
  renderFiles?: (m: ChatMessage) => ReactNode;
  /** CV-14: "Unmark" beside a decision's label (the chain panel, which has no ⋯ menu). */
  onUnmarkDecision?: (m: ChatMessage) => void;
};

/** An author's name: opens their card on click, previews it on hover (CV-8b). */
function AuthorName({
  name,
  userId,
  handlers,
}: {
  name: string;
  userId: string | null;
  handlers: RowHandlers;
}) {
  const className = "truncate text-md font-semibold text-foreground";
  if (!userId || !handlers.onPersonClick) {
    return (
      <span data-slot="message-author" className={className}>
        {name}
      </span>
    );
  }
  const button = (
    <button
      type="button"
      data-slot="message-author"
      tabIndex={-1}
      onClick={() => handlers.onPersonClick?.(userId)}
      className={cn(className, "min-w-0 rounded-sm text-left outline-none hover:underline")}
    >
      {name}
    </button>
  );
  if (!handlers.personPreview) return button;
  return (
    <HoverCard>
      <HoverCardTrigger asChild>{button}</HoverCardTrigger>
      <HoverCardContent className="w-auto">{handlers.personPreview(userId)}</HoverCardContent>
    </HoverCard>
  );
}

export function MessageRow({
  message,
  first,
  person,
  quoted,
  quotedName,
  settled,
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
  onClick,
  picked = false,
  hideChainLine = false,
}: {
  message: ChatMessage;
  first: boolean;
  person: ChatPerson | undefined;
  quoted?: ChatMessage;
  quotedName?: string;
  /** A wrapped root's settled reply, when held. */
  settled?: ChatMessage;
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
  /** A click on the row (⌘-click picks it for the mode row, CV-16). */
  onClick?: (e: React.MouseEvent) => void;
  /** In the multi-select (CV-16): drawn as selected. */
  picked?: boolean;
  /** The chain item draws its root without "N replies ›". */
  hideChainLine?: boolean;
}) {
  const name = authorName(message, person);
  const pending = message.sendState === "sending" || message.sendState === "waiting";
  return (
    <div className={first ? "pt-(--feed-person-gap)" : undefined}>
      {/* biome-ignore lint/a11y/useSemanticElements: the feed pattern's rows are articles */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: ⌘-click picks a row; the feed's ⇧↑↓ and ⌘A are its keys */}
      <div
        role="article"
        id={domId}
        aria-posinset={position}
        aria-setsize={setSize}
        aria-label={`${name}, ${formatTime(message.createdAt)}`}
        data-message-id={message.id}
        data-selected={selected || picked ? "" : undefined}
        data-picked={picked ? "" : undefined}
        data-target={target ? "" : undefined}
        onPointerEnter={onPointerEnter}
        onContextMenu={onContextMenu}
        onClick={onClick}
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
              <AuthorName
                name={name}
                userId={message.authorKind === "api_key" ? null : message.authorId}
                handlers={handlers}
              />
              {message.authorKind === "api_key" ? (
                <span className="text-xs text-muted-foreground">app</span>
              ) : null}
              {/* Someone who left keeps their name, with a quiet label (AC6.5). */}
              {message.authorKind !== "api_key" && person?.former ? (
                <span data-slot="former-member" className="text-xs text-muted-foreground">
                  former member
                </span>
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
              onClick={() => handlers.onJumpTo?.(quoted)}
            />
          ) : null}
          {editor ?? (
            <MessageBody
              message={message}
              ctx={ctx}
              className={pending ? "opacity-60" : undefined}
            />
          )}
          {(message.fileCount ?? 0) > 0 ? handlers.renderFiles?.(message) : null}
          <SendState
            message={message}
            onRetry={() => handlers.onRetry?.(message)}
            onDiscard={() => handlers.onDiscard?.(message)}
          />
          <MessageReactions
            message={message}
            selfId={ctx.selfId}
            personOf={ctx.personOf}
            onReact={(key, on) => handlers.onReact?.(message, key, on)}
          />
          {hideChainLine ? null : (
            <ChainLine
              message={message}
              settled={settled}
              ctx={ctx}
              onOpenChain={() => handlers.onOpenChain?.(message)}
            />
          )}
          {message.decisionAt && !editor ? (
            <DecisionLabel
              onUnmark={
                handlers.onUnmarkDecision && !message.sendState && !message.deletedAt
                  ? () => handlers.onUnmarkDecision?.(message)
                  : undefined
              }
            />
          ) : null}
          {editor ? null : <MadeFromLine messageId={message.id} />}
        </div>
        {toolbar}
      </div>
    </div>
  );
}

/**
 * The quiet "Decision" label under a message marked as one (CV-14, §8); with
 * `onUnmark`, a quiet "Unmark" beside it (where the row has no ⋯ menu).
 */
export function DecisionLabel({ onUnmark }: { onUnmark?: () => void }) {
  return (
    <div
      data-slot="message-decision"
      className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Flag className="size-icon-xs shrink-0" aria-hidden />
      Decision
      {onUnmark ? (
        <>
          <span aria-hidden>·</span>
          <button
            type="button"
            data-slot="message-decision-unmark"
            aria-label="Unmark decision"
            className="rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onUnmark}
          >
            Unmark
          </button>
        </>
      ) : null}
    </div>
  );
}

/** A deleted message that still has replies: its place in the conversation stays. */
export function DeletedRow({
  message,
  settled,
  ctx,
  onOpenChain,
}: {
  message: ChatMessage;
  settled?: ChatMessage;
  ctx: Pick<BodyContext, "selfId" | "personOf">;
  onOpenChain?: (m: ChatMessage) => void;
}) {
  return (
    <div className="pt-(--feed-person-gap)">
      <div className="grid grid-cols-[var(--avatar-feed)_minmax(0,1fr)] gap-x-(--pad-x-sm) px-(--pad-x-sm) py-0.75">
        <span aria-hidden />
        <div className="min-w-0">
          <p className="text-md leading-normal text-muted-foreground italic">Deleted message</p>
          <ChainLine
            message={message}
            settled={settled}
            ctx={ctx}
            onOpenChain={() => onOpenChain?.(message)}
          />
        </div>
      </div>
    </div>
  );
}
