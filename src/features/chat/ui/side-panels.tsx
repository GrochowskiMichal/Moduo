// Right-panel surfaces for Chat: Thread, Details (about · members · pinned)
// and Search. One panel at a time; each has a header with a close button and
// Esc closes it (wired by the page).

import { formatDistanceToNowStrict } from "date-fns";
import { Hash, Loader2, Lock, Pin, Search as SearchIcon, UserPlus, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { cn } from "@/lib/utils";
import { toPlainText } from "../markup";
import type { ChatChannel, ChatMember, ChatMessage, ChatPerson } from "../model";
import { MessageBody } from "./message-body";
import { PersonAvatar } from "./person-avatar";

function PanelHeader({
  title,
  subtitle,
  onClose,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex min-h-(--bar-h) items-center gap-2 border-b border-border px-1 pb-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="truncate font-display text-sm font-semibold text-foreground">{title}</h2>
        {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      <IconButton icon={X} label="Close (Esc)" onClick={onClose} />
    </div>
  );
}

export function ThreadPanel({
  channelLabel,
  loading,
  onClose,
  children,
  composer,
}: {
  channelLabel: string;
  loading: boolean;
  onClose: () => void;
  /** Parent + replies, rendered by the page with the shared MessageItem. */
  children: ReactNode;
  composer: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <PanelHeader title="Thread" subtitle={channelLabel} onClose={onClose} />
      <div className="pane-scroll scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
        {loading ? (
          <div className="flex justify-center py-4 text-muted-foreground">
            <Loader2 className="size-icon-sm animate-spin" aria-label="Loading replies" />
          </div>
        ) : null}
      </div>
      <div className="shrink-0">{composer}</div>
    </div>
  );
}

const CREATED = new Intl.DateTimeFormat(undefined, { dateStyle: "long" });

export function DetailsPanel({
  runtime,
  channel,
  title,
  selfId,
  members,
  personOf,
  isOnline,
  canManage,
  onClose,
  onAddPeople,
  onRemove,
  onOpenDm,
  onJumpTo,
  pinVersion,
}: {
  runtime: ModuoRuntime | null;
  channel: ChatChannel;
  title: string;
  selfId: string;
  members: ChatMember[];
  personOf: (id: string) => ChatPerson | undefined;
  isOnline: (id: string) => boolean;
  canManage: boolean;
  onClose: () => void;
  onAddPeople: () => void;
  onRemove: (userId: string) => void;
  onOpenDm: (userId: string) => void;
  onJumpTo: (m: ChatMessage) => void;
  /** Bumps when a pin changes so the list refetches. */
  pinVersion: number;
}) {
  const [pinned, setPinned] = useState<ChatMessage[] | null>(null);

  useEffect(() => {
    if (!runtime) return;
    let cancelled = false;
    void runtime.chat
      .listPinned(channel.id)
      .then((rows) => !cancelled && setPinned(rows))
      .catch(() => !cancelled && setPinned([]));
    return () => {
      cancelled = true;
    };
  }, [runtime, channel.id, pinVersion]);

  const sortedMembers = useMemo(
    () =>
      [...members].sort((a, b) => {
        const on = Number(isOnline(b.userId)) - Number(isOnline(a.userId));
        if (on) return on;
        return (personOf(a.userId)?.name ?? "").localeCompare(personOf(b.userId)?.name ?? "");
      }),
    [members, isOnline, personOf],
  );
  const creator = channel.createdBy ? personOf(channel.createdBy) : undefined;
  const isDm = channel.kind === "dm";

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <PanelHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            {isDm ? null : channel.isPrivate ? (
              <Lock className="size-icon-sm text-muted-foreground" aria-hidden />
            ) : (
              <Hash className="size-icon-sm text-muted-foreground" aria-hidden />
            )}
            {title}
          </span>
        }
        subtitle={
          isDm ? "Direct message" : channel.isPrivate ? "Private channel" : "Public channel"
        }
        onClose={onClose}
      />
      <div className="pane-scroll scrollbar-thin flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1 pb-2">
        {!isDm ? (
          <section className="flex flex-col gap-1.5">
            <Eyebrow as="h3">About</Eyebrow>
            <p className="text-sm whitespace-pre-wrap text-foreground">
              {channel.topic || <span className="text-muted-foreground">No topic yet.</span>}
            </p>
            <p className="text-xs text-muted-foreground">
              Created {creator ? `by ${creator.name} ` : ""}on{" "}
              {CREATED.format(new Date(channel.createdAt))}
            </p>
            {channel.archivedAt ? (
              <p className="text-xs text-muted-foreground">Archived — read only.</p>
            ) : null}
          </section>
        ) : null}

        <section className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <Eyebrow as="h3">
              {members.length} {members.length === 1 ? "member" : "members"}
            </Eyebrow>
            {!isDm && !channel.archivedAt ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onAddPeople}
                className="gap-1.5"
                style={{ height: "var(--ctrl-h-sm)" }}
              >
                <UserPlus aria-hidden /> Add people
              </Button>
            ) : null}
          </div>
          {sortedMembers.map((m) => {
            const person = personOf(m.userId);
            const self = m.userId === selfId;
            return (
              <div
                key={m.userId}
                className="group flex min-h-(--row-h) items-center gap-2 rounded-md px-1 hover:bg-accent/60"
              >
                <PersonAvatar person={person} size="sm" online={isOnline(m.userId)} />
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-sm text-foreground"
                  onClick={() => !self && onOpenDm(m.userId)}
                  title={self ? undefined : `Message ${person?.name ?? "this person"}`}
                >
                  {person?.name ?? "Former member"}
                  {self ? <span className="text-muted-foreground"> (you)</span> : null}
                </button>
                {!isDm && canManage && !self ? (
                  <button
                    type="button"
                    onClick={() => onRemove(m.userId)}
                    className="text-2xs text-muted-foreground opacity-0 transition-opacity duration-(--motion-fade) group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            );
          })}
        </section>

        <section className="flex flex-col gap-1.5">
          <Eyebrow as="h3">Pinned</Eyebrow>
          {pinned === null ? (
            <Loader2
              className="size-icon-sm animate-spin text-muted-foreground"
              aria-label="Loading pins"
            />
          ) : pinned.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing pinned. Pin a message from its <span className="font-medium">⋯</span> menu to
              keep it here.
            </p>
          ) : (
            pinned.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onJumpTo(m)}
                className="flex flex-col gap-1 rounded-lg border border-border bg-background p-2.5 text-left transition-colors hover:border-foreground/30"
              >
                <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                  <Pin className="size-icon-xs" aria-hidden />
                  {personOf(m.authorId ?? "")?.name ?? "Former member"} ·{" "}
                  {formatDistanceToNowStrict(new Date(m.createdAt), { addSuffix: true })}
                </span>
                <MessageBody
                  body={m.body}
                  selfId={selfId}
                  personOf={personOf}
                  className="line-clamp-4"
                />
              </button>
            ))
          )}
        </section>
      </div>
    </div>
  );
}

