// A person (spec §12, #10): opened in the right panel as an item ("← name")
// from Details' People, a message's author or an @mention, and previewed on
// hover over an author's name. Name, avatar, presence and "Message" (starts or
// opens your direct message; a viewer can't start one). The status line is
// CV-17's: its slot is here, empty.

import { MessageCircle } from "lucide-react";

import { PersonAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatPerson } from "../model";

/** An avatar with the online dot (presence shapes are CV-17's). */
export function PresenceAvatar({
  name,
  id,
  src,
  online,
  size = "icon",
}: {
  name: string;
  id: string;
  src: string | null;
  online: boolean;
  size?: "icon" | "lg";
}) {
  return (
    <span className="relative flex shrink-0 items-center justify-center">
      <PersonAvatar name={name} id={id} src={src} size={size} />
      {online ? (
        <span
          data-slot="presence"
          className={cn(
            "absolute -right-0.5 -bottom-0.5 rounded-full bg-success ring-2 ring-card",
            size === "lg" ? "size-2.5" : "size-1.5",
          )}
        />
      ) : null}
    </span>
  );
}

export type PersonCardProps = {
  userId: string;
  person: ChatPerson | undefined;
  self: boolean;
  online: boolean;
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
  online,
  canMessage,
  onMessage,
  compact = false,
}: PersonCardProps) {
  const name = person?.name ?? "Former member";
  const former = !person || person.former === true;
  const Title = compact ? "p" : "h3";
  return (
    <div
      data-slot="person-card"
      data-person={userId}
      className={cn("flex flex-col gap-3", compact ? "w-64" : "px-2 pt-1")}
    >
      <div className="flex min-w-0 items-center gap-3">
        <PresenceAvatar
          name={name}
          id={userId}
          src={person?.avatarUrl ?? null}
          online={online && !former}
          size="lg"
        />
        <div className="min-w-0">
          <Title className="truncate font-display text-base font-medium text-foreground">
            {name}
          </Title>
          <p className="truncate text-xs text-muted-foreground empty:hidden">
            {self ? "You" : former ? "Former member" : online ? "Online" : null}
          </p>
          {/* Status (presets, your saved ones, "clear after"): CV-17. */}
          <p data-slot="person-status" className="empty:hidden" />
        </div>
      </div>
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
