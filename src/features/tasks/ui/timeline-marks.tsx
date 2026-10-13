// What the Timeline draws on a row's track (TV-TL1, REPLAN 68, 68a, 69): a
// task's point, a section's band and diamond, a project's slim bar with its
// sections as segments and the 2 px progress line, session ticks, repeat
// ghosts, and the month and today lines a sticky row carries over its opaque
// surface. Positions come from the shared geometry (`TimelineGeometry`); the
// pieces take day numbers, never pixels.
//
// TV-TL2's seam: every mark carries `data-timeline-mark` (point · diamond ·
// bar · band) and the ids it moves (`data-task-id`, `data-section-id`,
// `data-project-id`), so a drag finds what it grabbed without new markup.

import { CircleCheck, Repeat } from "lucide-react";
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";

import { normalizeLabelColor } from "../../../components/tag-colors";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { formatDate } from "../../../lib/time-format";
import { cn } from "../../../lib/utils";
import type { TimelineColorBy } from "../display";
import type { RecurrenceRule } from "../model";
import { engineZone, occurrencesBetween } from "../recurrence-engine";
import type { DaySpan, ProjectBar, TimelinePoint } from "../timeline-rows";
import {
  dateOfDay,
  dayCenterX,
  dayNumOfDate,
  monthLines,
  strongLines,
  type TimelineRange,
  type TimelineZoom,
  xOfDay,
} from "../timeline-scale";

// ── Shared geometry ──────────────────────────────────────────────────────────

export type TimelineGeometry = {
  range: TimelineRange;
  /** Pixels per day. */
  dw: number;
  zoom: TimelineZoom;
  /** Today's day number. */
  today: number;
  colorBy: TimelineColorBy;
  /** ⇧[ hid the name column: titles sit right of their marks. */
  nameHidden: boolean;
};

export const TimelineGeometryContext = createContext<TimelineGeometry>({
  range: { start: 0, days: 1 },
  dw: 24,
  zoom: "month",
  today: 0,
  colorBy: "none",
  nameHidden: false,
});

/** The days drawn around the visible ones (header, ghosts, lines). */
export const TimelineWindowContext = createContext<{ from: number; to: number }>({
  from: 0,
  to: 0,
});

export function useTimelineGeometry(): TimelineGeometry {
  return useContext(TimelineGeometryContext);
}

type DaysOnScreen = { from: number; to: number };

/**
 * The whole days on screen now, as a store the off-screen hints subscribe to:
 * the view sets it on every scroll frame, and only a hint whose side flips
 * redraws (never the view or its rows).
 */
export type ViewportStore = {
  get: () => DaysOnScreen;
  set: (next: DaysOnScreen) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createViewportStore(initial: DaysOnScreen): ViewportStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (next.from === value.from && next.to === value.to) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const EVERYTHING_ON_SCREEN = createViewportStore({
  from: Number.NEGATIVE_INFINITY,
  to: Number.POSITIVE_INFINITY,
});

export const TimelineViewportContext = createContext<ViewportStore>(EVERYTHING_ON_SCREEN);

/**
 * A row whose mark is off to one side says so at that edge (research §3:
 * "off-screen arrows with dates"): "‹ Oct 2" or "Nov 30 ›", quiet, and a
 * click scrolls there. So ↑↓ never drags the canvas sideways under you.
 */
export function OffscreenHint({
  start,
  end,
  onGo,
}: {
  /** The mark's first and last day (a point: the same day). */
  start: number;
  end: number;
  onGo: (day: number) => void;
}) {
  const viewport = useContext(TimelineViewportContext);
  // -1: off to the left, 1: off to the right, 0: on screen (a number, so the
  // hint redraws only when its side changes).
  const side = useSyncExternalStore(viewport.subscribe, () => {
    const shown = viewport.get();
    return end < shown.from ? -1 : start > shown.to ? 1 : 0;
  });
  const before = side < 0;
  const after = side > 0;
  if (!before && !after) return null;
  const day = before ? end : start;
  const label = formatDate(dateOfDay(day));
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-between">
      <span
        className={cn(before ? "sticky" : "invisible")}
        style={{ left: "calc(var(--timeline-name-w) + 0.375rem)" }}
      >
        {before ? <HintButton label={`‹ ${label}`} onClick={() => onGo(day)} /> : null}
      </span>
      <span className={cn(after ? "sticky right-1.5" : "invisible")}>
        {after ? <HintButton label={`${label} ›`} onClick={() => onGo(day)} /> : null}
      </span>
    </div>
  );
}

function HintButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      data-timeline-hint=""
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="pointer-events-auto rounded-sm px-1 font-sans text-2xs whitespace-nowrap tabular-nums text-subtle-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-foreground"
    >
      {label}
    </button>
  );
}

// ── A task's point ───────────────────────────────────────────────────────────