function highlight(text: string, q: string): ReactNode {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (!q || i < 0) return text;
  const start = Math.max(0, i - 40);
  return (
    <>
      {start > 0 ? "…" : ""}
      {text.slice(start, i)}
      <mark className="rounded-sm bg-(--selected-bg) text-foreground">
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length, i + q.length + 120)}
    </>
  );
}

export function SearchPanel({
  runtime,
  workspaceId,
  channelsById,
  titleOf,
  personOf,
  onClose,
  onOpen,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  channelsById: Record<string, ChatChannel>;
  titleOf: (c: ChatChannel) => string;
  personOf: (id: string) => ChatPerson | undefined;
  onClose: () => void;
  onOpen: (m: ChatMessage) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChatMessage[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!runtime || q.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      void runtime.chat
        .search({ workspaceId, query: q })
        .then((rows) => !cancelled && setResults(rows))
        .catch(() => !cancelled && setResults([]))
        .finally(() => !cancelled && setLoading(false));
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [runtime, workspaceId, query]);

  const nameOf = (id: string) => personOf(id)?.name ?? "someone";

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <PanelHeader title="Search" subtitle="Every conversation you can see" onClose={onClose} />
      <div className="relative px-1">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-3 size-icon-sm -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          // biome-ignore lint/a11y/noAutofocus: opening search is an explicit action
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search messages"
          aria-label="Search messages"
          className="pl-7"
        />
      </div>
      <div className="pane-scroll scrollbar-thin flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1">
        {loading ? (
          <Loader2
            className="mx-auto my-4 size-icon-sm animate-spin text-muted-foreground"
            aria-label="Searching"
          />
        ) : null}
        {!loading && results?.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No messages match “{query.trim()}”.
          </p>
        ) : null}
        {!loading && results === null ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Type at least two characters.
          </p>
        ) : null}
        {results?.map((m) => {
          const channel = channelsById[m.channelId];
          const plain = toPlainText(m.body, nameOf);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onOpen(m)}
              className={cn(
                "flex flex-col gap-0.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent",
              )}
            >
              <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                <span className="font-medium text-foreground">{nameOf(m.authorId ?? "")}</span>
                {channel ? `in ${channel.kind === "channel" ? "#" : ""}${titleOf(channel)}` : null}
                {m.parentId ? " · thread" : null} ·{" "}
                {formatDistanceToNowStrict(new Date(m.createdAt), { addSuffix: true })}
              </span>
              <span className="line-clamp-3 text-sm text-foreground">
                {highlight(plain, query.trim())}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
