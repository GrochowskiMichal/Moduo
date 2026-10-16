// "Became a task: ○ Get logo SVGs · Today" under a message (chat-v2 §8, CH10;
// CV-10). The line lists what was made from the message (a task, note or
// event whose `spawned-from` link points at it), each as a live reference
// chip: its status and date tick as the item changes, and someone who can't
// open it sees "Private item". The links are read for the messages on screen,
// again when a capture made from one of them is created, and when the window
// regains focus.

import { CornerDownRight } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Reference } from "../../spine/references/ui/reference";
import type { ChatMadeFrom, ChatRuntime } from "../model";

type Made = { type: string; id: string };

type MadeFromValue = {
  byMessage: ReadonlyMap<string, readonly Made[]>;
  /** Show something just made from a message at once (the server agrees on the next read). */
  add: (messageId: string, item: Made) => void;
};

const MadeFromContext = createContext<MadeFromValue | null>(null);

const NOUN: Record<string, string> = { task: "a task", note: "a note", event: "an event" };

/** "Became a task", "Became a note", or "Became" for a mix. */
export function becameLabel(items: readonly Made[]): string {
  const kinds = new Set(items.map((i) => i.type));
  if (kinds.size === 1) {
    const noun = NOUN[items[0].type];
    if (noun) return items.length === 1 ? `Became ${noun}` : `Became ${items[0].type}s`;
  }
  return "Became";
}

/** Group the links by message, oldest first, one per item. */
export function groupMadeFrom(rows: readonly ChatMadeFrom[]): Map<string, Made[]> {
  const out = new Map<string, Made[]>();
  for (const r of rows) {
    const list = out.get(r.messageId) ?? [];
    if (!list.some((m) => m.type === r.type && m.id === r.id))
      list.push({ type: r.type, id: r.id });
    out.set(r.messageId, list);
  }
  return out;
}

/** What was made from the messages on screen (server ids), kept current. */
export function useMadeFrom(
  runtime: Pick<ChatRuntime, "madeFrom"> | null,
  messageIds: readonly string[],
): MadeFromValue {
  const [byMessage, setByMessage] = useState<Map<string, Made[]>>(() => new Map());
  const local = useRef(new Map<string, Made[]>());
  const key = messageIds.join(",");
  const ids = useRef(messageIds);
  ids.current = messageIds;

  const load = useCallback(() => {
    const wanted = ids.current;
    if (!runtime || wanted.length === 0) return;
    void runtime
      .madeFrom(wanted.slice(-200))
      .then((rows) => {
        const next = groupMadeFrom(rows);
        // Keep what was just made here until the server shows it.
        for (const [mid, items] of local.current) {
          const list = next.get(mid) ?? [];
          for (const it of items) {
            if (!list.some((m) => m.type === it.type && m.id === it.id)) list.push(it);
          }
          next.set(mid, list);
        }
        setByMessage(next);
      })
      .catch(() => {});
  }, [runtime]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the joined ids are the cue
  useEffect(() => {
    load();
  }, [key, load]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  const add = useCallback(
    (messageId: string, item: Made) => {
      const mine = local.current.get(messageId) ?? [];
      if (!mine.some((m) => m.type === item.type && m.id === item.id)) mine.push(item);
      local.current.set(messageId, mine);
      setByMessage((prev) => {
        const next = new Map(prev);
        const list = [...(next.get(messageId) ?? [])];
        if (!list.some((m) => m.type === item.type && m.id === item.id)) list.push(item);
        next.set(messageId, list);
        return next;
      });
      // The link is written just after the item: read again shortly.
      setTimeout(load, 1500);
    },
    [load],
  );

  return useMemo(() => ({ byMessage, add }), [byMessage, add]);
}

/** Hands the rows the lines (value from {@link useMadeFrom}). */
export function MadeFromScope({ value, children }: { value: MadeFromValue; children: ReactNode }) {
  return <MadeFromContext.Provider value={value}>{children}</MadeFromContext.Provider>;
}

/** The line under a message; nothing when nothing was made from it. */
export function MadeFromLine({ messageId }: { messageId: string }) {
  const items = useContext(MadeFromContext)?.byMessage.get(messageId);
  if (!items || items.length === 0) return null;
  return (
    <div
      data-slot="made-from"
      className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground"
    >
      <CornerDownRight className="size-icon-xs shrink-0" aria-hidden />
      <span>{becameLabel(items)}:</span>
      {items.map((it) => (
        <Reference key={`${it.type}:${it.id}`} type={it.type} id={it.id} display="chip" />
      ))}
    </div>
  );
}
