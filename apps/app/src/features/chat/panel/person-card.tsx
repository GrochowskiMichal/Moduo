// A person (spec §12, #10): opened in the right panel as an item ("← name")
// from Details' People, a message's author or an @mention, and previewed on
// hover over an author's name. Name, avatar with the presence shape, what
// they're doing now (CV-17: their status, or Focusing with "until" and the
// task when they share it), and "Message" (starts or opens your direct
// message; a viewer can't start one). Prototype round 3, frame 8 ("card").

import { MessageCircle } from "lucide-react";

import { PersonAvatar, PresenceBadge } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  nowLine,
  type PersonNow,
  presenceLabel,
  type PresenceState,
  statusLine,
} from "@/lib/statuses/model";
import { cn } from "@/lib/utils";

import type { ChatPerson } from "../model";

/** An avatar with the presence shape (AC11.1). */
export function PresenceAvatar({
  name,
  id,
  src,
  state,
  size = "icon",
}: {
  name: string;
  id: string;
  src: string | null;
  state: PresenceState;
  size?: "icon" | "lg";
}) {
  return (
    <span className="relative flex shrink-0 items-center justify-center">
      <PersonAvatar name={name} id={id} src={src} size={size} />
      <PresenceBadge state={state} size={size === "lg" ? "lg" : "sm"} />
    </span>
  );
}

export type PersonCardProps = {
  userId: string;
  person: ChatPerson | undefined;
  self: boolean;
  /** The presence shape (offline for a former member). */
  state: PresenceState;
  /** Their "now" in this workspace (chat_now). */
  now?: PersonNow;
  /** Starting a direct message is allowed (not a viewer, not a paused plan). */
  canMessage: boolean;
  onMessage: (userId: string) => void;
  /** The card inside a hover preview: tighter, no heading level. */
  compact?: boolean;
};

export function PersonCard({
  userId,
  person,
  self,
  state,
  now,
  canMessage,
  onMessage,
  compact = false,
}: PersonCardProps) {
  const name = person?.name ?? "Former member";
  const former = !person || person.former === true;
  const Title = compact ? "p" : "h3";
  const shown: PresenceState = former ? "offline" : state;
  const status = former ? "" : statusLine(now?.status ?? null);
  const focusing = !former && !now?.status && now?.focusing ? nowLine(now, shown) : "";
  const first = name.split(/\s+/)[0] ?? name;
  return (
    <div
      data-slot="person-card"
      data-person={userId}
      className={cn("flex flex-col gap-3", compact ? "w-72" : "px-2 pt-1")}
    >
      <div className="flex min-w-0 items-center gap-3">
        <PresenceAvatar
          name={name}
          id={userId}
          src={person?.avatarUrl ?? null}
          state={shown}
          size="lg"
        />
        <div className="min-w-0">
          <Title className="truncate font-display text-base font-medium text-foreground">
            {name}
          </Title>
          <p className="truncate text-xs text-muted-foreground empty:hidden">
            {self ? "You" : former ? "Former member" : presenceLabel(shown) || null}
          </p>
        </div>
      </div>
      {status || focusing ? (
        <div data-slot="person-status" className="flex flex-col gap-2">
          <p className="truncate text-sm text-foreground">{status || focusing}</p>
          {!status && now?.focusTaskTitle ? (
            <p className="flex h-(--ctrl-h-sm) min-w-0 items-center rounded-md bg-state-hover px-2.5 text-sm">
              <span className="truncate">{now.focusTaskTitle}</span>
            </p>
          ) : null}
          {!self && now?.dnd ? (
            <p className="text-xs text-muted-foreground">
              {`${first} won't be notified now; a message waits in their Catch up.`}
            </p>
          ) : null}
        </div>
      ) : null}
      {!self && !former && canMessage ? (
        <Button
          size="sm"
          variant={compact ? "outline" : "default"}
          className="self-start"
          onClick={() => onMessage(userId)}
        >
          <MessageCircle aria-hidden />
          Message
        </Button>
      ) : null}
    </div>
  );
}
