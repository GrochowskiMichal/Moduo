// Frame 7's pieces around the stream (spec §1, #33): the start of a
// conversation, General's one-line welcome (CH37: gone after the first
// message), the line that replaces the composer, and the offline line.

import { Info, Lock, MessageCircle, WifiOff } from "lucide-react";
import type * as React from "react";

import { PersonAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { ChatChannel, ChatPerson } from "../model";
import { COMPOSER_LINE_COPY, type ComposerLine } from "./composer-state";

/** The welcome in General until its first message (the spec's line, CH37). */
export const WELCOME_COPY = {
  reply: "Reply",
  replyRest: " to keep answers together · ",
  at: "@",
  atRest: " links anything in Moduo",
} as const;

export function ConversationStart({
  channel,
  title,
  people,
  personOf,
  workspaceName,
}: {
  channel: ChatChannel;
  title: string;
  /** A direct message's other people. */
  people: readonly string[];
  personOf: (id: string) => ChatPerson | undefined;
  workspaceName: string | null;
}) {
  const general = channel.kind === "channel" && channel.isDefault;
  const welcome = general && channel.lastMessageAt === null;
  let heading: string;
  let line: React.ReactNode;
  if (channel.kind === "dm") {
    heading = title;
    line =
      people.length > 1
        ? "This conversation is between the people here."
        : "This conversation is just between the two of you.";
  } else if (general) {
    heading = title;
    line = `Everyone in ${workspaceName ?? "this workspace"} is here.`;
  } else {
    heading = `This is the start of ${title}`;
    line = channel.topic || null;
  }
  return (
    <div data-slot="conversation-start" className="flex flex-col gap-2.5 px-1 pt-5 pb-5">
      {channel.kind === "dm" ? (
        <div className="flex -space-x-2">
          {people.slice(0, 4).map((id) => (
            <PersonAvatar
              key={id}
              id={id}
              name={personOf(id)?.name ?? "Former member"}
              src={personOf(id)?.avatarUrl}
              size="lg"
              className="ring-2 ring-card"
            />
          ))}
        </div>
      ) : (
        <span className="grid size-11 place-items-center rounded-lg bg-state-active text-muted-foreground">
          {channel.isPrivate ? (
            <Lock className="size-icon-lg" aria-hidden />
          ) : (
            <MessageCircle className="size-icon-lg" aria-hidden />
          )}
        </span>
      )}
      <h2 className="font-display text-lg font-semibold text-foreground">{heading}</h2>
      {line ? <p className="max-w-prose text-sm text-muted-foreground">{line}</p> : null}
      {welcome ? (
        <p
          data-slot="chat-welcome"
          className="mt-1.5 rounded-lg border border-hairline px-3.5 py-3 text-sm text-muted-foreground"
        >
          <b className="font-medium text-foreground">{WELCOME_COPY.reply}</b>
          {WELCOME_COPY.replyRest}
          <b className="font-medium text-foreground">{WELCOME_COPY.at}</b>
          {WELCOME_COPY.atRest}
        </p>
      ) : null}
    </div>
  );
}

/** One line in the composer's place: never a disabled box (AC1.8). */
export function ComposerLineView({
  line,
  onUnarchive,
  onChoosePlan,
  onReplyPrivately,
  onJoin,
}: {
  line: ComposerLine;
  onUnarchive?: () => void;
  onChoosePlan?: () => void;
  onReplyPrivately?: () => void;
  onJoin?: () => void;
}) {
  let text: React.ReactNode;
  let action: React.ReactNode = null;
  switch (line.kind) {
    case "archived":
      text = (
        <>
          <b className="font-medium text-foreground">{COMPOSER_LINE_COPY.archived}</b>{" "}
          {COMPOSER_LINE_COPY.archivedMore}
        </>
      );
      if (line.canUnarchive && onUnarchive) {
        action = (
          <Button size="sm" variant="ghost" onClick={onUnarchive}>
            Unarchive
          </Button>
        );
      }
      break;
    case "paused":
      text = (
        <>
          {COMPOSER_LINE_COPY.paused}
          {!line.owner ? ` ${COMPOSER_LINE_COPY.pausedBackOn(line.ownerName ?? "The owner")}` : ""}
        </>
      );
      if (line.owner && onChoosePlan) {
        action = (
          <Button size="sm" variant="secondary" onClick={onChoosePlan}>
            Choose a plan
          </Button>
        );
      }
      break;
    case "viewer":
      text = COMPOSER_LINE_COPY.viewer;
      break;
    case "former":
      text = COMPOSER_LINE_COPY.former(line.names);
      break;
    case "announcement":
      text = (
        <>
          {COMPOSER_LINE_COPY.announcement}
          {onReplyPrivately ? (
            <>
              {" · "}
              <button
                type="button"
                onClick={onReplyPrivately}
                className="rounded-sm font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {COMPOSER_LINE_COPY.replyPrivately}
              </button>
            </>
          ) : null}
        </>
      );
      break;
    case "join":
      text = COMPOSER_LINE_COPY.join;
      if (onJoin) {
        action = (
          <Button size="sm" variant="secondary" onClick={onJoin}>
            Join
          </Button>
        );
      }
      break;
  }
  return (
    <div
      data-composer-line={line.kind}
      role="note"
      className="mx-2 mt-1 flex min-h-11 items-center gap-2.5 rounded-lg bg-muted px-3.5 text-sm text-muted-foreground"
    >
      <Info className="size-icon shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{text}</span>
      {action}
    </div>
  );
}

/**
 * The line above the box when the person you're writing to won't be pinged
 * (CV-17, #33; prototype round 5, the DM note): "Jana is on vacation until
 * Oct 20. They won't be notified; your message waits in their Catch up."
 * CV-18 puts the quiet-hours line in the same place.
 */
export function HoldLine({ text }: { text: string }) {
  return (
    <p
      data-slot="chat-hold-line"
      role="status"
      className="mx-2 mb-1.5 flex min-h-(--ctrl-h-sm) items-center rounded-md bg-state-hover px-3 py-1 text-xs text-muted-foreground"
    >
      {text}
    </p>
  );
}

/** Offline: the conversation reads from this device; what you send waits. */
export function OfflineLine() {
  return (
    <p
      data-slot="chat-offline"
      role="status"
      className="flex items-center gap-1.5 px-3 pb-1 text-xs text-muted-foreground"
    >
      <WifiOff className="size-icon-xs" aria-hidden />
      {COMPOSER_LINE_COPY.offline}
    </p>
  );
}