/** How a point is coloured when Colour by asks (REPLAN 71). */
export type PointTone = {
  /** The project's hue (Colour by project). */
  hue: string | null;
  /** The task's status category (Colour by status). */
  category: string;
};

const POINT =
  "absolute top-1/2 size-icon-xs -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card";

/**
 * A task: a 12 px circle in the middle of its due day (68). Hollow on its
 * next session when it has only sessions; the muted late tone when late
 * (never red, 23); the done check when done is shown; Won't do hollow and
 * quiet. The selected one is the strongest mark on the canvas.
 */
export function TaskPointMark({
  point,
  taskId,
  tone,
  selected,
  label,
}: {
  point: TimelinePoint;
  taskId: string;
  tone: PointTone;
  selected: boolean;
  /** What a hover says: "Due Wed, Oct 14 · late". */
  label: string;
}) {
  const { range, dw, colorBy } = useTimelineGeometry();
  const left = dayCenterX(range, dw, point.day);
  const done = point.closed && tone.category === "done";
  const fill = done
    ? null
    : point.closed
      ? "border border-subtle-foreground bg-card"
      : point.kind === "session"
        ? "border border-muted-foreground bg-card"
        : selected
          ? "bg-foreground"
          : point.late
            ? "bg-timeline-late"
            : colorBy === "status"
              ? statusFill(tone.category)
              : colorBy === "project" && tone.hue
                ? "tag-dot"
                : "bg-muted-foreground";
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-timeline-mark="point"
            data-task-id={taskId}
            data-late={point.late || undefined}
            data-label={!done && colorBy === "project" && tone.hue ? tone.hue : undefined}
            aria-hidden
            className={cn(
              POINT,
              fill,
              done && "flex items-center justify-center bg-card text-primary",
              selected && "shadow-[0_0_0_2px_var(--card),0_0_0_4px_var(--timeline-outline)] ring-0",
            )}
            style={{ left }}
          >
            {done ? <CircleCheck className="size-icon-xs" aria-hidden /> : null}
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      {point.repeat ? (
        <Repeat
          aria-hidden
          className="pointer-events-none absolute top-1/2 size-icon-xs -translate-y-1/2 text-subtle-foreground"
          style={{ left: left + 9 }}
        />
      ) : null}
    </>
  );
}

function statusFill(category: string): string {
  if (category === "in_progress") return "bg-foreground";
  if (category === "backlog") return "bg-subtle-foreground";
  return "bg-muted-foreground";
}

/** Show sessions: a task's other work sessions, as small hollow ticks. */
export function SessionTicks({ days }: { days: readonly number[] }) {
  const { range, dw } = useTimelineGeometry();
  return days.map((day) => (
    <span
      key={day}
      aria-hidden
      className="pointer-events-none absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-muted-foreground"
      style={{ left: dayCenterX(range, dw, day) }}
    />
  ));
}

/**
 * Show repeats: the coming occurrences of a repeat, as ghost points you can't
 * drag (research §2), only within the drawn days.
 */
export function RepeatGhosts({
  recurrence,
  createdAt,
  skipDay,
}: {
  recurrence: RecurrenceRule;
  createdAt: string;
  /** The current occurrence (drawn as the real point). */
  skipDay: number | null;
}) {
  const { range, dw } = useTimelineGeometry();
  const drawn = useContext(TimelineWindowContext);
  const days = useMemo(() => {
    const from = dateOfDay(Math.max(drawn.from, skipDay ?? drawn.from));
    const to = dateOfDay(drawn.to);
    return occurrencesBetween(recurrence, from, to, createdAt, engineZone(), 60)
      .map((d) => dayNumOfDate(d))
      .filter((day) => day !== skipDay);
  }, [recurrence, createdAt, drawn.from, drawn.to, skipDay]);
  return days.map((day) => (
    <span
      key={day}
      data-timeline-mark="ghost"
      aria-hidden
      className="pointer-events-none absolute top-1/2 size-icon-xs -translate-x-1/2 -translate-y-1/2 rounded-full border border-timeline-outline"
      style={{ left: dayCenterX(range, dw, day) }}
    />
  ));
}

// ── Sections ─────────────────────────────────────────────────────────────────

/** A section's range: a faint band on its row and behind its tasks (68a). */
export function SectionBand({ band, sectionId }: { band: DaySpan; sectionId: string | null }) {
  const { range, dw } = useTimelineGeometry();
  const left = xOfDay(range, dw, band.start);
  return (
    <span
      data-timeline-mark="band"
      data-section-id={sectionId ?? undefined}
      aria-hidden
      className="pointer-events-none absolute inset-y-0 bg-timeline-band"
      style={{ left, width: (band.end - band.start + 1) * dw }}
    />
  );
}

const DIAMOND_PATH = "M7 1 13 7 7 13 1 7Z";

