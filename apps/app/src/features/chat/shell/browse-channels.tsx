// Browse channels (spec §12, prototype round 5 frame 3, "Browse channels"):
// a centre surface, as the frame draws it. Public channels by name, each with
// its topic, how many people are in it and Join (or Open when you're in it),
// then Archived (read only, Open). The toolbar has a filter and "New channel".

import { MessageCircle, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { ChatChannel, ChatMember, ChatRuntime } from "../model";
import { browseChannels, type BrowseRow } from "../panel/details-model";

export type BrowseChannelsProps = {
  chat: ChatRuntime | null;
  channels: Readonly<Record<string, ChatChannel>>;
  mine: Readonly<Record<string, ChatMember>>;
  /** You may join (a paused plan still reads, but can't join). */
  canJoin: boolean;
  /** "New channel" (absent: your role can't create one). */
  onNewChannel?: () => void;
  onOpen: (channelId: string) => void;
  onJoin: (channelId: string) => Promise<void>;
};

export function BrowseChannels({
  chat,
  channels,
  mine,
  canJoin,
  onNewChannel,
  onOpen,
  onJoin,
}: BrowseChannelsProps) {
  const { open, archived } = useMemo(() => browseChannels(channels, mine), [channels, mine]);
  const [filtering, setFiltering] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // How many people are in each (one read for all of them).
  const ids = useMemo(() => [...open, ...archived].map((r) => r.channel.id), [open, archived]);
  const idsKey = ids.join(",");
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!chat || ids.length === 0) return;
    let live = true;
    void chat
      .memberCounts(ids)
      .then((c) => live && setCounts(c))
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `idsKey` stands for `ids`
  }, [chat, idsKey]);

  const q = query.trim().toLowerCase();
  const match = (r: BrowseRow) =>
    !q ||
    (r.channel.name ?? "").toLowerCase().includes(q) ||
    r.channel.topic.toLowerCase().includes(q);
  const shownOpen = open.filter(match);
  const shownArchived = archived.filter(match);

  const row = (r: BrowseRow, isArchived: boolean) => {
    const n = counts[r.channel.id];
    const facts = [
      r.channel.topic.trim() || null,
      typeof n === "number" ? (n === 1 ? "1 person" : `${n} people`) : null,
      r.joined ? "you're in" : null,
      isArchived && r.channel.archivedAt ? "read only" : null,
    ].filter(Boolean);
    const join = !r.joined && !isArchived && canJoin;
    return (
      <li
        key={r.channel.id}
        data-browse-channel={r.channel.id}
        className="flex min-w-0 items-center gap-3 rounded-md px-3 py-2 hover:bg-state-hover"
      >
        <MessageCircle className="size-icon shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-md font-medium",
              isArchived ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {r.channel.name}
          </p>
          {facts.length > 0 ? (
            <p className="truncate text-xs text-muted-foreground">{facts.join(" · ")}</p>
          ) : null}
        </div>
        {join ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy === r.channel.id}
            aria-label={`Join ${r.channel.name ?? "channel"}`}
            onClick={() => {
              setBusy(r.channel.id);
              void onJoin(r.channel.id).finally(() => setBusy(null));
            }}
          >
            Join
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Open ${r.channel.name ?? "channel"}`}
            onClick={() => onOpen(r.channel.id)}
          >
            Open
          </Button>
        )}
      </li>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="browse-channels">
      <header className="flex shrink-0 items-center gap-1 pt-3 pr-3 pb-2 pl-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="truncate font-display text-lg font-semibold text-foreground">
            Browse channels
          </h1>
          <span className="text-sm text-subtle-foreground tabular-nums">{open.length}</span>
        </div>
        {filtering ? (
          <Input
            autoFocus
            size="sm"
            aria-label="Find a channel"
            placeholder="Find a channel"
            className="w-56"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setQuery("");
                setFiltering(false);
              }
            }}
          />
        ) : null}
        <IconButton
          icon={filtering ? X : Search}
          label={filtering ? "Close the filter" : "Find a channel"}
          onClick={() => {
            setFiltering((v) => !v);
            setQuery("");
          }}
        />
        {onNewChannel ? (
          <Button size="sm" onClick={onNewChannel}>
            New channel
          </Button>
        ) : null}
      </header>
      <div className="pane-scroll min-h-0 flex-1 overflow-auto px-3 pb-4">
        {shownOpen.length === 0 && shownArchived.length === 0 ? (
          <p className="px-3 py-2 text-sm text-subtle-foreground">
            {q ? "No channel matches." : "No public channels yet."}
          </p>
        ) : null}
        <ul className="flex flex-col gap-px" aria-label="Public channels">
          {shownOpen.map((r) => row(r, false))}
        </ul>
        {shownArchived.length > 0 ? (
          <>
            <h2 className="px-3 pt-4 pb-1 text-sm font-medium text-muted-foreground">Archived</h2>
            <ul className="flex flex-col gap-px" aria-label="Archived channels">
              {shownArchived.map((r) => row(r, true))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
