"use no memo";
// TanStack Virtual keeps its state on one mutable object; the React Compiler
// would cache what this component reads from it as if it never changed, so
// this file (and only this file, decision #16) opts out. The rows it draws
// (`rows.tsx`, `message-body.tsx`) stay compiled.

// The stream (chat v2 §3, CV-7a; spike 1's recommended configuration,
// docs/build/chat-v2/CV-0-S1.md): one virtualized list that opens at the
// bottom, follows new messages while you're there, never pulls while you read
// history, loads older pages near the top and newer ones near the bottom of a
// jump window, keeps the reader's row still on prepends and size changes
// above it, and remembers measured heights per conversation so switching back
// is instant. The `feed` pattern: a polite live region names new messages
// without taking focus; ↑↓ step through messages and the message keys act on
// the selected one.

import { defaultRangeExtractor, type Range, useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown } from "lucide-react";
import {
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FLOATING_SURFACE } from "@/components/ui/surface";
import { formatPastDay } from "@/lib/time-format";
import { cn } from "@/lib/utils";
import type { ChatMessage, ChatPerson } from "../model";
import type { ChatWindow } from "../store/store";
import { buildStream, countNewSince, lastSeenMessage, type StreamItem } from "../timeline";
import { EditBox } from "./edit-box";
import { HoverToolbar, type MessageVerbs } from "./message-actions";
import type { BodyContext } from "./message-body";
import { authorName, DaySeparator, DeletedRow, EventLine, MessageRow, NewPill } from "./rows";

type Row = StreamItem | { type: "intro"; key: "intro" };

/** Measured heights per conversation and density (the measurement cache). */
const sizeCache = new Map<string, Map<string, number>>();
const SIZE_CACHE_CONVERSATIONS = 30;

function rememberSizes(key: string, sizes: Map<string, number>): void {
  sizeCache.delete(key);
  sizeCache.set(key, sizes);
  if (sizeCache.size > SIZE_CACHE_CONVERSATIONS) {
    const oldest = sizeCache.keys().next().value;
    if (oldest !== undefined) sizeCache.delete(oldest);
  }
}

/** Load the next page when the reader is this close to an edge. */
const EDGE_PX = 600;
/** "At the end": within this of the bottom (spike 1's scrollEndThreshold). */
const END_PX = 80;
/** How long a jump's target stays lit. */
const TARGET_MS = 2500;

function estimate(row: Row | undefined): number {
  if (!row) return 40;
  switch (row.type) {
    case "intro":
      return 120;
    case "day":
      return 42;
    case "new":
      return 36;
    case "event":
      return 30;
    case "deleted":
      return 58;
    default: {
      const m = row.message;
      const lines = Math.max(1, Math.ceil(m.body.length / 90)) + (m.body.match(/\n/g)?.length ?? 0);
      let h = 6 + lines * 22.5;
      if (row.first) h += 18 + 23;
      if (Object.keys(m.reactions).length > 0) h += 30;
      if (m.replyCount > 0) h += 32;
      if (m.replyToId) h += 20;
      if (m.sendState === "failed" || m.sendState === "waiting") h += 30;
      return Math.round(h);
    }
  }
}

function currentDensity(): string {
  if (typeof document === "undefined") return "comfortable";
  return document.documentElement.dataset.density ?? "comfortable";
}

export type MessageStreamHandle = {
  /** Select the newest message and focus the stream (from the composer). */
  focusLast: () => void;
};

