// The conversation scroller (specs/chat.md §Conversation).
//
//  • Opens at the "New" marker when there is one, else at the bottom.
//  • Sticks to the bottom while you're there; your own send always scrolls.
//  • Scrolled up + new arrivals → a quiet "N new messages" pill, never a jump.
//  • Near the top it pages older history in and keeps your place.
//  • `focusId` (a deep link / search hit / pinned item) scrolls to + flashes it.

import { ArrowDown, Loader2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { TimelineRow } from "../timeline";

const DAY_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});
const DAY_FMT_YEAR = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});
const NEAR_BOTTOM_PX = 120;
const NEAR_TOP_PX = 240;

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.getFullYear() === today.getFullYear() ? DAY_FMT.format(d) : DAY_FMT_YEAR.format(d);
}

export function MessageList({
  conversationKey,
  rows,
  hasMore,
  loading,
  loaded,
  onLoadOlder,
  renderMessage,
  intro,
  selfId,
  focusId,
  onFocusHandled,
}: {
  /** Changes when the conversation changes — resets scroll state. */
  conversationKey: string;
  rows: TimelineRow[];
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
  onLoadOlder: () => void;
  renderMessage: (row: Extract<TimelineRow, { kind: "message" }>) => ReactNode;
  /** Shown at the very top once all history is loaded. */
  intro?: ReactNode;
  selfId: string | null;
  focusId?: string | null;
  onFocusHandled?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prevFirst = useRef<string | null>(null);
  const prevLast = useRef<string | null>(null);
  const prevHeight = useRef(0);
  const positioned = useRef(false);
  const [unseen, setUnseen] = useState(0);
  const [showJump, setShowJump] = useState(false);

  // Reset per conversation.
  useLayoutEffect(() => {
    positioned.current = false;
    prevFirst.current = null;
    prevLast.current = null;
    atBottom.current = true;
    setUnseen(0);
    setShowJump(false);
  }, [conversationKey]);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    atBottom.current = true;
    setUnseen(0);
    setShowJump(false);
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const messages = rows.filter(
      (r): r is Extract<TimelineRow, { kind: "message" }> => r.kind === "message",
    );
    const first = messages[0]?.key ?? null;
    const lastRow = messages[messages.length - 1];
    const last = lastRow?.key ?? null;

    if (!positioned.current) {
      if (!loaded) return;
      positioned.current = true;
      const marker = el.querySelector<HTMLElement>("[data-new-marker]");
      if (marker && !focusId) {
        el.scrollTop = Math.max(0, marker.offsetTop - el.clientHeight / 3);
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
        setShowJump(!atBottom.current);
      } else {
        el.scrollTop = el.scrollHeight;
      }
    } else if (
      first !== prevFirst.current &&
      prevFirst.current !== null &&
      last === prevLast.current
    ) {
      // Older page prepended → keep the reader's place.
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (last !== prevLast.current) {
      const mine = lastRow?.message.authorId === selfId && lastRow?.message.pending;
      if (atBottom.current || mine) el.scrollTop = el.scrollHeight;
      else if (prevLast.current !== null) setUnseen((n) => n + 1);
    } else if (atBottom.current) {
      // Same rows, taller content (a reaction row, an image, an edit) — stay pinned.
      el.scrollTop = el.scrollHeight;
    }
    prevFirst.current = first;
    prevLast.current = last;
    prevHeight.current = el.scrollHeight;
  }, [rows, loaded, selfId, focusId]);

  // Deep-link focus.
  useEffect(() => {
    if (!focusId || !loaded) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(focusId)}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    atBottom.current = false;
    setShowJump(true);
    const t = setTimeout(() => onFocusHandled?.(), 2400);
    return () => clearTimeout(t);
  }, [focusId, loaded, onFocusHandled]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = distance < NEAR_BOTTOM_PX;
    if (atBottom.current) {
      if (unseen) setUnseen(0);
      if (showJump) setShowJump(false);
    } else if (distance > el.clientHeight && !showJump) {
      setShowJump(true);
    }
    if (el.scrollTop < NEAR_TOP_PX && hasMore && !loading && loaded) onLoadOlder();
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-2 pb-2"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        <div className="flex-1" />
        {loaded && !hasMore ? intro : null}
        {hasMore || (loading && !loaded) ? (
          <div className="flex justify-center py-3 text-muted-foreground">
            {loading ? (
              <Loader2 className="size-icon-sm animate-spin" aria-label="Loading messages" />
            ) : (
              <span className="h-4" />
            )}
          </div>
        ) : null}
        {rows.map((row) => {
          if (row.kind === "day") {
            return (
              <div
                key={row.key}
                className="sticky top-0 z-(--z-sticky) flex items-center gap-3 py-2"
              >
                <span className="h-px flex-1 bg-border" />
                <span className="rounded-full border border-border bg-card px-2.5 py-0.5 font-display text-2xs text-muted-foreground">
                  {dayLabel(row.date)}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
            );
          }
          if (row.kind === "new") {
            return (
              <div key={row.key} data-new-marker className="flex items-center gap-2 py-1">
                <span className="h-px flex-1 bg-(--selected-border)/60" />
                <span className="text-2xs font-medium text-foreground">
                  New<span className="sr-only"> messages below</span>
                </span>
              </div>
            );
          }
          return <div key={row.key}>{renderMessage(row)}</div>;
        })}
      </div>

      <button
        type="button"
        onClick={() => scrollToBottom(true)}
        className={cn(
          "fx-overlay absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-popover px-3 py-1 font-display text-xs text-foreground transition-opacity duration-(--motion-fade)",
          showJump || unseen > 0 ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        style={{ boxShadow: "var(--shadow-md)" }}
        tabIndex={showJump || unseen > 0 ? 0 : -1}
      >
        <ArrowDown className="size-icon-sm" aria-hidden />
        {unseen > 0 ? `${unseen} new ${unseen === 1 ? "message" : "messages"}` : "Jump to latest"}
      </button>
    </div>
  );
}
