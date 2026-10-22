// A conversation's own Search (round 5 frame 2 "find", CV-19): a bar under the
// toolbar. The words go to the same server search scoped to this conversation;
// ↑ / ↓ (or Enter / Shift+Enter) step through the hits newest first and the
// stream lands on each one (its window loads around it); Esc closes. "See all"
// opens Chat's Search with "in: this conversation". A failed read says
// "Search isn't available".

import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";

import type { ChatRuntime, ChatSearchHit } from "../model";
import { findPosition, stepFind } from "./model";
import { NOTHING_TO_FIND, useChatSearch } from "./use-chat-search";

const NO_HITS: ChatSearchHit[] = [];

export type FindBarProps = {
  chat: ChatRuntime | null;
  workspaceId: string;
  channelId: string;
  onJump: (hit: ChatSearchHit) => void;
  onClose: () => void;
  onSeeAll: (query: string) => void;
};

export function FindBar({ chat, workspaceId, channelId, onJump, onClose, onSeeAll }: FindBarProps) {
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(-1);
  const args = useMemo(
    () => ({ workspaceId, query: q.trim(), channelId }),
    [workspaceId, q, channelId],
  );
  const { state } = useChatSearch(chat, args);
  const hits = state.status === "ready" ? state.hits : NO_HITS;
  const full = state.status === "ready" && state.more;

  // A new answer (not new words: the last answer stays on screen while they
  // debounce): start again from its newest hit.
  // Reset when the answer changes.
  useEffect(() => setIndex(-1), [hits]);
  // The first answer lands on the newest hit.
  useEffect(() => {
    if (index === -1 && hits.length > 0) {
      setIndex(0);
      onJump(hits[0] as ChatSearchHit);
    }
  }, [hits, index, onJump]);

  const step = (direction: "older" | "newer") => {
    const next = stepFind(index, hits.length, direction);
    if (next < 0 || next === index) return;
    setIndex(next);
    onJump(hits[next] as ChatSearchHit);
  };

  const status = !q.trim()
    ? null
    : state.status === "nothing"
      ? NOTHING_TO_FIND
      : state.status === "error"
        ? "Search isn't available"
        : state.status === "ready"
          ? findPosition(index, hits.length, full)
          : "Searching…";

  return (
    <div
      data-slot="find-bar"
      className="mx-3 mb-1.5 flex h-9 shrink-0 items-center gap-2 rounded-md bg-state-hover px-2.5 ring-1 ring-hairline ring-inset"
    >
      <Search className="size-icon shrink-0 text-muted-foreground" aria-hidden />
      <input
        // eslint-disable-next-line jsx-a11y/no-autofocus -- opening the bar is asking to type
        autoFocus
        type="text"
        aria-label="Search in this conversation"
        placeholder="Search in this conversation"
        maxLength={256}
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? "newer" : "older");
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            step("older");
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            step("newer");
          }
        }}
      />
      {status ? (
        <span
          className="shrink-0 text-xs text-subtle-foreground tabular-nums"
          role="status"
          data-find-status
        >
          {status}
        </span>
      ) : null}
      <IconButton
        icon={ChevronUp}
        size="sm"
        label="Older match"
        disabled={hits.length === 0 || index >= hits.length - 1}
        onClick={() => step("older")}
      />
      <IconButton
        icon={ChevronDown}
        size="sm"
        label="Newer match"
        disabled={hits.length === 0 || index <= 0}
        onClick={() => step("newer")}
      />
      {q.trim() ? (
        <button
          type="button"
          className="shrink-0 rounded-sm px-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onSeeAll(q.trim())}
        >
          See all
        </button>
      ) : null}
      <Kbd>Esc</Kbd>
      <IconButton icon={X} size="sm" label="Close search" onClick={onClose} />
    </div>
  );
}