/** A section with only an end date: a diamond on that day, on its own row (68a). */
export function SectionDiamond({
  day,
  sectionId,
  label,
  small = false,
}: {
  day: number;
  sectionId: string;
  label: string;
  /** On a folded project's bar. */
  small?: boolean;
}) {
  const { range, dw } = useTimelineGeometry();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <svg
          data-timeline-mark="diamond"
          data-section-id={sectionId}
          viewBox="0 0 14 14"
          strokeWidth={2}
          paintOrder="stroke"
          aria-hidden
          className={cn(
            "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-visible fill-muted-foreground stroke-card",
            small ? "size-2.5" : "size-3.5",
          )}
          style={{ left: dayCenterX(range, dw, day) }}
        >
          <path d={DIAMOND_PATH} />
        </svg>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// ── Projects ─────────────────────────────────────────────────────────────────

/** A segment's label shows only when it fits inside (69). */
function fits(text: string, width: number): boolean {
  return width >= text.length * 6.5 + 18;
}

/**
 * A project's slim bar (68, 69): a neutral fill when both dates are set, an
 * outline when they're worked out from its sections and tasks; a 3 px cap in
 * the project's colour, its ranged sections as segments (named when the name
 * fits), its end-date sections as small diamonds while it's folded, and a
 * 2 px progress line along the bottom. Never taller than ~1.2× a label.
 */
export function ProjectBarMark({
  projectId,
  bar,
  color,
  progress,
  showMilestones,
  muted,
  label,
  milestoneLabel,
}: {
  projectId: string;
  bar: ProjectBar;
  color: string | null;
  progress: { done: number; total: number };
  showMilestones: boolean;
  muted: boolean;
  /** What a hover says: "Oct 1 – Nov 7 · 5 of 12 done". */
  label: string;
  milestoneLabel: (name: string, day: number) => string;
}) {
  const { range, dw } = useTimelineGeometry();
  const left = xOfDay(range, dw, bar.start);
  const width = (bar.end - bar.start + 1) * dw;
  const share = progress.total > 0 ? progress.done / progress.total : 0;
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-timeline-mark="bar"
            data-project-id={projectId}
            data-solid={bar.solid || undefined}
            data-label={normalizeLabelColor(color)}
            aria-hidden
            className={cn(
              // `overflow-clip`, not hidden: it rounds the corners without
              // becoming a scroll box, so a segment's name can stick in view.
              "absolute top-1/2 h-(--ctrl-h-xs) -translate-y-1/2 overflow-clip rounded-sm",
              // Worked out from its work: an outline over the faintest fill, so a
              // bar wider than the screen still reads as a bar, not two lines.
              bar.solid ? "bg-timeline-bar" : "border border-timeline-outline bg-timeline-band",
              muted && "opacity-60",
            )}
            style={{ left, width: Math.max(width, 4) }}
          >
            {bar.segments.map((s) => {
              const segLeft = (s.start - bar.start) * dw;
              // A quiet gap between phases that touch (68a).
              const segWidth = Math.max(1, (s.end - s.start + 1) * dw - 1);
              return (
                <span
                  key={s.sectionId}
                  data-section-id={s.sectionId}
                  className="absolute inset-y-0 flex items-center overflow-clip bg-timeline-segment font-sans text-2xs font-medium whitespace-nowrap text-foreground"
                  style={{ left: segLeft, width: segWidth }}
                >
                  {fits(s.name, segWidth) ? <span className="px-2">{s.name}</span> : null}
                </span>
              );
            })}
            <span className="tag-dot absolute inset-y-0 left-0 z-[1] w-[3px]" />
            {share > 0 ? (
              <span
                className="absolute bottom-0 left-0 z-[1] h-0.5 bg-timeline-progress"
                style={{ width: `${share * 100}%` }}
              />
            ) : null}
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      {showMilestones
        ? bar.milestones.map((m) => (
            <SectionDiamond
              key={m.sectionId}
              day={m.day}
              sectionId={m.sectionId}
              label={milestoneLabel(m.name, m.day)}
              small
            />
          ))
        : null}
    </>
  );
}

// ── Lines a sticky row carries ───────────────────────────────────────────────

/**
 * The month (or year) lines and today's line, drawn inside a row whose
 * surface is opaque because it sticks under the time header: the canvas's
 * own lines run under it.
 */
export function TrackLines() {
  const { range, dw, zoom, today } = useTimelineGeometry();
  const drawn = useContext(TimelineWindowContext);
  const strong = useMemo(() => strongLines(zoom, drawn), [zoom, drawn]);
  const units = useMemo(() => (zoom === "year" ? monthLines(drawn) : []), [zoom, drawn]);
  return (
    <>
      {units.map((day) => (
        <span
          key={`u${day}`}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-timeline-grid"
          style={{ left: xOfDay(range, dw, day) }}
        />
      ))}
      {strong.map((day) => (
        <span
          key={day}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-timeline-grid-strong"
          style={{ left: xOfDay(range, dw, day) }}
        />
      ))}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-primary"
        style={{ left: dayCenterX(range, dw, today) }}
      />
    </>
  );
}
