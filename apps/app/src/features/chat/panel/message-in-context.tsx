// A message in context (spec #10): an item in the right panel ("← name")
// showing the message with ten messages either side, read straight from the
// server so the open conversation's window doesn't move, and "Open in
// conversation" to land on it there. Pinned opens it now; Catch up and Search
// reuse it (CV-11).

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { PersonAvatar } from "@/components/ui/avatar";
import { formatPastDay, formatTime } from "@/lib/time-format";
import { cn } from "@/lib/utils";

import type { ChatMessage, ChatPerson, ChatRuntime } from "../model";
import { keyOf } from "../store/keys";
import { type BodyContext, MessageBody } from "../stream/message-body";
import { authorName } from "../stream/rows";

/** Messages either side of the one in context. */
export const CONTEXT_SPAN = 10;

type Loaded = { state: "loading" } | { state: "missing" } | { state: "ready"; rows: ChatMessage[] };

/** The message and up to `span` messages either side, oldest first; null when it can't be read. */
export async function readInContext(
  chat: Pick<ChatRuntime, "message" | "page">,
  messageId: string,
  span = CONTEXT_SPAN,
): Promise<ChatMessage[] | null> {
  const found = await chat.message(messageId);
  const message = found.error ? null : found.data;
  if (!message) return null;
  const key = keyOf(message);
  const [before, after] = await Promise.all([
    chat.page({ channelId: message.channelId, before: key, limit: span }),
    chat.page({ channelId: message.channelId, after: key, limit: span }),
  ]);
  return [...(before.data ?? []), message, ...(after.data ?? [])].filter(
    (m) => m.kind !== "event" && !m.deletedAt,
  );
}

export function MessageInContext({
  chat,
  messageId,
  selfId,
  personOf,
  onPersonClick,
}: {
  chat: ChatRuntime | null;
  messageId: string;
  selfId: string;
  personOf: (id: string) => ChatPerson | undefined;
  onPersonClick?: (userId: string) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  // The message sits in the middle of the list; only the list scrolls (never the stream).
  const listRef = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    const here = list?.querySelector<HTMLElement>("[data-current]");
    if (!list || !here || loaded.state !== "ready") return;
    list.scrollTop = Math.max(0, here.offsetTop - (list.clientHeight - here.offsetHeight) / 2);
  }, [loaded]);
  useEffect(() => {
    if (!chat) return;
    let live = true;
    setLoaded({ state: "loading" });
    void readInContext(chat, messageId)
      .then((rows) => {
        if (live) setLoaded(rows ? { state: "ready", rows } : { state: "missing" });
      })
      .catch(() => live && setLoaded({ state: "missing" }));
    return () => {
      live = false;
    };
  }, [chat, messageId]);

  if (loaded.state === "loading") {
    return <p className="px-2 text-sm text-subtle-foreground">Loading…</p>;
  }
  if (loaded.state === "missing") {
    return <p className="px-2 text-sm text-subtle-foreground">That message isn't available.</p>;
  }
  const ctx: BodyContext = { selfId, personOf, onPersonClick };
  return (
    <ol
      ref={listRef}
      data-slot="message-in-context"
      className="pane-scroll relative flex h-full flex-col gap-1 overflow-auto"
    >
      {loaded.rows.map((m, i) => {
        const prev = loaded.rows[i - 1];
        const newDay = !prev || formatPastDay(prev.createdAt) !== formatPastDay(m.createdAt);
        const person = m.authorId ? personOf(m.authorId) : undefined;
        const name = authorName(m, person);
        const here = m.id === messageId;
        return (
          <li key={m.id}>
            {newDay ? (
              <p className="px-2 pt-2 pb-1 text-xs text-subtle-foreground">
                {formatPastDay(m.createdAt)}
              </p>
            ) : null}
            <div
              data-message-id={m.id}
              data-current={here ? "" : undefined}
              className={cn("flex min-w-0 gap-2 rounded-md px-2 py-1.5", here && "bg-state-active")}
            >
              <PersonAvatar
                name={name}
                id={m.authorId ?? m.authorLabel ?? undefined}
                src={person?.avatarUrl}
                size="icon"
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline gap-2 text-xs">
                  <span className="truncate font-medium text-foreground">{name}</span>
                  <time className="shrink-0 text-subtle-foreground tabular-nums">
                    {formatTime(m.createdAt)}
                  </time>
                </p>
                <MessageBody message={m} ctx={ctx} className="text-sm" />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
