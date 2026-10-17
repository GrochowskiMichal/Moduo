// The Reply chains view (CV-12, spec §5, round 4 frame 4 "list"): every open
// chain in this conversation, newest activity first, with "1 new"; the
// wrapped ones below under "Wrapped up" with the reply that settled it. A
// click opens the chain as an item. Details' "Reply chains" section draws the
// same read in compact rows (round 5 frame 4).

import { MessagesSquare } from "lucide-react";
import { PersonAvatar } from "@/components/ui/avatar";
import { formatAge, formatWhen } from "@/lib/time-format";
import { cn } from "@/lib/utils";
import { type ChainEntry, excerptOf } from "../chains";
import type { ChatMessage, ChatPerson } from "../model";
import { firstName } from "../stream/rows";

type Common = {
  selfId: string;
  personOf: (id: string) => ChatPerson | undefined;
  rowById: (id: string) => ChatMessage | undefined;
  onOpen: (root: ChatMessage) => void;
};

const repliesText = (n: number) => (n === 1 ? "1 reply" : `${n} replies`);

export function ReplyChainsView({
  groups,
  selfId,
  personOf,
  rowById,
  onOpen,
}: Common & { groups: { open: ChainEntry[]; wrapped: ChainEntry[] } | null }) {
  if (!groups) return <p className="px-3 text-sm text-subtle-foreground">Loading…</p>;
  if (groups.open.length === 0 && groups.wrapped.length === 0) {
    return (
      <p className="px-3 text-sm text-subtle-foreground" data-slot="chains-empty">
        No reply chains yet.
      </p>
    );
  }
  const row = (e: ChainEntry) => {
    const root = e.root;
    const author = firstName(root.authorId, selfId, personOf);
    const person = root.authorId ? personOf(root.authorId) : undefined;
    const settled = root.settledId ? rowById(root.settledId) : undefined;
    return (
      <li key={root.id}>
        <button
          type="button"
          data-chain={root.id}
          onClick={() => onOpen(root)}
          className={cn(
            "grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 rounded-md p-2 text-left outline-none",
            "transition-colors duration-(--motion-fade) ease-(--ease-out)",
            "hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring/50",
          )}
        >
          <PersonAvatar
            name={person?.name ?? author}
            id={root.authorId ?? undefined}
            src={person?.avatarUrl}
            size="sm"
            className="mt-px"
          />
          <span className="min-w-0">
            <span className="block truncate text-sm text-foreground">
              <b className="font-semibold">{author}</b> {excerptOf(root)}
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-subtle-foreground">
              {root.wrappedAt ? (
                <span className="min-w-0 truncate">
                  ✓{" "}
                  {settled
                    ? `${firstName(settled.authorId, selfId, personOf)} “${excerptOf(settled, 60)}”`
                    : `Wrapped up · ${repliesText(root.replyCount)}`}{" "}
                  · {formatAge(root.wrappedAt)}
                </span>
              ) : (
                <>
                  <span>{repliesText(root.replyCount)}</span>
                  {root.lastReplyAt ? <span>· last {formatWhen(root.lastReplyAt)}</span> : null}
                  {e.fresh > 0 ? (
                    <span className="font-medium text-foreground">· {e.fresh} new</span>
                  ) : null}
                </>
              )}
            </span>
          </span>
        </button>
      </li>
    );
  };
  return (
    <div className="flex flex-col gap-0.5 px-1 pb-3" data-slot="reply-chains">
      <ul className="flex flex-col gap-0.5" aria-label="Open reply chains">
        {groups.open.map(row)}
      </ul>
      {groups.wrapped.length > 0 ? (
        <>
          <h3 className="px-2 pt-2.5 pb-1 text-xs text-subtle-foreground">Wrapped up</h3>
          <ul className="flex flex-col gap-0.5" aria-label="Wrapped up">
            {groups.wrapped.map(row)}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** Details' "Reply chains" rows (round 5 frame 4): icon · "Sofia: Can someone…" · count. */
export function DetailsChainRows({
  groups,
  selfId,
  personOf,
  onOpen,
  rowClassName,
}: Omit<Common, "rowById"> & {
  groups: { open: ChainEntry[]; wrapped: ChainEntry[] };
  rowClassName: string;
}) {
  return (
    <ul className="flex flex-col gap-px" data-slot="details-chains">
      {[...groups.open, ...groups.wrapped].map(({ root }) => (
        <li key={root.id}>
          <button
            type="button"
            data-chain={root.id}
            data-wrapped={root.wrappedAt ? "" : undefined}
            onClick={() => onOpen(root)}
            className={rowClassName}
          >
            <MessagesSquare className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-foreground">
              {firstName(root.authorId, selfId, personOf)}: {excerptOf(root)}
            </span>
            <span className="shrink-0 text-xs text-subtle-foreground tabular-nums">
              {root.wrappedAt ? `✓ ${root.replyCount}` : root.replyCount}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