export type MessageStreamProps = {
  conversationId: string;
  window: ChatWindow;
  selfId: string | null;
  personOf: (id: string) => ChatPerson | undefined;
  /** A held message by id (a reply's quote line). */
  rowById: (id: string) => ChatMessage | undefined;
  /** Ids deleted here and still inside their Undo time. */
  hidden: ReadonlySet<string>;
  editingId: string | null;
  /** Viewers and archived conversations draw no write verbs. */
  canWrite: boolean;
  /** The conversation's beginning (drawn above the oldest message). */
  intro?: ReactNode;
  onLoadOlder: () => void;
  onLoadNewer: () => void;
  onJumpToLatest: () => void;
  /** The last message that was on screen (the read mark; forward only in the store). */
  onSeen: (messageId: string) => void;
  onStartEdit: (m: ChatMessage) => void;
  onCancelEdit: () => void;
  onSaveEdit: (m: ChatMessage, body: string) => void;
  onDelete: (m: ChatMessage) => void;
  onReact: (m: ChatMessage, key: string, on: boolean) => void;
  onPin: (m: ChatMessage) => void;
  onTask: (m: ChatMessage) => void;
  onCopyLink: (m: ChatMessage) => void;
  onMarkUnread: (m: ChatMessage) => void;
  onOpenChain: (m: ChatMessage) => void;
  onRetry: (m: ChatMessage) => void;
  onDiscard: (m: ChatMessage) => void;
  onPersonClick?: (userId: string) => void;
  /** ⏎ on a message without replies, Esc, ↓ past the newest: back to typing. */
  onReturnToComposer: () => void;
};

