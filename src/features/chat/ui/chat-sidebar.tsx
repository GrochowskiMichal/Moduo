// The conversation rail (specs/chat.md §Sidebar): Starred · Channels · Direct
// messages. Unread reads as weight (font-medium + foreground), mentions as a
// count pill — never color alone, never red. Muted rows dim.

import { BellOff, ChevronRight, Compass, Hash, Lock, PenSquare, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import type { ChatChannel, ChatPerson } from "../model";
import { dmOtherIds, type SidebarEntry, type SidebarSections } from "../timeline";
import { PersonAvatar, PresenceDot } from "./person-avatar";

type Props = {
  sections: SidebarSections;
  activeChannelId: string | null;
  selfId: string;
  titleOf: (c: ChatChannel) => string;
  personOf: (id: string) => ChatPerson | undefined;
  isOnline: (id: string) => boolean;
  onSelect: (channelId: string) => void;
  onNewChannel: () => void;
  onNewMessage: () => void;
  onBrowse: () => void;
  onSwitcher: () => void;
};

function ChannelGlyph({
  entry,
  selfId,
  personOf,
  isOnline,
}: {
  entry: SidebarEntry;
  selfId: string;
  personOf: (id: string) => ChatPerson | undefined;
  isOnline: (id: string) => boolean;
}) {
  const c = entry.channel;
  if (c.kind === "channel") {
    const Icon = c.isPrivate ? Lock : Hash;
    return <Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />;
  }
  const others = dmOtherIds(c, selfId);
  if (others.length <= 1) {
    const id = others[0] ?? selfId;
    return <PersonAvatar person={personOf(id)} size="sm" online={isOnline(id)} className="-my-1" />;
  }
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-avatar bg-muted font-display text-2xs text-muted-foreground tabular-nums">
      {others.length + 1}
    </span>
  );
}

function Row({
  entry,
  active,
  title,
  onSelect,
  glyph,
  onlineHint,
}: {
  entry: SidebarEntry;
  active: boolean;
  title: string;
  onSelect: () => void;
  glyph: React.ReactNode;
  onlineHint?: boolean;
}) {
  const unread = entry.unread > 0 && !entry.muted;
  const showCount = entry.channel.kind === "dm" ? entry.unread : entry.mentions;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex min-h-(--row-h) w-full items-center gap-2 rounded-md px-2 text-left transition-colors duration-(--motion-fade)",
        // The open channel is the page you are on: the neutral current step
        // (R5 keeps the accent for selected items in lists).
        active ? "bg-state-active" : "hover:bg-state-hover",
        entry.muted && !active && "opacity-60",
      )}
    >
      {glyph}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          unread || active
            ? "font-medium text-foreground"
            : "text-muted-foreground group-hover:text-foreground",
        )}
      >
        {title}
        {onlineHint !== undefined ? (
          <span className="sr-only">{onlineHint ? ", online" : ", away"}</span>
        ) : null}
      </span>
      {entry.muted ? (
        <BellOff className="size-icon-xs shrink-0 text-muted-foreground" aria-label="Muted" />
      ) : null}
      {showCount > 0 && !entry.muted ? (
        <span className="min-w-5 shrink-0 rounded-full bg-foreground px-1.5 text-center font-display text-2xs font-medium text-background tabular-nums">
          {showCount > 99 ? "99+" : showCount}
          <span className="sr-only">{entry.channel.kind === "dm" ? " unread" : " mentions"}</span>
        </span>
      ) : unread ? (
        <span className="size-1.5 shrink-0 rounded-full bg-foreground" aria-label="Unread" />
      ) : null}
    </button>
  );
}

function Section({
  label,
  entries,
  action,
  children,
}: {
  label: string;
  entries: SidebarEntry[];
  action?: React.ReactNode;
  children: (entry: SidebarEntry) => React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const hiddenUnread = !open && entries.some((e) => e.unread > 0 && !e.muted);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="group/section flex items-center gap-1 pr-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex flex-1 items-center gap-1 rounded-md px-1 py-1 text-left hover:bg-accent/60"
        >
          <ChevronRight
            className={cn(
              "size-icon-xs text-muted-foreground transition-transform duration-(--motion-fast)",
              open && "rotate-90",
            )}
            aria-hidden
          />
          <Eyebrow as="span">{label}</Eyebrow>
          {hiddenUnread ? (
            <span className="ml-1 size-1.5 rounded-full bg-foreground" aria-label="Unread inside" />
          ) : null}
        </button>
        {action ? (
          <span className="opacity-0 transition-opacity duration-(--motion-fade) group-hover/section:opacity-100 focus-within:opacity-100">
            {action}
          </span>
        ) : null}
      </div>
      {open ? entries.map(children) : null}
    </div>
  );
}

export function ChatSidebar({
  sections,
  activeChannelId,
  selfId,
  titleOf,
  personOf,
  isOnline,
  onSelect,
  onNewChannel,
  onNewMessage,
  onBrowse,
  onSwitcher,
}: Props) {
  const renderEntry = (entry: SidebarEntry) => {
    const c = entry.channel;
    const others = c.kind === "dm" ? dmOtherIds(c, selfId) : [];
    return (
      <Row
        key={c.id}
        entry={entry}
        active={c.id === activeChannelId}
        title={titleOf(c)}
        onSelect={() => onSelect(c.id)}
        glyph={
          <ChannelGlyph entry={entry} selfId={selfId} personOf={personOf} isOnline={isOnline} />
        }
        onlineHint={others.length === 1 ? isOnline(others[0] as string) : undefined}
      />
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onSwitcher}
          className="flex h-(--ctrl-h) min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <Search className="size-icon-sm shrink-0" aria-hidden />
          <span className="flex-1 truncate">Jump to…</span>
          <Kbd>⌘J</Kbd>
        </button>
        <IconButton icon={PenSquare} label="New message" size="md" onClick={onNewMessage} />
      </div>

      <div className="pane-scroll scrollbar-thin -mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1">
        {sections.starred.length > 0 ? (
          <Section label="Starred" entries={sections.starred}>
            {renderEntry}
          </Section>
        ) : null}

        <Section
          label="Channels"
          entries={sections.channels}
          action={<IconButton icon={Plus} label="New channel" onClick={onNewChannel} />}
        >
          {renderEntry}
        </Section>
        <button
          type="button"
          onClick={onBrowse}
          className="-mt-2.5 flex min-h-(--row-h) items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Compass className="size-icon-sm" aria-hidden />
          Browse channels
        </button>

        <Section
          label="Direct messages"
          entries={sections.dms}
          action={<IconButton icon={Plus} label="New message" onClick={onNewMessage} />}
        >
          {renderEntry}
        </Section>
        {sections.dms.length === 0 ? (
          <button
            type="button"
            onClick={onNewMessage}
            className="-mt-2.5 flex min-h-(--row-h) items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PresenceDot online className="mx-1" />
            Message a teammate
          </button>
        ) : null}
      </div>
    </div>
  );
}
