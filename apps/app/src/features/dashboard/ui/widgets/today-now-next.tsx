// The Home Today widget's now-and-next line (CALR-21, specs/calendar-rethink.md
// §Assumptions "Dashboard widget"): the same answer the Calendar toolbar gives
// (CALR-2). Now: "● Legal review with Tom · until 11:15 · then 1:1 with Ana
// 11:30", with Join (⇧⌘J) beside it when the meeting has a link. Nothing on:
// "Next 1:1 with Ana 11:30". The line opens the meeting; Join opens its link.

import { Kbd } from "@/components/ui/kbd";
import type { NowNext, NowNextItem } from "@/features/calendar/now-next";
import { formatTimeOfDay } from "@/features/calendar/ui/time-format";

type Props = {
  /** Today's now and next; null when nothing is on or next. */
  data: NowNext | null;
  /** Opens the meeting the line names. */
  onOpen: (item: NowNextItem) => void;
};

const BUTTON_FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function TodayNowNext({ data, onOpen }: Props) {
  const target = data?.now ?? data?.next ?? null;
  if (!data || !target) return null;
  const { now, next } = data;

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border px-1.5 py-1">
      <button
        type="button"
        onClick={() => onOpen(target)}
        aria-label={lineLabel(data)}
        className={`flex min-h-(--row-h) min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap rounded-md px-2 text-left text-sm text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-accent hover:text-foreground ${BUTTON_FOCUS}`}
      >
        {now ? (
          <>
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="min-w-0 truncate font-medium text-foreground">{now.title}</span>
            <span className="shrink-0 text-subtle-foreground">
              until {formatTimeOfDay(now.endMs)}
            </span>
            {next ? (
              <span className="flex min-w-0 shrink items-center gap-1.5 border-l border-hairline pl-2">
                <span className="shrink-0 text-subtle-foreground">then</span>
                <span className="min-w-0 truncate">
                  {next.title} {formatTimeOfDay(next.startMs)}
                </span>
              </span>
            ) : null}
          </>
        ) : (
          <>
            <span className="shrink-0 text-subtle-foreground">Next</span>
            <span className="min-w-0 truncate font-medium text-foreground">{target.title}</span>
            <span className="shrink-0 text-subtle-foreground">
              {formatTimeOfDay(target.startMs)}
            </span>
          </>
        )}
      </button>
      {now?.joinUrl ? <JoinButton title={now.title} url={now.joinUrl} /> : null}
    </div>
  );
}

function JoinButton({ title, url }: { title: string; url: string }) {
  return (
    <button
      type="button"
      onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
      aria-label={`Join ${title} (Shift Command J)`}
      className={`inline-flex min-h-(--row-h) shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-accent ${BUTTON_FOCUS}`}
    >
      Join
      <Kbd>⇧⌘J</Kbd>
    </button>
  );
}

/** What a screen reader hears for the line (the toolbar pill's words, without Join). */
function lineLabel({ now, next }: NowNext): string {
  const then = next ? `, then ${next.title} at ${formatTimeOfDay(next.startMs)}` : "";
  if (now) return `Now: ${now.title} until ${formatTimeOfDay(now.endMs)}${then}`;
  return next ? `Next: ${next.title} at ${formatTimeOfDay(next.startMs)}` : "";
}
