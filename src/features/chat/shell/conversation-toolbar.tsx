// The conversation's toolbar (spec §3, prototype frames 5–7), in the kit's
// grammar: the glyph · the name · the linked item's chip (CV-13) · the people
// count · [a huddle's slot, §18] · Search · ⋯. An announcement channel says so
// under the name. Nothing here is a call: `huddle` stays empty until calls exist.

import { MoreHorizontal, Search } from "lucide-react";
import type * as React from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Toolbar } from "@/components/ui/toolbar";
import type { PresenceState } from "@/lib/statuses/model";
import type { ChatMember, ChatNotifyLevel, ChatPerson } from "../model";
import { ConversationGlyph } from "./chat-sidebar";
import type { ChatRow } from "./sidebar-model";

export const NOTIFY_LEVEL_COPY: Record<ChatNotifyLevel, string> = {
  all: "Every message",
  mentions: "Mentions and replies",
  none: "Nothing",
};

export type ConversationToolbarProps = {
  row: Pick<ChatRow, "channel" | "people" | "title">;
  member: ChatMember | undefined;
  personOf: (id: string) => ChatPerson | undefined;
  online?: (id: string) => PresenceState;
  /** A direct message's person now (CV-17): their status or "Focusing · until …". */
  statusText?: string;
  /** People in the conversation (null while it loads). */
  peopleCount: number | null;
  /** The linked item's chip with its live state (CV-13). */
  linked?: React.ReactNode;
  /** §18: "Start a huddle", hidden until calls exist. */
  huddle?: React.ReactNode;
  /** You manage this channel: archive and unarchive. */
  canManage: boolean;
  /** The plan is paused: settings that write wait (reading prefs still work). */
  paused?: boolean;
  onSearch?: () => void;
  onPin?: (pinned: boolean) => void;
  onNotify?: (level: ChatNotifyLevel) => void;
  onMarkRead?: () => void;
  onLeave?: () => void;
  onArchive?: (archived: boolean) => void;
};

export function ConversationToolbar({
  row,
  member,
  personOf,
  online,
  statusText,
  peopleCount,
  linked,
  huddle,
  canManage,
  paused = false,
  onSearch,
  onPin,
  onNotify,
  onMarkRead,
  onLeave,
  onArchive,
}: ConversationToolbarProps) {
  const { channel } = row;
  const isChannel = channel.kind === "channel";
  const level = member?.notifyLevel ?? "mentions";
  return (
    <header
      data-slot="conversation-toolbar"
      className="flex shrink-0 items-center gap-1 pt-3 pr-3 pb-2 pl-4"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="flex size-icon shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-icon">
          <ConversationGlyph row={row} personOf={personOf} online={online} />
        </span>
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate font-display text-lg font-semibold text-foreground">
            {row.title}
          </h1>
          {isChannel && channel.managersOnly ? (
            <p className="truncate text-xs text-muted-foreground">
              Announcements · only managers post
            </p>
          ) : statusText ? (
            <p data-slot="person-status" className="truncate text-xs text-muted-foreground">
              {statusText}
            </p>
          ) : null}
        </div>
        {linked}
        {channel.archivedAt ? (
          <span className="inline-flex h-(--ctrl-h-xs) items-center rounded-md border border-hairline px-2 text-xs text-muted-foreground">
            Archived
          </span>
        ) : null}
        {peopleCount !== null && (isChannel || row.people.length > 1) ? (
          <span className="text-sm text-subtle-foreground tabular-nums">
            {peopleCount === 1 ? "1 person" : `${peopleCount} people`}
          </span>
        ) : null}
      </div>
      <Toolbar gap="tight" aria-label="Conversation">
        {huddle ? <span data-slot="huddle">{huddle}</span> : null}
        <IconButton icon={Search} label="Search" onClick={onSearch} />
        {member || (isChannel && canManage && !paused) ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton icon={MoreHorizontal} label="Conversation options" tooltip={null} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {member ? (
                <>
                  <DropdownMenuItem onSelect={() => onPin?.(!member.starred)}>
                    {member.starred ? "Unpin from sidebar" : "Pin to sidebar"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onMarkRead?.()}>Mark as read</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Notify me about</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={level}
                    onValueChange={(v) => onNotify?.(v as ChatNotifyLevel)}
                  >
                    {(Object.keys(NOTIFY_LEVEL_COPY) as ChatNotifyLevel[]).map((key) => (
                      <DropdownMenuRadioItem key={key} value={key}>
                        {NOTIFY_LEVEL_COPY[key]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </>
              ) : null}
              {isChannel && (canManage || member) ? <DropdownMenuSeparator /> : null}
              {isChannel && canManage && !paused && (!channel.isDefault || channel.archivedAt) ? (
                <DropdownMenuItem onSelect={() => onArchive?.(!channel.archivedAt)}>
                  {channel.archivedAt ? "Unarchive channel" : "Archive channel"}
                </DropdownMenuItem>
              ) : null}
              {isChannel && member && !channel.isDefault ? (
                <DropdownMenuItem onSelect={() => onLeave?.()}>Leave channel</DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </Toolbar>
    </header>
  );
}
