// The now-and-next line in the Calendar toolbar (CALR-2, AC11): "● Legal review
// with Tom · until 11:15 AM · then 1:1 with Ana 11:30 AM · ⇧⌘J". It lives in
// the toolbar's free room (a flex-1 slot, so its width is what the neighbours
// leave), drops then, the key and until in that order as that room narrows,
// and clips and truncates inside its own box so it never prints over a
// neighbour. Absent offline, where the offline line takes its place. Clicking
// opens the meeting; ⇧⌘J joins it.

import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { Kbd } from "../../../components/ui/kbd";
import { useAppHotkeys } from "../../../lib/hotkeys";
import type { CalendarEventModel } from "../events";
import { localDayKey } from "../lens";
import {
  nowAndNext,
  type NowNext,
  type NowNextItem,
  nowNextItems,
  type NowNextParts,
  nowNextParts,
} from "../now-next";
import { OfflineLine, type WaitingChange } from "./offline-line";
import { formatTimeOfDay } from "./time-format";
import { useMinuteTick } from "./use-minute-tick";

type PillProps = {
  data: NowNext;
  parts: NowNextParts;
  onOpen: (item: NowNextItem) => void;
};

export function NowNextPill({ data, parts, onOpen }: PillProps) {
  const { now, next } = data;
  const target = now ?? next;
  if (!parts.pill || !target) return null;
  return (
    <button
      type="button"
      data-now-next
      onClick={() => onOpen(target)}
      aria-label={pillLabel(data)}
      className="inline-flex h-(--ctrl-h) min-w-0 max-w-full items-center gap-2 overflow-hidden whitespace-nowrap rounded-md bg-tag-chip-surface pl-2.5 pr-1.5 text-sm text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-active-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {now ? (
        <NowParts now={now} next={next} parts={parts} />
      ) : (
        <NextParts next={target} parts={parts} />
      )}
    </button>
  );
}

function NowParts({
  now,
  next,
  parts,
}: {
  now: NowNextItem;
  next: NowNextItem | null;
  parts: NowNextParts;
}) {
  return (
    <>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
      <span className="min-w-0 truncate font-medium text-foreground">{now.title}</span>
      {parts.until ? (
        <span className="shrink-0 text-subtle-foreground">until {formatTimeOfDay(now.endMs)}</span>
      ) : null}
      {parts.then && next ? (
        <span className="flex min-w-0 shrink items-center gap-1.5 border-l border-hairline pl-2">
          <span className="shrink-0 text-subtle-foreground">then</span>
          <span className="min-w-0 truncate">
            {next.title} {formatTimeOfDay(next.startMs)}
          </span>
        </span>
      ) : null}
      {parts.key && now.joinUrl ? <Kbd className="shrink-0">⇧⌘J</Kbd> : null}
    </>
  );
}

function NextParts({ next, parts }: { next: NowNextItem; parts: NowNextParts }) {
  return (
    <>
      <span className="shrink-0 text-subtle-foreground">Next</span>
      <span className="min-w-0 truncate font-medium text-foreground">{next.title}</span>
      {parts.until ? (
        <span className="shrink-0 text-subtle-foreground">{formatTimeOfDay(next.startMs)}</span>
      ) : null}
    </>
  );
}

function pillLabel({ now, next }: NowNext): string {
  const then = next ? `, then ${next.title} at ${formatTimeOfDay(next.startMs)}` : "";
  if (now) {
    const join = now.joinUrl ? ". Join with Shift Command J" : "";
    return `Now: ${now.title} until ${formatTimeOfDay(now.endMs)}${then}${join}`;
  }
  return next ? `Next: ${next.title} at ${formatTimeOfDay(next.startMs)}` : "";
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine !== false,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** Width of an element, kept current. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

type Props = {
  /** The events on show (hidden calendars already left out). */
  events: readonly CalendarEventModel[];
  /** Opens the meeting the pill names. */
  onOpen: (item: NowNextItem) => void;
  /** Offline: the changes waiting to sync (the offline line counts them). */
  waiting?: readonly WaitingChange[];
};

const NO_WAITING: readonly WaitingChange[] = [];

/** Today's now and next, fitted into the toolbar's free room. */
export function CalendarNowNext({ events, onOpen, waiting = NO_WAITING }: Props) {
  const nowMs = useMinuteTick();
  const online = useOnline();
  const [ref, width] = useWidth<HTMLDivElement>();
  const todayKey = localDayKey(new Date(nowMs));

  // The day's list only changes with the events or when the day turns.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => nowNextItems(events, nowMs), [events, todayKey]);

  const data = online ? nowAndNext(items, nowMs) : null;
  const joinUrl = data?.now?.joinUrl ?? null;

  useAppHotkeys({
    "calendar.join": () => {
      if (!joinUrl) return false;
      window.open(joinUrl, "_blank", "noopener,noreferrer");
    },
  });

  return (
    <div ref={ref} className={cn("flex min-w-0 flex-1 items-center")}>
      {!online ? (
        <OfflineLine waiting={waiting} />
      ) : data ? (
        <NowNextPill data={data} parts={nowNextParts(width)} onOpen={onOpen} />
      ) : null}
    </div>
  );
}
