// Chat's left panel (spec §2, prototype frame 1), on the kit's NavRow and the
// rail's section header: Catch up (with its count) · hairline (the panel's ⋯:
// Archived channels) · Pinned (only when something is pinned) · Channels
// (alphabetical) · Direct messages (most recent first) · "+ New conversation".
// Sections collapse and are remembered on this device. Unread is weight; a
// number only for what is addressed to you. Each row keeps an empty trailing
// mark beside its count for a live huddle (§18, `huddleOf`).

import { Inbox, Lock, MessageCircle, MoreHorizontal, Plus } from "lucide-react";
import type * as React from "react";
import { useCallback, useState } from "react";

import { PersonAvatar, PresenceBadge } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NavRow, NavSectionHeader } from "@/components/ui/nav-row";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PresenceState } from "@/lib/statuses/model";
import type { ChatPerson } from "../model";
import type { ChatRow, ChatSidebarModel } from "./sidebar-model";

export type ChatSection = "pinned" | "channels" | "dms";

const COLLAPSED_KEY = "moduo.chat.sidebar.collapsed";

function readCollapsed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    const value: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

/** Collapsed sections, remembered on this device. */
export function useCollapsedSections(): [ReadonlySet<string>, (section: ChatSection) => void] {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(readCollapsed);
  const toggle = useCallback((section: ChatSection) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // A full or blocked store: the panel still collapses for now.
      }
      return next;
    });
  }, []);
  return [collapsed, toggle];
}

/** A conversation's glyph: one bubble for every channel, a lock for a private one (AC10.3). */
export function ConversationGlyph({
  row,
  personOf,
  online,
}: {
  row: Pick<ChatRow, "channel" | "people">;
  personOf: (id: string) => ChatPerson | undefined;
  /** The presence shape for a person (CV-17); a group DM shows none. */
  online?: (id: string) => PresenceState;
}) {
  const { channel } = row;
  if (channel.kind === "channel") {
    return channel.isPrivate ? (
      <Lock aria-label="Private" data-glyph="private" />
    ) : (
      <MessageCircle aria-hidden data-glyph="channel" />
    );
  }
  const first = row.people[0];
  const person = first ? personOf(first) : undefined;
  const state: PresenceState =
    first && row.people.length === 1 && online ? online(first) : "offline";
  return (
    <span className="relative flex size-icon items-center justify-center">
      <PersonAvatar
        name={person?.name ?? "Former member"}
        id={first}
        src={person?.avatarUrl}
        size="icon"
      />
      <PresenceBadge state={state} />
    </span>
  );
}

export type ChatSidebarProps = {
  model: ChatSidebarModel;
  activeId: string | null;
  /** Catch up is open (CV-11's view). */
  catchupCurrent?: boolean;
  personOf: (id: string) => ChatPerson | undefined;
  online?: (id: string) => PresenceState;
  collapsed: ReadonlySet<string>;
  onToggleSection: (section: ChatSection) => void;
  onOpen: (channelId: string) => void;
  onOpenCatchup: () => void;
  onNewConversation?: () => void;
  /** Browse channels (CV-8b), from the hairline's ⋯. */
  onBrowse?: () => void;
  /** §18: a live huddle's mark (who's in it) beside a row's count. Empty until calls exist. */
  huddleOf?: (channelId: string) => React.ReactNode;
};

export function ChatSidebar({
  model,
  activeId,
  catchupCurrent = false,
  personOf,
  online,
  collapsed,
  onToggleSection,
  onOpen,
  onOpenCatchup,
  onNewConversation,
  onBrowse,
  huddleOf,
}: ChatSidebarProps) {
  const row = (r: ChatRow) => {
    return (
      <NavRow
        key={r.channel.id}
        navId={r.channel.id}
        data-conversation={r.channel.id}
        label={r.title}
        icon={<ConversationGlyph row={r} personOf={personOf} online={online} />}
        current={r.channel.id === activeId}
        unread={r.unread}
        count={r.count}
        countLabel={`${r.count} for you`}
        indicator={huddleOf?.(r.channel.id) ?? undefined}
        onSelect={() => onOpen(r.channel.id)}
      />
    );
  };

  const section = (key: ChatSection, label: string, rows: ChatRow[]) => (
    <div className="mt-2 flex flex-col gap-px" data-section={key}>
      <NavSectionHeader
        label={label}
        collapsed={collapsed.has(key)}
        onToggle={() => onToggleSection(key)}
      />
      {collapsed.has(key) ? null : rows.map(row)}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="pane-scroll min-h-0 flex-1 overflow-auto">
        <nav aria-label="Conversations" className="flex flex-col gap-px">
          <NavRow
            navId="catchup"
            label="Catch up"
            icon={<Inbox aria-hidden />}
            count={model.catchup}
            countLabel={`${model.catchup} waiting for you`}
            current={catchupCurrent}
            onSelect={onOpenCatchup}
          />
          <PanelHairline
            archived={model.archived}
            personOf={personOf}
            onOpen={onOpen}
            onBrowse={onBrowse}
          />
          {model.pinned.length > 0 ? section("pinned", "Pinned", model.pinned) : null}
          {section("channels", "Channels", model.channels)}
          {section("dms", "Direct messages", model.dms)}
          {onNewConversation ? (
            <NavRow
              navId="new"
              className="mt-2"
              label="New conversation"
              icon={<Plus aria-hidden />}
              onSelect={onNewConversation}
            />
          ) : null}
        </nav>
      </div>
    </div>
  );
}

/** The hairline under Catch up, with the panel's ⋯ (archived channels open from here, never as rows). */
function PanelHairline({
  archived,
  personOf,
  onOpen,
  onBrowse,
}: {
  archived: ChatRow[];
  personOf: (id: string) => ChatPerson | undefined;
  onOpen: (channelId: string) => void;
  onBrowse?: () => void;
}) {
  return (
    <div
      data-slot="sidebar-hairline"
      className="group/hair relative my-1 flex h-3 shrink-0 items-center px-2"
    >
      <span aria-hidden className="h-px flex-1 bg-hairline" />
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Conversations options"
                className="absolute right-1.5 flex size-5 items-center justify-center rounded-sm bg-card text-muted-foreground opacity-0 outline-none transition-opacity duration-(--motion-fade) ease-(--ease-out) group-hover/hair:opacity-100 hover:bg-state-active hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:opacity-100"
              >
                <MoreHorizontal className="size-icon-sm" aria-hidden />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Conversations options</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-52">
          {onBrowse ? (
            <DropdownMenuItem onSelect={onBrowse}>Browse channels</DropdownMenuItem>
          ) : null}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={archived.length === 0}>
              Archived channels
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 min-w-52 overflow-auto">
              <DropdownMenuLabel>Readable and searchable</DropdownMenuLabel>
              {archived.map((r) => (
                <DropdownMenuItem key={r.channel.id} onSelect={() => onOpen(r.channel.id)}>
                  <ConversationGlyph row={r} personOf={personOf} />
                  <span className="min-w-0 truncate">{r.title}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
