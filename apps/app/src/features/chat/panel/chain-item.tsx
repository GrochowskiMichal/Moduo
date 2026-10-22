// A reply chain as a right-panel item (CV-12, spec §5, round 4 frame 4
// "chain"): "← Reply chain" with Wrap up (or Reopen) on the title row, a
// muted line "Sofia, Alex, Jana · You're following · Stop", the root, a
// "4 replies" divider, the replies in order (the settled one marked), and its
// own box: ⏎ replies to the root, Esc in the empty box goes back. Reading it
// here closes your Catch up items for the chain (`chainRead`), again when new
// replies arrive while it's open.

import { Check, RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { TitleActions } from "@/components/app/title-actions";
import { Button } from "@/components/ui/button";

import type { ChatMessage, ChatPerson, ChatRuntime } from "../model";
import type { ChatChain } from "../store/store";
import type { BodyContext } from "../stream/message-body";
import { authorName, firstName, MessageRow } from "../stream/rows";

export type ChainItemProps = {
  chat: ChatRuntime | null;
  rootId: string;
  chain: ChatChain | undefined;
  selfId: string;
  personOf: (id: string) => ChatPerson | undefined;
  /** Load the chain into the store (idempotent). */
  onLoad: (rootId: string) => void;
  /** Wrap up / Reopen on the title row (absent: you may not). */
  onWrapUp?: () => void;
  onReopen?: () => void;
  onPersonClick?: (userId: string) => void;
  /** Take back a decision in the chain (CV-14; absent: you can't post here). */
  onUnmarkDecision?: (m: ChatMessage) => void;
  /** The chain's own box (absent: you can't post here). */
  renderComposer?: (placeholder: string) => ReactNode;
};

export function ChainItem({
  chat,
  rootId,
  chain,
  selfId,
  personOf,
  onLoad,
  onWrapUp,
  onReopen,
  onPersonClick,
  onUnmarkDecision,
  renderComposer,
}: ChainItemProps) {
  useEffect(() => onLoad(rootId), [onLoad, rootId]);

  const root = chain?.root ?? null;
  const replies = (chain?.replies ?? []).filter((r) => !r.deletedAt || r.replyCount > 0);
  const held = replies.filter((r) => !r.sendState).length;

  // Reading it here closes your Catch up items for it (on open, and as replies arrive).
  useEffect(() => {
    if (!chat || held === 0) return;
    void chat.chainRead(rootId);
  }, [chat, rootId, held]);

  // Following: no mute row means you follow it.
  const [following, setFollowing] = useState<boolean | null>(null);
  useEffect(() => {
    setFollowing(null);
    if (!chat) return;
    let live = true;
    chat
      .chainFollowing(rootId)
      .then((on) => live && setFollowing(on))
      .catch(() => live && setFollowing(true));
    return () => {
      live = false;
    };
  }, [chat, rootId]);
  const follow = (on: boolean) => {
    if (!chat) return;
    setFollowing(on);
    void chat.followChain(rootId, on).then((res) => {
      if (!res.error) return;
      setFollowing(!on);
      toast(res.error.message || "Couldn't change that.");
    });
  };

  const listRef = useRef<HTMLDivElement | null>(null);
  const jumpTo = (m: ChatMessage) => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-message-id="${m.id}"]`);
    // Only the list scrolls (scrollIntoView would move every scrolling ancestor).
    if (list && el) list.scrollTop = Math.max(0, el.offsetTop - list.clientHeight / 3);
  };

  if (!root) {
    return (
      <p className="px-3 text-sm text-subtle-foreground">
        {chain?.loaded ? "That reply chain isn't available." : "Loading…"}
      </p>
    );
  }

  const ctx: BodyContext = { selfId, personOf, onPersonClick };
  const handlers = { onPersonClick, onJumpTo: jumpTo, onUnmarkDecision };
  const people = [root.authorId, ...replies.map((r) => r.authorId)].filter(
    (id, i, all): id is string => !!id && all.indexOf(id) === i,
  );
  const names = people.map((id) => firstName(id, selfId, personOf));
  const byId = new Map(replies.map((r) => [r.id, r]));
  const count = root.replyCount || replies.length;

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="chain-item" data-root={root.id}>
      <TitleActions>
        {root.wrappedAt && onReopen ? (
          <Button variant="secondary" size="sm" onClick={onReopen}>
            <RotateCcw aria-hidden />
            Reopen
          </Button>
        ) : null}
        {!root.wrappedAt && onWrapUp && replies.some((r) => !r.deletedAt && !r.sendState) ? (
          <Button variant="secondary" size="sm" onClick={onWrapUp}>
            <Check aria-hidden />
            Wrap up
          </Button>
        ) : null}
      </TitleActions>
      <p
        data-slot="chain-meta"
        className="flex min-w-0 shrink-0 items-center gap-1.5 px-3 pb-1.5 text-xs text-subtle-foreground"
      >
        <span className="min-w-0 truncate">{names.join(", ")}</span>
        {following === null ? null : following ? (
          <>
            <span className="shrink-0">· You're following ·</span>
            <button
              type="button"
              className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground hover:underline"
              aria-label="Stop following"
              onClick={() => follow(false)}
            >
              Stop
            </button>
          </>
        ) : (
          <>
            <span className="shrink-0">· You stopped following ·</span>
            <button
              type="button"
              className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground hover:underline"
              onClick={() => follow(true)}
            >
              Follow
            </button>
          </>
        )}
      </p>
      <div ref={listRef} className="relative min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {root.deletedAt ? (
          <p className="px-(--pad-x-sm) pt-2 text-md text-muted-foreground italic">
            Deleted message
          </p>
        ) : (
          <MessageRow
            message={root}
            first
            hideChainLine
            person={root.authorId ? personOf(root.authorId) : undefined}
            ctx={ctx}
            handlers={handlers}
          />
        )}
        {/* biome-ignore lint/a11y/useSemanticElements: a separator that names its count can't be an <hr> */}
        <div
          role="separator"
          aria-label={count === 1 ? "1 reply" : `${count} replies`}
          className="mt-2 mb-0.5 flex h-(--row-h-sm) items-center gap-2.5 px-2 text-sm font-medium text-foreground after:h-px after:flex-1 after:bg-hairline"
        >
          <span aria-hidden>{count === 1 ? "1 reply" : `${count} replies`}</span>
        </div>
        {replies.map((r) => {
          // Inside the chain only a reply to another reply carries its quote.
          const quoted = r.replyToId && r.replyToId !== root.id ? byId.get(r.replyToId) : undefined;
          const quotedPerson = quoted?.authorId ? personOf(quoted.authorId) : undefined;
          const settled = !!root.wrappedAt && root.settledId === r.id;
          return (
            <div key={r.id} data-settled={settled ? "" : undefined}>
              <MessageRow
                message={r}
                first
                person={r.authorId ? personOf(r.authorId) : undefined}
                quoted={quoted}
                quotedName={quoted ? authorName(quoted, quotedPerson) : undefined}
                ctx={ctx}
                handlers={handlers}
              />
              {settled ? (
                <p
                  data-slot="chain-settled"
                  className="flex items-center gap-1.5 pl-[calc(var(--pad-x-sm)*2+var(--avatar-feed))] text-xs font-medium text-muted-foreground"
                >
                  <Check aria-hidden className="size-icon-xs" />
                  Settled it
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {renderComposer ? (
        <div className="shrink-0 px-2 pb-2">
          {renderComposer(`Reply to ${firstName(root.authorId, null, personOf)}`)}
        </div>
      ) : null}
    </div>
  );
}
