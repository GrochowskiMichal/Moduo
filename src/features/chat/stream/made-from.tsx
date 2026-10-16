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

/** How many messages one read asks about (the GET stays well under URL limits). */
const MADE_FROM_BATCH = 100;
/** How long a just-made item shows before the server must confirm its link. */
const LOCAL_GRACE_MS = 6_000;

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
  // Made here and shown at once, until a read after the link write confirms it.
  // One the server never shows (the From chip was removed, a template made it,
  // the link failed) goes once LOCAL_GRACE_MS has passed.
  const local = useRef(new Map<string, Array<Made & { at: number }>>());
  const timers = useRef<number[]>([]);
  const key = messageIds.join(",");
  const ids = useRef(messageIds);
  ids.current = messageIds;

  // Only the newest read lands: an older one (another conversation, an
  // earlier window) finishing late must not overwrite it.
  const seq = useRef(0);

  const load = useCallback(() => {
    const wanted = ids.current;
    if (!runtime || wanted.length === 0) return;
    const mine = ++seq.current;
    const batches: Promise<ChatMadeFrom[]>[] = [];
    for (let i = 0; i < wanted.length; i += MADE_FROM_BATCH) {
      batches.push(runtime.madeFrom(wanted.slice(i, i + MADE_FROM_BATCH)));
    }
    void Promise.all(batches)
      .then((parts) => {
        if (mine !== seq.current) return;
        const next = groupMadeFrom(parts.flat());
        const now = Date.now();
        for (const [mid, items] of local.current) {
          const list = next.get(mid) ?? [];
          const keep = items.filter((it) => {
            const seen = list.some((m) => m.type === it.type && m.id === it.id);
            if (!seen && now - it.at < LOCAL_GRACE_MS) list.push({ type: it.type, id: it.id });
            return !seen && now - it.at < LOCAL_GRACE_MS;
          });
          if (keep.length) local.current.set(mid, keep);
          else local.current.delete(mid);
          if (list.length) next.set(mid, list);
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

  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
    },
    [],
  );

  const add = useCallback(
    (messageId: string, item: Made) => {
      const mine = local.current.get(messageId) ?? [];
      if (!mine.some((m) => m.type === item.type && m.id === item.id)) {
        mine.push({ ...item, at: Date.now() });
      }
      local.current.set(messageId, mine);
      setByMessage((prev) => {
        const next = new Map(prev);
        const list = [...(next.get(messageId) ?? [])];
        if (!list.some((m) => m.type === item.type && m.id === item.id)) list.push(item);
        next.set(messageId, list);
        return next;
      });
      // The link is written just after the item: read again shortly, and once
      // more after the grace period so an unlinked one goes away.
      timers.current.push(
        window.setTimeout(load, 1_500),
        window.setTimeout(load, LOCAL_GRACE_MS + 500),
      );
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
