// Dependencies on the Timeline's canvas (TV-TL2, REPLAN 70, 68b): the "waits
// on" lines (the selected or hovered task's; all of them with Display →
// Dependencies → All), the quiet mark on a task due before something it waits
// on with its one fix, and the stubs for an end the canvas doesn't draw.
//
// The lines sit under the rows (the name column covers them; points sit on
// top), measured from the rows on screen: a row scrolled out of the drawn
// window draws no line (research: lines only for on-screen items). Which
// lines, and which dates contradict, is `timeline-deps.ts`.

import { CornerUpLeft } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "../../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { formatDate } from "../../../lib/time-format";
import { cn } from "../../../lib/utils";
import type { Task, TaskRelation } from "../model";
import {
  type Contradiction,
  depEdges,
  type EdgeShape,
  edgeShape,
  type TimelineDeps,
} from "../timeline-deps";
import { taskRowKey } from "../timeline-rows";
import { dateOfDay, dayCenterX } from "../timeline-scale";
import { TimelineCanvasContext, useHoverTask, usePointDelta } from "./timeline-drag-store";
import { timelineRowDomId, useTimelineGeometry } from "./timeline-marks";

type Drawn = { key: string; shape: EdgeShape; focus: boolean };

/**
 * The lines. `pointDay` is a task's point's day on the canvas (null: no
 * point); the selected tasks' and the hovered one's lines read stronger, and
 * are the only ones drawn unless Display says All.
 */
