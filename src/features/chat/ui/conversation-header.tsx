// Conversation header: who/what this is, the topic (inline-editable), and the
// conversation's controls — members, pins, search, star, notifications, more.

import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  BellRing,
  CheckCheck,
  Hash,
  Info,
  Lock,
  LogOut,
  MoreHorizontal,
  Pin,
  Search,
  Star,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import type { ChatChannel, ChatMember, ChatNotifyLevel, ChatPerson } from "../model";
import { dmOtherIds } from "../timeline";
import { PersonAvatar } from "./person-avatar";

type Props = {
  channel: ChatChannel;
  title: string;
  member: ChatMember | undefined;
  selfId: string;
  memberCount: number | null;
  personOf: (id: string) => ChatPerson | undefined;
  isOnline: (id: string) => boolean;
  canManage: boolean;
  panel: "details" | "search" | "thread" | null;
  onTogglePanel: (panel: "details" | "search") => void;
  onTopic: (topic: string) => Promise<void>;
  onStar: (starred: boolean) => void;
  onNotify: (level: ChatNotifyLevel) => void;
  onMarkRead: () => void;
  onLeave: () => void;
  onArchive: (archived: boolean) => void;
  onJoin: () => void;
};

const NOTIFY_COPY: Record<ChatNotifyLevel, { label: string; hint: string }> = {
  all: { label: "Every new message", hint: "Counts every message on the Chat tab" },
  mentions: { label: "Mentions only", hint: "Only @you, @channel and your threads" },
  none: { label: "Mute", hint: "Nothing — still searchable" },
};

export function ConversationHeader({
  channel,
  title,
  member,
  selfId,
  memberCount,
  personOf,
  isOnline,
  canManage,
  panel,
  onTogglePanel,
  onTopic,
  onStar,
  onNotify,
  onMarkRead,
  onLeave,
  onArchive,
  onJoin,
}: Props) {
  const [editingTopic, setEditingTopic] = useState(false);
  const [topic, setTopic] = useState(channel.topic);
  useEffect(() => setTopic(channel.topic), [channel.topic]);

  const isDm = channel.kind === "dm";
  const others = isDm ? dmOtherIds(channel, selfId) : [];
  const single = isDm && others.length === 1 ? others[0] : null;
  const level = member?.notifyLevel ?? "mentions";
  const NotifyIcon = level === "none" ? BellOff : level === "all" ? BellRing : Bell;

  const commitTopic = async () => {
    setEditingTopic(false);
    const next = topic.trim();
    if (next === channel.topic) return;
    try {
      await onTopic(next);
    } catch {
      setTopic(channel.topic);
    }
  };

  return (
    <header className="flex min-h-(--bar-h) items-center gap-3 border-b border-border px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {isDm ? (
          single ? (
            <PersonAvatar person={personOf(single)} online={isOnline(single)} />
          ) : (
            <span className="grid size-8 place-items-center rounded-avatar bg-muted font-display text-xs text-muted-foreground">
              {others.length + 1}
            </span>
          )
        ) : channel.isPrivate ? (
          <Lock className="size-icon text-muted-foreground" aria-hidden />
        ) : (
          <Hash className="size-icon text-muted-foreground" aria-hidden />
        )}
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate font-display text-md font-semibold text-foreground">{title}</h1>
          {isDm ? (
            <p className="truncate text-xs text-muted-foreground">
              {single ? (isOnline(single) ? "Active now" : "Away") : `${others.length + 1} people`}
            </p>
          ) : editingTopic ? (
            <input
              // biome-ignore lint/a11y/noAutofocus: entering edit mode is an explicit click
              autoFocus
              value={topic}
              maxLength={250}
              onChange={(e) => setTopic(e.target.value)}
              onBlur={() => void commitTopic()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitTopic();
                if (e.key === "Escape") {
                  setTopic(channel.topic);
                  setEditingTopic(false);
                }
              }}
              aria-label="Channel topic"
              className="min-w-0 rounded-sm bg-transparent text-xs text-foreground outline-none ring-1 ring-ring"
            />
          ) : (
            <button
              type="button"
              onClick={() => !channel.archivedAt && member && setEditingTopic(true)}
              className={cn(
                "truncate text-left text-xs",
                channel.topic ? "text-muted-foreground" : "text-muted-foreground/60",
                member && !channel.archivedAt && "hover:text-foreground",
              )}
            >
              {channel.topic || (member ? "Add a topic" : "")}
            </button>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {!isDm && memberCount !== null ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onTogglePanel("details")}
            aria-pressed={panel === "details"}
            className={cn("gap-1.5 tabular-nums", panel === "details" && "bg-accent")}
            style={{ height: "var(--ctrl-h-sm)" }}
          >
            {memberCount} {memberCount === 1 ? "member" : "members"}
          </Button>
        ) : null}
        {!member && channel.kind === "channel" && !channel.archivedAt ? (
          <Button size="sm" onClick={onJoin} style={{ height: "var(--ctrl-h-sm)" }}>
            Join channel
          </Button>
        ) : null}
        <IconButton
          icon={Search}
          label="Search messages"
          onClick={() => onTogglePanel("search")}
          className={cn(panel === "search" && "bg-accent")}
        />
        <IconButton
          icon={isDm ? Info : Pin}
          label={isDm ? "Details and pinned" : "Details, pinned and settings"}
          onClick={() => onTogglePanel("details")}
          className={cn(panel === "details" && "bg-accent")}
        />
        {member ? (
          <>
            <IconButton
              icon={Star}
              label={member.starred ? "Unstar" : "Star"}
              onClick={() => onStar(!member.starred)}
              className={cn(member.starred && "[&_svg]:fill-current")}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Notifications: ${NOTIFY_COPY[level].label}`}
                  style={{ height: "var(--ctrl-h-sm)", width: "var(--ctrl-h-sm)" }}
                >
                  <NotifyIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Notify me about</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={level}
                  onValueChange={(v) => onNotify(v as ChatNotifyLevel)}
                >
                  {(Object.keys(NOTIFY_COPY) as ChatNotifyLevel[]).map((key) => (
                    <DropdownMenuRadioItem
                      key={key}
                      value={key}
                      className="flex-col items-start gap-0"
                    >
                      <span>{NOTIFY_COPY[key].label}</span>
                      <span className="text-2xs text-muted-foreground">
                        {NOTIFY_COPY[key].hint}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="More conversation actions"
                  style={{ height: "var(--ctrl-h-sm)", width: "var(--ctrl-h-sm)" }}
                >
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={onMarkRead}>
                  <CheckCheck aria-hidden /> Mark as read
                </DropdownMenuItem>
                {!isDm ? (
                  <>
                    <DropdownMenuSeparator />
                    {canManage ? (
                      <DropdownMenuItem onSelect={() => onArchive(!channel.archivedAt)}>
                        {channel.archivedAt ? (
                          <ArchiveRestore aria-hidden />
                        ) : (
                          <Archive aria-hidden />
                        )}
                        {channel.archivedAt ? "Unarchive channel" : "Archive channel"}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onSelect={onLeave}>
                      <LogOut aria-hidden /> Leave channel
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem onSelect={onLeave}>
                    <LogOut aria-hidden /> Close conversation
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
      </div>
    </header>
  );
}
