// Chat's Search (spec §13, CV-19): a centre surface like Browse channels
// (round 5 frame 3's header: title, then the tools on the right), opened from
// the bottom bar's Search in Chat, "See all in Chat" in ⌘K and a conversation's
// find bar. The words and the FilterBar (from · in · has a file · date) live in
// the link (`/chat?view=search&q=…`). People come first, found by name through
// the member list; messages come from the server, newest first, each with its
// marked snippet (round 5 frame 2's palette rows: who, where, when). A failed
// read says "Search isn't available", never "No messages match" (AC1.10).

import { MessageCircle } from "lucide-react";
import { useMemo } from "react";

import { PersonAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FilterBar, FilterButton } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { formatPastDay, formatTime } from "@/lib/time-format";
import type { ChatPerson, ChatRuntime, ChatSearchHit } from "../model";
import {
  conditionsFromParams,
  matchPeople,
  paramsFromConditions,
  type SearchParams,
  searchDimensions,
  searchQuery,
} from "./model";
import { Snippet } from "./snippet";
import { useChatSearch } from "./use-chat-search";

export type ChatSearchViewProps = {
  chat: ChatRuntime | null;
  workspaceId: string | null;
  params: SearchParams;
  onParamsChange: (next: SearchParams) => void;
  /** Everyone in the workspace (people, and the "from" filter). */
  people: readonly ChatPerson[];
  /** The conversations you read, by title (the "in" filter). */
  conversations: readonly { id: string; label: string }[];
  personOf: (id: string) => ChatPerson | undefined;
  /** How a hit's conversation reads (a direct message by its people). */
  conversationLabel: (hit: ChatSearchHit) => string;
  onOpenHit: (hit: ChatSearchHit) => void;
  /** Message a person (a direct message with them). */
  onOpenPerson: (userId: string) => void;
  selfId: string;
};

export function ChatSearchView({
  chat,
  workspaceId,
  params,
  onParamsChange,
  people,
  conversations,
  personOf,
  conversationLabel,
  onOpenHit,
  onOpenPerson,
  selfId,
}: ChatSearchViewProps) {
  const q = params.q ?? "";
  const conditions = useMemo(() => conditionsFromParams(params), [params]);
  const dimensions = useMemo(
    () => searchDimensions({ people, conversations }),
    [people, conversations],
  );
  // The date filter's start moves with the clock; it is read when the words or filters change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `params` is the whole input
  const args = useMemo(
    () => (workspaceId ? searchQuery(workspaceId, params, new Date()) : null),
    [workspaceId, JSON.stringify(params)],
  );
  const { state, loadMore, retry } = useChatSearch(chat, args);
  const foundPeople = useMemo(
    () =>
      q.trim()
        ? matchPeople(people, q)
            .filter((p) => p.userId !== selfId)
            .slice(0, 5)
        : [],
    [people, q, selfId],
  );

  const setFilters = (next: Parameters<typeof paramsFromConditions>[0]) =>
    onParamsChange({ ...(q ? { q } : {}), ...paramsFromConditions(next) });

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="chat-search">
      <header className="flex shrink-0 items-center gap-2 pt-3 pr-3 pb-2 pl-4">
        <h1 className="shrink-0 font-display text-lg font-semibold text-foreground">Search</h1>
        <Input
          autoFocus
          size="sm"
          type="search"
          aria-label="Search messages"
          placeholder="Search messages and people"
          className="min-w-0 flex-1"
          value={q}
          maxLength={256}
          onChange={(e) =>
            onParamsChange({
              ...paramsFromConditions(conditions),
              ...(e.target.value ? { q: e.target.value } : {}),
            })
          }
        />
        <FilterButton dimensions={dimensions} value={conditions} onValueChange={setFilters} />
      </header>
      {conditions.length > 0 ? (
        <FilterBar
          className="shrink-0 px-4 pb-2"
          dimensions={dimensions}
          value={conditions}
          onValueChange={setFilters}
        />
      ) : null}
      <div className="pane-scroll min-h-0 flex-1 overflow-auto px-3 pb-4">
        {!q.trim() ? (
          <p className="px-3 py-2 text-sm text-subtle-foreground">
            Search finds messages in the conversations you can read, and people by name.
          </p>
        ) : null}

        {foundPeople.length > 0 ? (
          <section aria-label="People">
            <h2 className="px-3 pt-2 pb-1 text-sm font-medium text-muted-foreground">People</h2>
            <ul className="flex flex-col gap-px">
              {foundPeople.map((p) => (
                <li key={p.userId}>
                  <button
                    type="button"
                    data-search-person={p.userId}
                    className="flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-state-hover"
                    onClick={() => onOpenPerson(p.userId)}
                  >
                    <PersonAvatar name={p.name} id={p.userId} src={p.avatarUrl} />
                    <span className="truncate text-md text-foreground">{p.name}</span>
                    <span className="ml-auto shrink-0 text-xs text-subtle-foreground">Message</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {q.trim() ? (
          <section aria-label="Messages">
            <h2 className="px-3 pt-2 pb-1 text-sm font-medium text-muted-foreground">Messages</h2>
            {state.status === "error" ? (
              <div className="flex items-center gap-3 px-3 py-2" role="alert">
                <p className="text-sm text-muted-foreground">Search isn't available</p>
                <Button size="sm" variant="ghost" onClick={retry}>
                  Try again
                </Button>
              </div>
            ) : state.status === "ready" && state.hits.length === 0 ? (
              <p className="px-3 py-2 text-sm text-subtle-foreground">No messages match.</p>
            ) : state.status === "ready" ? (
              <>
                <ul className="flex flex-col gap-px">
                  {state.hits.map((hit) => (
                    <HitRow
                      key={hit.messageId}
                      hit={hit}
                      author={authorOf(hit, personOf)}
                      avatarUrl={hit.authorId ? personOf(hit.authorId)?.avatarUrl : null}
                      where={conversationLabel(hit)}
                      onOpen={() => onOpenHit(hit)}
                    />
                  ))}
                </ul>
                {state.more ? (
                  <div className="px-3 pt-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={state.loadingMore}
                      onClick={loadMore}
                    >
                      {state.loadingMore ? "Loading…" : "Show older"}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="px-3 py-2 text-sm text-subtle-foreground" role="status">
                Searching…
              </p>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}

export function authorOf(hit: ChatSearchHit, personOf: (id: string) => ChatPerson | undefined) {
  if (hit.authorLabel) return hit.authorLabel;
  return (hit.authorId ? personOf(hit.authorId)?.name : null) ?? "Former member";
}

function HitRow({
  hit,
  author,
  avatarUrl,
  where,
  onOpen,
}: {
  hit: ChatSearchHit;
  author: string;
  avatarUrl?: string | null;
  where: string;
  onOpen: () => void;
}) {
  const day = formatPastDay(hit.createdAt);
  return (
    <li>
      <button
        type="button"
        data-search-hit={hit.messageId}
        className="flex w-full min-w-0 items-start gap-3 rounded-md px-3 py-2 text-left hover:bg-state-hover"
        onClick={onOpen}
      >
        {hit.authorId ? (
          <PersonAvatar name={author} id={hit.authorId} src={avatarUrl} />
        ) : (
          <MessageCircle className="size-icon shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <Snippet text={hit.snippet} className="line-clamp-2 text-md text-foreground" />
          <span className="truncate text-xs text-muted-foreground">
            {author} · {where}
          </span>
        </span>
        <span className="shrink-0 text-xs text-subtle-foreground tabular-nums">
          {day === "Today" ? formatTime(hit.createdAt) : day}
        </span>
      </button>
    </li>
  );
}