export function TimelineDepsLayer({
  relations,
  byId,
  mode,
  selected,
  isHidden,
  pointDay,
  nameW,
  bodyRef,
  scrollerRef,
  layoutKey,
}: {
  relations: readonly TaskRelation[];
  /** The reader's tasks: a relation to anything else draws nothing. */
  byId: ReadonlyMap<string, Task>;
  mode: TimelineDeps;
  selected: ReadonlySet<string>;
  /** Display hides this (finished) task. */
  isHidden: (task: Task) => boolean;
  pointDay: (taskId: string) => number | null;
  nameW: number;
  bodyRef: RefObject<HTMLDivElement | null>;
  scrollerRef: RefObject<HTMLDivElement | null>;
  /** Changes whenever rows move (the rows themselves, folds): measure again. */
  layoutKey: unknown;
}) {
  const { range, dw } = useTimelineGeometry();
  const canvas = useContext(TimelineCanvasContext);
  const hovered = useHoverTask();
  const focus = useMemo(() => {
    if (!hovered || selected.has(hovered)) return selected;
    return new Set([...selected, hovered]);
  }, [selected, hovered]);
  const edges = useMemo(
    () => depEdges(relations, byId, mode, focus, isHidden),
    [relations, byId, mode, focus, isHidden],
  );
  const [drawn, setDrawn] = useState<Drawn[]>([]);

  const measure = useCallback(() => {
    const body = bodyRef.current;
    if (!body || edges.length === 0) {
      setDrawn((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const top = body.getBoundingClientRect().top;
    const drag = canvas.getDrag();
    const shift = (id: string) => (drag?.kind === "point" && drag.taskIds.has(id) ? drag.delta : 0);
    const at = (id: string) => {
      const day = pointDay(id);
      if (day === null) return null;
      const row = document.getElementById(timelineRowDomId(taskRowKey(id)));
      if (!row) return null;
      const rect = row.getBoundingClientRect();
      return {
        x: nameW + dayCenterX(range, dw, day + shift(id)),
        y: rect.top - top + rect.height / 2,
      };
    };
    const next: Drawn[] = [];
    for (const edge of edges) {
      const from = at(edge.blockerId);
      const to = at(edge.blockedId);
      if (!from || !to) continue;
      next.push({
        key: `${edge.blockerId}>${edge.blockedId}`,
        shape: edgeShape(from, to),
        focus: focus.has(edge.blockerId) || focus.has(edge.blockedId),
      });
    }
    setDrawn(next);
  }, [bodyRef, edges, pointDay, nameW, range, dw, focus, canvas]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the rows moving is the cue
  useLayoutEffect(() => {
    measure();
  }, [measure, layoutKey]);

  // Scrolling draws other rows (virtualized), and a drag moves points.
  const frame = useRef(0);
  useEffect(() => {
    const later = () => {
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        measure();
      });
    };
    const el = scrollerRef.current;
    el?.addEventListener("scroll", later, { passive: true });
    // Only a drag moves points (a hover's ghost or task redraws through props).
    let drag = canvas.getDrag();
    const off = canvas.subscribe(() => {
      const next = canvas.getDrag();
      if (next === drag) return;
      drag = next;
      later();
    });
    return () => {
      el?.removeEventListener("scroll", later);
      off();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [measure, scrollerRef, canvas]);

  if (drawn.length === 0) return null;
  return (
    <svg
      aria-hidden
      data-timeline-deps=""
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      {drawn.map(({ key, shape, focus: strong }) => (
        <g
          key={key}
          data-timeline-dep={key}
          data-backwards={shape.backwards || undefined}
          className={cn(
            shape.backwards
              ? "fill-timeline-late stroke-timeline-late"
              : strong
                ? "fill-muted-foreground stroke-muted-foreground"
                : "fill-timeline-outline stroke-timeline-outline",
          )}
        >
          <path
            d={shape.d}
            fill="none"
            strokeWidth={1.25}
            strokeDasharray={shape.backwards ? "3 2" : undefined}
          />
          <path d={shape.head} strokeWidth={0} />
        </g>
      ))}
    </svg>
  );
}

/**
 * A task due before something it waits on (68b): a quiet mark left of its
 * point in the late tone. Hover says why; a click offers the day after the
 * blocker ("Move to Nov 8"), for someone who can edit. Nothing moves by itself.
 */
export function ContradictionMark({
  taskId,
  day,
  contradiction,
  editable,
  onMove,
  openByKey = false,
  onKeyClose,
}: {
  taskId: string;
  /** The task's point's day. */
  day: number;
  contradiction: Contradiction;
  editable: boolean;
  onMove: (day: number) => void;
  /** ⇧L opened it from the keyboard (the mark itself is never a tab stop). */
  openByKey?: boolean;
  /** It closed after ⇧L opened it: the view takes the keyboard back. */
  onKeyClose?: () => void;
}) {
  const { range, dw } = useTimelineGeometry();
  const [clicked, setClicked] = useState(false);
  const open = clicked || openByKey;
  // Closing what ⇧L opened hands the keyboard to the canvas, not to the mark.
  const keyClosing = useRef(false);
  const setOpen = (next: boolean) => {
    setClicked(next);
    if (!next && openByKey) {
      keyClosing.current = true;
      onKeyClose?.();
    }
  };
  // It goes with its point while a drag moves it.
  const delta = usePointDelta(taskId);
  const x = dayCenterX(range, dw, day + delta) - 18;
  const blockerDue = formatDate(dateOfDay(contradiction.blockerDay));
  const moveTo = formatDate(dateOfDay(contradiction.moveTo));
  const why = `Waits on “${contradiction.blockerTitle}”, due ${blockerDue}, after this`;
  const mark = (
    <button
      type="button"
      tabIndex={-1}
      aria-label={why}
      data-timeline-contradiction=""
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="pointer-events-auto absolute top-1/2 z-[2] flex size-icon-xs -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm text-timeline-late transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-muted-foreground"
      style={{ left: x }}
    >
      <CornerUpLeft className="size-icon-xs" aria-hidden />
    </button>
  );
  if (!editable) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{mark}</TooltipTrigger>
        <TooltipContent>{why}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{mark}</PopoverTrigger>
      <PopoverContent
        className="w-64 p-3"
        align="start"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onCloseAutoFocus={(e) => {
          if (!keyClosing.current) return;
          keyClosing.current = false;
          e.preventDefault();
        }}
      >
        <p className="font-sans text-sm text-foreground">{why}.</p>
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setOpen(false);
              onMove(contradiction.moveTo);
            }}
          >
            Move to {moveTo}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The ends of the selected task's lines the canvas doesn't draw (68b): a
 * blocker with no date, in another project, filtered out or folded away:
 * "↗ Website · Fix nav", "Fix nav · no date". Those it waits on sit left of
 * its point; those waiting on it, right.
 */
/** One undrawn end: the other task's id and what the stub says. */
export type DepStub = { id: string; text: string };

export function DepStubs({
  day,
  before,
  after,
}: {
  day: number;
  before: readonly DepStub[];
  after: readonly DepStub[];
}) {
  const { range, dw } = useTimelineGeometry();
  const x = dayCenterX(range, dw, day);
  const chip =
    "rounded-sm bg-card px-1 font-sans text-2xs whitespace-nowrap text-subtle-foreground ring-1 ring-hairline";
  return (
    <>
      {before.length > 0 ? (
        <span
          data-timeline-stubs="before"
          className="pointer-events-none absolute top-1/2 z-[2] flex -translate-x-full -translate-y-1/2 gap-1"
          style={{ left: x - 26 }}
        >
          {before.map((stub) => (
            <span key={stub.id} className={chip}>
              {stub.text}
            </span>
          ))}
        </span>
      ) : null}
      {after.length > 0 ? (
        <span
          data-timeline-stubs="after"
          className="pointer-events-none absolute top-1/2 z-[2] flex -translate-y-1/2 gap-1"
          style={{ left: x + 26 }}
        >
          {after.map((stub) => (
            <span key={stub.id} className={chip}>
              {stub.text}
            </span>
          ))}
        </span>
      ) : null}
    </>
  );
}
