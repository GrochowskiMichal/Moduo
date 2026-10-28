// The composer box (CALR-9, AC16–AC18): one line you type what and when into.
// Words it reads light up as you type (a mirror under a transparent input);
// the echo reads back day · time · calendar · people, then where, then what
// happens (a clash first, with its warning mark; the invite line). ↵ adds,
// ⇥ / ⇧⇥ hop to the next / previous free time, esc cancels.

import { CalendarDays, Focus, MapPin, TriangleAlert, Video } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

import { Kbd } from "../../../components/ui/kbd";
import { FLOATING_SURFACE } from "../../../components/ui/surface";
import { formatWeekdayDate } from "../../../lib/time-format";
import { cn } from "../../../lib/utils";
import type { ComposerPlan } from "../composer/defaults";
import type { ComposerParse, ComposerToken } from "../composer/parse";
import { formatTimeOfDay } from "./time-format";

const PLACEHOLDER = "Lunch with Ana thu 1pm 45m #work";

function Mirror({ text, tokens }: { text: string; tokens: ComposerToken[] }) {
  if (!text) return <span className="text-subtle-foreground">{PLACEHOLDER}</span>;
  const parts: ReactNode[] = [];
  let i = 0;
  for (const t of tokens) {
    if (t.start < i) continue;
    if (t.start > i) parts.push(text.slice(i, t.start));
    parts.push(
      <span
        key={t.start}
        data-token={t.kind}
        className={cn(
          "rounded-sm ring-2",
          t.kind === "person"
            ? "bg-primary/20 ring-primary/20"
            : "bg-state-active-hover ring-state-active-hover",
        )}
      >
        {text.slice(t.start, t.end)}
      </span>,
    );
    i = t.end;
  }
  parts.push(text.slice(i));
  return <>{parts}</>;
}

function lengthLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function andList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export type EventComposerProps = {
  text: string;
  parse: ComposerParse;
  plan: ComposerPlan;
  calendarLabel: string;
  clash: { title: string } | null;
  /** Fixed-position anchor, computed by the host from the draft on the grid. */
  position: { left: number; top: number };
  onText: (text: string) => void;
  onHop: (direction: 1 | -1) => void;
  onCommit: () => void;
  onCancel: () => void;
};

export function EventComposer({
  text,
  parse,
  plan,
  calendarLabel,
  clash,
  position,
  onText,
  onHop,
  onCommit,
  onCancel,
}: EventComposerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const syncScroll = () => {
    if (mirrorRef.current && inputRef.current) {
      mirrorRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  };

  const focus = parse.kind === "focus";
  const minutes = Math.round((parse.endMs - parse.startMs) / 60_000);
  const who = parse.people.map((p) => p.name);
  const google = plan.target.kind === "google";

  return (
    <div
      role="dialog"
      aria-label={focus ? "New focus time" : "New event"}
      data-calendar-composer
      className={cn(FLOATING_SURFACE, "fixed z-(--z-popover) w-120 p-2 shadow-lg")}
      style={{ left: position.left, top: position.top }}
    >
      <div className="flex h-(--ctrl-h-lg) items-center gap-2 rounded-md bg-input px-2.5 ring-1 ring-ring">
        <span className="inline-flex h-(--ctrl-h-xs) shrink-0 items-center gap-1.5 rounded-sm bg-state-active px-2 text-xs font-medium text-foreground">
          {focus ? (
            <Focus aria-hidden className="size-icon-xs" />
          ) : (
            <CalendarDays aria-hidden className="size-icon-xs" />
          )}
          {focus ? "Focus" : "Event"}
        </span>
        <label className="relative h-full min-w-0 flex-1 text-md">
          <span className="sr-only">What and when</span>
          <span
            ref={mirrorRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre text-foreground"
          >
            <Mirror text={text} tokens={parse.tokens} />
          </span>
          <input
            ref={inputRef}
            value={text}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="calendar-composer-echo"
            className="absolute inset-0 w-full bg-transparent text-transparent caret-foreground outline-none"
            onChange={(e) => onText(e.target.value)}
            onScroll={syncScroll}
            onKeyUp={syncScroll}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onCommit();
              } else if (e.key === "Tab") {
                e.preventDefault();
                onHop(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
              }
            }}
          />
        </label>
      </div>

      <div
        id="calendar-composer-echo"
        aria-live="polite"
        className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 pt-2 text-sm text-muted-foreground tabular-nums"
      >
        <span className="text-foreground">{formatWeekdayDate(parse.startMs)}</span>
        <span className="text-subtle-foreground">·</span>
        <span className="text-foreground">
          {formatTimeOfDay(parse.startMs)} – {formatTimeOfDay(parse.endMs)}
        </span>
        {parse.firstFree ? (
          <>
            <span className="text-subtle-foreground">·</span>
            <span>first free {lengthLabel(minutes)}</span>
          </>
        ) : null}
        <span className="text-subtle-foreground">·</span>
        <span>
          {calendarLabel}
          {google ? " (Google)" : ""}
        </span>
        {who.length > 0 && !focus ? (
          <>
            <span className="text-subtle-foreground">·</span>
            <span>with {andList(who)}</span>
          </>
        ) : null}
        {parse.place || plan.linkLine ? (
          <span className="flex basis-full flex-wrap items-center gap-x-3">
            {parse.place ? (
              <span className="inline-flex items-center gap-1">
                <MapPin aria-hidden className="size-icon-xs" />
                {parse.place}
              </span>
            ) : null}
            {plan.linkLine ? (
              <span className="inline-flex items-center gap-1">
                <Video aria-hidden className="size-icon-xs" />
                {plan.linkLine}
              </span>
            ) : null}
          </span>
        ) : null}
        {clash ? (
          <span className="flex basis-full items-center gap-1.5 text-foreground">
            <TriangleAlert aria-hidden className="size-icon-xs text-warning" />
            <span>
              Overlaps your {clash.title || "event"} · <Kbd>⇥</Kbd> finds the next time you're
              free
            </span>
          </span>
        ) : null}
        {plan.inviteLine ? <span className="basis-full">{plan.inviteLine}</span> : null}
      </div>

      <div className="mt-1.5 flex items-center gap-3 border-t border-hairline px-2.5 pt-2 text-xs whitespace-nowrap text-subtle-foreground">
        <span className="inline-flex items-center gap-1">
          <Kbd>↵</Kbd> Add
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>⇥</Kbd> Next free time
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>#</Kbd> Calendar
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>@</Kbd> Person
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>at</Kbd> Place
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          <Kbd>esc</Kbd>
        </span>
      </div>
    </div>
  );
}
