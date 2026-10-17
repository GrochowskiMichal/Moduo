// Dependencies on the Timeline (Tasks v3 TV-TL2, REPLAN 70, 68b): which
// "waits on" lines to draw, how each runs, the dates that contradict one, and
// who waits on a task that just moved. Pure: no React, no IO.
//
// - Lines show for the selected or hovered task only, or for every task on
//   screen with Display → Dependencies → All (70).
// - A line never shows a task the reader can't see: a relation whose other end
//   isn't in the reader's copy draws nothing (a hidden blocker can't be told
//   apart from a deleted one there, so it never reads as "Private item").
// - A finished blocker draws no line unless Show done shows it (68b).
// - A task due before something it waits on is shown, never prevented (68b):
//   its line runs backwards in the late tone, the task carries a quiet mark,
//   and one click offers the day after the blocker. Nothing moves by itself.

import { isClosedTask, isOpenTask } from "@contracts/vocabularies";

import type { Task, TaskRelation } from "./model";
import { dueDayOf } from "./timeline-rows";

/** Display → Dependencies (REPLAN 71). */
export type TimelineDeps = "off" | "selected" | "all";

export function isTimelineDeps(value: unknown): value is TimelineDeps {
  return value === "off" || value === "selected" || value === "all";
}

/** One "waits on" line: the blocker comes first. */
export type DepEdge = { blockerId: string; blockedId: string };

/**
 * The lines to draw: relations whose both ends the reader has and Display
 * shows, around `focus` (the selected and hovered tasks), or all of them.
 */
export function depEdges(
  relations: readonly TaskRelation[],
  byId: ReadonlyMap<string, Task>,
  mode: TimelineDeps,
  focus: ReadonlySet<string>,
  isHidden: (task: Task) => boolean,
): DepEdge[] {
  if (mode === "off") return [];
  if (mode === "selected" && focus.size === 0) return [];
  const out: DepEdge[] = [];
  const seen = new Set<string>();
  for (const rel of relations) {
    const blocker = byId.get(rel.blockerTaskId);
    const blocked = byId.get(rel.blockedTaskId);
    if (!blocker || !blocked || blocker.deletedAt || blocked.deletedAt) continue;
    if (mode === "selected" && !focus.has(blocker.id) && !focus.has(blocked.id)) continue;
    if (isHidden(blocker) || isHidden(blocked)) continue;
    const key = `${blocker.id}>${blocked.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ blockerId: blocker.id, blockedId: blocked.id });
  }
  return out;
}

/** A task due before something it waits on (68b). */
export type Contradiction = {
  blockerId: string;
  blockerTitle: string;
  /** The blocker's due day (the latest one, when several contradict). */
  blockerDay: number;
  /** "Move to …": the day after the blocker. */
  moveTo: number;
};

/**
 * Every open task due before an open task it waits on, with the latest such
 * blocker. Only tasks the reader has; a finished blocker no longer holds
 * anything up.
 */
export function contradictions(
  relations: readonly TaskRelation[],
  byId: ReadonlyMap<string, Task>,
): Map<string, Contradiction> {
  const out = new Map<string, Contradiction>();
  for (const rel of relations) {
    const blocker = byId.get(rel.blockerTaskId);
    const blocked = byId.get(rel.blockedTaskId);
    if (!blocker || !blocked || blocker.deletedAt || blocked.deletedAt) continue;
    if (!isOpenTask(blocker) || !isOpenTask(blocked)) continue;
    const before = dueDayOf(blocked);
    const after = dueDayOf(blocker);
    if (before === null || after === null || before >= after) continue;
    const current = out.get(blocked.id);
    if (current && current.blockerDay >= after) continue;
    out.set(blocked.id, {
      blockerId: blocker.id,
      blockerTitle: blocker.title || "Untitled",
      blockerDay: after,
      moveTo: after + 1,
    });
  }
  return out;
}

/**
 * The open, dated tasks that wait on the ones just moved (and weren't moved
 * with them): "Also move the 3 that wait on this" (70). Never moved silently.
 */
export function waitingOn(
  movedIds: ReadonlySet<string>,
  relations: readonly TaskRelation[],
  byId: ReadonlyMap<string, Task>,
): Task[] {
  const out = new Map<string, Task>();
  for (const rel of relations) {
    if (!movedIds.has(rel.blockerTaskId) || movedIds.has(rel.blockedTaskId)) continue;
    const task = byId.get(rel.blockedTaskId);
    if (!task || task.deletedAt || isClosedTask(task)) continue;
    if (dueDayOf(task) === null && !task.scheduledAt) continue;
    out.set(task.id, task);
  }
  return [...out.values()];
}

/** "the 3 that wait on this", "the one that waits on these". */
export function waitingWords(count: number, movedCount: number): string {
  const what = movedCount === 1 ? "this" : "these";
  return count === 1
    ? `Also move the one that waits on ${what}`
    : `Also move the ${count} that wait on ${what}`;
}

// ── How a line runs ──────────────────────────────────────────────────────────

/** Where a point sits on the canvas, its middle (px in the frame). */
export type At = { x: number; y: number };

export type EdgeShape = {
  /** The line, as an SVG path. */
  d: string;
  /** Its arrowhead, a small closed triangle at the waiting task. */
  head: string;
  /** The waiting task is due before its blocker (68b: the late tone). */
  backwards: boolean;
};

/** Half a point, plus a hairline: lines start and end at a point's edge. */
const R = 7;
/** How far a line leaves its point sideways before it turns. */
const STEP = 8;

function head(tip: At, dir: 1 | -1): string {
  const back = tip.x - dir * 5;
  return `M${tip.x} ${tip.y}L${back} ${tip.y - 3.5}L${back} ${tip.y + 3.5}Z`;
}

/**
 * A short, direct path from a blocker's point to its waiting task's (68a's
 * visual pass): out to the right, down or up to the other row, in. When the
 * waiting task is due first the line comes back into it from the right
 * (backwards, 68b); on the same day it's a short hook on the right.
 */
export function edgeShape(from: At, to: At): EdgeShape {
  const sx = from.x + R;
  if (to.x - R - sx >= STEP * 2) {
    // Forward: turn halfway, so two lines from one blocker share their stem.
    const mid = Math.round(sx + Math.min(STEP * 2, (to.x - R - sx) / 2));
    const tip = { x: to.x - R, y: to.y };
    return {
      d: `M${sx} ${from.y}H${mid}V${to.y}H${tip.x}`,
      head: head(tip, 1),
      backwards: false,
    };
  }
  // Too close to turn in between, the same day, or backwards: a hook on the
  // right of both points, coming into the waiting one from the right.
  const right = Math.max(sx, to.x + R) + STEP;
  const tip = { x: to.x + R, y: to.y };
  return {
    d: `M${sx} ${from.y}H${right}V${to.y}H${tip.x}`,
    head: head(tip, -1),
    backwards: to.x < from.x,
  };
}