export const MessageStream = forwardRef<MessageStreamHandle, MessageStreamProps>(
  function MessageStream(props, handleRef) {
    const {
      conversationId,
      window: win,
      selfId,
      personOf,
      rowById,
      hidden,
      editingId,
      canWrite,
      intro,
    } = props;
    // Handlers change identity every render; the effects read the latest.
    const live = useRef(props);
    live.current = props;

    const scrollRef = useRef<HTMLDivElement | null>(null);
    const [density] = useState(currentDensity);

    const sizes = useRef<Map<string, number>>(
      sizeCache.get(`${conversationId}|${density}`) ?? new Map(),
    );

    // One rows array per change of the window: the virtualizer's measurement
    // memo is keyed on `estimateSize` / `getItemKey`, which are keyed on it.
    const hasIntro = !win.hasOlder && !!intro;
    const rows: Row[] = useMemo(() => {
      const items = buildStream(win.rows, {
        hasOlder: win.hasOlder,
        newAfter: win.newAfter,
        selfId,
        hidden,
      });
      return hasIntro ? [{ type: "intro", key: "intro" }, ...items] : items;
    }, [win.rows, win.hasOlder, win.newAfter, selfId, hidden, hasIntro]);
    const rowsRef = useRef(rows);
    rowsRef.current = rows;

    // ── sticky day separator ────────────────────────────────────────────────
    const activeSticky = useRef(-1);
    const stickyIndexes: number[] = [];
    for (let i = 0; i < rows.length; i++) if (rows[i]?.type === "day") stickyIndexes.push(i);
    const rangeExtractor = (range: Range) => {
      const shown = defaultRangeExtractor(range);
      let active = -1;
      let lo = 0;
      let hi = stickyIndexes.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if ((stickyIndexes[mid] as number) <= range.startIndex) {
          active = stickyIndexes[mid] as number;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      activeSticky.current = active;
      if (active >= 0 && !shown.includes(active)) shown.unshift(active);
      return shown;
    };

    // Stable per rows: the virtualizer's measurement memo is keyed on them.
    const estimateSize = useCallback(
      (index: number) => {
        const row = rows[index];
        return (row && sizes.current.get(row.key)) ?? estimate(row);
      },
      [rows],
    );
    const getItemKey = useCallback((index: number) => rows[index]?.key ?? index, [rows]);

    const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
      count: rows.length,
      getScrollElement: () => scrollRef.current,
      estimateSize,
      getItemKey,
      rangeExtractor,
      overscan: 6,
      anchorTo: "end",
      followOnAppend: true,
      scrollEndThreshold: END_PX,
      useFlushSync: true,
    });
    // Compensate every size change wholly above the viewport, whatever the
    // scroll direction (TanStack skips them while scrolling backward).
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, v) =>
      item.start + item.size <= (v.scrollOffset ?? 0) + v.scrollAdjustments;

    const indexOfKey = useCallback((key: string) => {
      const list = rowsRef.current;
      for (let i = list.length - 1; i >= 0; i--) if (list[i]?.key === key) return i;
      return -1;
    }, []);

    // Remember what was measured, for switching back (the measurement cache).
    const densityRef = useRef(density);
    const saveSizes = useCallback(() => {
      const cache = sizes.current;
      for (const [key, size] of virtualizer.itemSizeCache) {
        if (typeof key === "string") cache.set(key, size);
      }
      rememberSizes(`${conversationId}|${densityRef.current}`, cache);
    }, [virtualizer, conversationId]);
    useEffect(() => saveSizes, [saveSizes]);

    // A density switch (CH27) re-anchors in the same task, before the frame
    // paints (spike 1's helper): the reader's row stays where it was while
    // every row takes its new height.
    const [, rerender] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
      const root = document.documentElement;
      const observer = new MutationObserver(() => {
        const next = root.dataset.density ?? "comfortable";
        if (next === densityRef.current) return;
        const el = scrollRef.current;
        const prev = densityRef.current;
        saveSizes();
        densityRef.current = next;
        sizes.current = sizeCache.get(`${conversationId}|${next}`) ?? new Map();
        if (!el) return;
        // 1. The anchor: the first message wholly in view, by its text's top.
        //    The new density's styles already apply, but rows still sit at
        //    their old offsets; a row that starts a person had the old
        //    density's gap above its text, read from a probe.
        const probe = document.createElement("div");
        probe.dataset.density = prev;
        el.appendChild(probe);
        const gapRaw = getComputedStyle(probe).getPropertyValue("--feed-person-gap").trim();
        probe.remove();
        const rem = Number.parseFloat(getComputedStyle(root).fontSize) || 16;
        const oldGap = (Number.parseFloat(gapRaw) || 0) * (gapRaw.endsWith("rem") ? rem : 1);
        const top = el.getBoundingClientRect().top;
        let anchorKey: string | null = null;
        let anchorTop = 0;
        let anchorInner = 0;
        for (const node of el.querySelectorAll<HTMLElement>("[data-key]")) {
          if (node.dataset.sticky !== undefined) continue;
          const article = node.querySelector<HTMLElement>("[data-message-id]");
          if (!article) continue;
          const r = node.getBoundingClientRect();
          const inner = article.getBoundingClientRect().top - r.top;
          const t = r.top - top + (inner > 0.5 ? oldGap : 0);
          if (
            t >= 0 &&
            r.bottom - top <= el.clientHeight &&
            (anchorKey === null || t < anchorTop)
          ) {
            anchorKey = node.dataset.key ?? null;
            anchorTop = t;
            anchorInner = inner;
          }
        }
        // 2. Forget every size, re-measure what is drawn.
        virtualizer.measure();
        for (const node of el.querySelectorAll<HTMLDivElement>("[data-index]")) {
          virtualizer.measureElement(node);
        }
        virtualizer.getTotalSize();
        // 3. Put the anchor back where it was.
        if (anchorKey !== null) {
          const item = virtualizer.measurementsCache[indexOfKey(anchorKey)];
          if (item) {
            const target = Math.max(0, item.start + anchorInner - anchorTop);
            el.scrollTop = target;
            virtualizer.scrollOffset = target;
            virtualizer.scrollAdjustments = 0;
          }
        }
        flushSync(rerender);
      });
      observer.observe(root, { attributes: true, attributeFilter: ["data-density"] });
      return () => observer.disconnect();
    }, [virtualizer, conversationId, saveSizes, indexOfKey]);

    // ── opening, jumps, back to the present ─────────────────────────────────
    const [lit, setLit] = useState<string | null>(null);
    const opened = useRef(false);
    const landedOn = useRef<string | null>(null);
    const hadNewer = useRef(win.hasNewer);
    useLayoutEffect(() => {
      // Nothing to open on until the scroller and a message are there (the
      // intro alone, under the skeleton, isn't).
      if (win.rows.length === 0 || !scrollRef.current) return;
      const target = win.target;
      if (target && landedOn.current !== target) {
        const i = indexOfKey(target);
        if (i >= 0) {
          landedOn.current = target;
          opened.current = true;
          virtualizer.scrollToIndex(i, { align: "center" });
          setLit(target);
          return;
        }
      }
      if (!opened.current) {
        opened.current = true;
        virtualizer.scrollToEnd();
      } else if (hadNewer.current && !win.hasNewer && !target) {
        virtualizer.scrollToEnd();
      }
      hadNewer.current = win.hasNewer;
    });
    useEffect(() => {
      if (!lit) return;
      const t = setTimeout(() => setLit(null), TARGET_MS);
      return () => clearTimeout(t);
    }, [lit]);

    // ── where the reader is: the end, the edges, the read mark ──────────────
    const [atEnd, setAtEnd] = useState(true);
    const atEndRef = useRef(true);
    const newestId = (() => {
      for (let i = win.rows.length - 1; i >= 0; i--) {
        const m = win.rows[i]!;
        if (!m.sendState) return m.id;
      }
      return null;
    })();
    const [baseline, setBaseline] = useState<string | null>(newestId);

    const reportSeen = useCallback(() => {
      const el = scrollRef.current;
      if (!el || (typeof document !== "undefined" && document.visibilityState === "hidden")) return;
      const bottom = el.scrollTop + el.clientHeight + 2;
      let last = -1;
      for (const v of virtualizer.getVirtualItems()) {
        if (v.start + v.size <= bottom && v.index > last) last = v.index;
      }
      if (last < 0) return;
      const list = rowsRef.current.filter((r): r is StreamItem => r.type !== "intro");
      const shift = rowsRef.current.length - list.length;
      const seen = lastSeenMessage(list, last - shift);
      if (seen) live.current.onSeen(seen.id);
    }, [virtualizer]);

    const seenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onScroll = useCallback(() => {
      const el = scrollRef.current;
      if (!el) return;
      const p = live.current;
      const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const end = fromBottom <= END_PX && !p.window.hasNewer;
      if (end !== atEndRef.current) {
        atEndRef.current = end;
        setAtEnd(end);
      }
      if (el.scrollTop < EDGE_PX && p.window.hasOlder && !p.window.loading) p.onLoadOlder();
      if (fromBottom < EDGE_PX && p.window.hasNewer && !p.window.loading) p.onLoadNewer();
      if (seenTimer.current) clearTimeout(seenTimer.current);
      seenTimer.current = setTimeout(reportSeen, 150);
    }, [reportSeen]);
    useEffect(
      () => () => {
        if (seenTimer.current) clearTimeout(seenTimer.current);
      },
      [],
    );

    // At the end, every arrival is seen; the chip counts from where you left it.
    useEffect(() => {
      if (atEnd) {
        setBaseline(newestId);
        if (win.loaded) reportSeen();
      }
    }, [atEnd, newestId, win.loaded, reportSeen]);
    useEffect(() => {
      const onVisible = () => {
        if (document.visibilityState === "visible") reportSeen();
      };
      document.addEventListener("visibilitychange", onVisible);
      return () => document.removeEventListener("visibilitychange", onVisible);
    }, [reportSeen]);

    const fresh = atEnd || win.hasNewer ? 0 : countNewSince(win.rows, baseline, selfId);

    // The polite live region names a new message from someone else.
    const [announce, setAnnounce] = useState("");
    const lastAnnounced = useRef(newestId);
    useEffect(() => {
      if (!newestId || newestId === lastAnnounced.current) return;
      lastAnnounced.current = newestId;
      const m = win.rows.find((r) => r.id === newestId);
      if (!m || m.authorId === selfId || m.kind === "event") return;
      setAnnounce(
        `New message from ${authorName(m, m.authorId ? personOf(m.authorId) : undefined)}`,
      );
    }, [newestId, win.rows, selfId, personOf]);

    // ── pointer, selection, the menu ────────────────────────────────────────
    const [hovered, setHovered] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [menu, setMenu] = useState<{ key: string; reactions: boolean } | null>(null);

    const messageKeys = (): string[] =>
      rowsRef.current.flatMap((r) => (r.type === "message" ? [r.key] : []));

    const select = (key: string | null) => {
      setSelected(key);
      if (key) {
        const i = indexOfKey(key);
        if (i >= 0) virtualizer.scrollToIndex(i, { align: "auto" });
      }
    };

    useImperativeHandle(handleRef, () => ({
      focusLast: () => {
        const keys = messageKeys();
        const last = keys[keys.length - 1];
        if (!last) return;
        select(last);
        scrollRef.current?.focus({ preventScroll: true });
      },
    }));

    const messageOf = (key: string | null): ChatMessage | null => {
      if (!key) return null;
      const r = rowsRef.current[indexOfKey(key)];
      return r && r.type === "message" ? r.message : null;
    };

    const own = (m: ChatMessage) => !!selfId && m.authorId === selfId && m.authorKind === "user";

    const verbsFor = (m: ChatMessage): MessageVerbs => {
      const p = live.current;
      return {
        onReact: (key) => {
          const mine = !!selfId && (m.reactions[key] ?? []).includes(selfId);
          p.onReact(m, key, !mine);
        },
        onReply: () => p.onOpenChain(m),
        onTask: () => p.onTask(m),
        onEdit: canWrite && own(m) ? () => p.onStartEdit(m) : undefined,
        onDelete: canWrite && own(m) ? () => p.onDelete(m) : undefined,
        onPin: () => p.onPin(m),
        onCopyLink: () => p.onCopyLink(m),
        onMarkUnread: () => p.onMarkUnread(m),
      };
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return; // a button, the edit box
      if (e.nativeEvent.isComposing) return;
      const keys = messageKeys();
      const p = live.current;
      const m = messageOf(selected);
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (e.altKey || e.metaKey || e.ctrlKey) return; // ⌥↑↓ walk conversations (the page)
        e.preventDefault();
        const i = selected ? keys.indexOf(selected) : keys.length;
        const next = e.key === "ArrowUp" ? i - 1 : i + 1;
        if (next >= keys.length) {
          select(null);
          p.onReturnToComposer();
        } else select(keys[Math.max(0, next)] ?? null);
        return;
      }
      if (e.key === "Escape") {
        if (selected) {
          e.preventDefault();
          select(null);
          p.onReturnToComposer();
        }
        return;
      }
      if (!m || m.sendState) return;
      const verbs = verbsFor(m);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "Backspace") {
        if (verbs.onDelete) {
          e.preventDefault();
          verbs.onDelete();
        }
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === "Enter") {
        e.preventDefault();
        if (m.replyCount > 0) p.onOpenChain(m);
        else {
          select(null);
          p.onReturnToComposer();
        }
        return;
      }
      if (!canWrite && e.key !== "r" && e.key !== "R") return;
      switch (e.key) {
        case "r":
        case "R":
          e.preventDefault();
          verbs.onReply();
          return;
        case "e":
        case "E":
          if (verbs.onEdit) {
            e.preventDefault();
            verbs.onEdit();
          }
          return;
        case "+":
        case "=":
          e.preventDefault();
          setMenu({ key: m.id, reactions: true });
          return;
        case "p":
        case "P":
          e.preventDefault();
          verbs.onPin();
          return;
        case "t":
        case "T":
          e.preventDefault();
          verbs.onTask();
          return;
        default:
          return;
      }
    };

    // ── drawing ─────────────────────────────────────────────────────────────
    const ctx: BodyContext = { selfId, personOf, onPersonClick: props.onPersonClick };
    const handlers = {
      onReact: (m: ChatMessage, key: string, on: boolean) => live.current.onReact(m, key, on),
      onOpenChain: (m: ChatMessage) => live.current.onOpenChain(m),
      onRetry: (m: ChatMessage) => live.current.onRetry(m),
      onDiscard: (m: ChatMessage) => live.current.onDiscard(m),
      onPersonClick: props.onPersonClick,
    };

    const draw = (row: Row): ReactNode => {
      switch (row.type) {
        case "intro":
          return intro;
        case "day":
          return <DaySeparator at={row.at} />;
        case "new":
          return <NewPill />;
        case "event":
          return <EventLine message={row.message} />;
        case "deleted":
          return <DeletedRow message={row.message} onOpenChain={handlers.onOpenChain} />;
        default: {
          const m = row.message;
          const person = m.authorId ? personOf(m.authorId) : undefined;
          const quoted = m.replyToId ? rowById(m.replyToId) : undefined;
          const quotedPerson = quoted?.authorId ? personOf(quoted.authorId) : undefined;
          const editing = editingId === m.id;
          const showTools =
            !editing &&
            !m.sendState &&
            (hovered === row.key || selected === row.key || menu?.key === row.key);
          return (
            <MessageRow
              message={m}
              first={row.first}
              person={person}
              quoted={quoted}
              quotedName={quoted ? authorName(quoted, quotedPerson) : undefined}
              ctx={ctx}
              selected={selected === row.key}
              target={lit === row.key}
              handlers={handlers}
              onPointerEnter={() => setHovered(row.key)}
              onContextMenu={(e) => {
                if (m.sendState) return;
                e.preventDefault();
                setMenu({ key: row.key, reactions: true });
              }}
              toolbar={
                showTools ? (
                  <HoverToolbar
                    message={m}
                    verbs={verbsFor(m)}
                    menuOpen={menu?.key === row.key}
                    menuWithReactions={menu?.key === row.key && menu.reactions}
                    onMenuOpenChange={(open) =>
                      setMenu(open ? { key: row.key, reactions: false } : null)
                    }
                  />
                ) : undefined
              }
              editor={
                editing ? (
                  <EditBox
                    initial={m.body}
                    onCancel={() => live.current.onCancelEdit()}
                    onSave={(body) => live.current.onSaveEdit(m, body)}
                  />
                ) : undefined
              }
            />
          );
        }
      }
    };

    const loadingFirst = !win.loaded && win.rows.length === 0;
    const virtualItems = virtualizer.getVirtualItems();
    const viewingFrom = win.hasNewer ? (win.rows[win.hasOlder ? 1 : 0]?.createdAt ?? null) : null;

    return (
      <div className="relative flex min-h-0 flex-1 flex-col">
        {loadingFirst ? (
          <div aria-busy className="flex flex-1 flex-col justify-end gap-4 px-(--pad-x-sm) pb-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid grid-cols-[var(--avatar-feed)_minmax(0,1fr)] gap-x-3">
                <Skeleton className="size-(--avatar-feed) rounded-full" />
                <div className="flex flex-col gap-2 pt-1">
                  <Skeleton className="h-3 w-1/4" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            ref={scrollRef}
            role="feed"
            aria-busy={win.loading}
            aria-label="Messages"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the feed takes focus to step through messages
            tabIndex={0}
            onScroll={onScroll}
            onKeyDown={onKeyDown}
            onPointerLeave={() => setHovered(null)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !menu) {
                setSelected(null);
              }
            }}
            data-testid="message-stream"
            className="chat-stream min-h-0 flex-1 px-2 outline-none"
          >
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {virtualItems.map((v) => {
                const row = rows[v.index];
                if (!row) return null;
                const sticky = v.index === activeSticky.current;
                return (
                  <div
                    key={v.key}
                    data-key={row.key}
                    data-index={v.index}
                    data-sticky={sticky ? "" : undefined}
                    ref={virtualizer.measureElement}
                    className="chat-stream-item"
                    style={sticky ? undefined : { transform: `translateY(${v.start}px)` }}
                  >
                    {draw(row)}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div aria-live="polite" className="sr-only">
          {announce}
        </div>
        {viewingFrom ? (
          <div
            className={cn(
              FLOATING_SURFACE,
              "absolute bottom-3 left-1/2 z-20 flex h-(--ctrl-h) -translate-x-1/2 items-center gap-2.5 rounded-full pr-1 pl-3 text-sm text-muted-foreground shadow-md",
            )}
          >
            <span>Viewing messages from {formatPastDay(viewingFrom)}</span>
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full"
              onClick={() => live.current.onJumpToLatest()}
            >
              Jump to present
            </Button>
          </div>
        ) : fresh > 0 ? (
          <button
            type="button"
            onClick={() => virtualizer.scrollToEnd({ behavior: "smooth" })}
            className={cn(
              FLOATING_SURFACE,
              "absolute bottom-3 left-1/2 z-20 inline-flex h-(--ctrl-h) -translate-x-1/2 items-center gap-1.5 rounded-full px-3 text-sm text-foreground shadow-md hover:bg-state-hover",
            )}
          >
            {fresh} new
            <ArrowDown aria-hidden className="size-icon-sm" />
          </button>
        ) : null}
      </div>
    );
  },
);
