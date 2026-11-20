// Free time with teammates (CALR-16, specs/calendar-rethink.md AC19, §Scheduling
// "With a teammate"): named teammates' busy time joins yours for ⇥ and the
// opening slot, and the echo gives each one's verdict. Your clash stays yours.

import type { ComposerBusy } from "./composer/parse";
import type { TeammateBlock } from "./teammates";

export type Verdict = "free" | "busy" | "focus" | "unknown";

const nextDay = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
};

/** The named teammates' blocks on a day (by its local midnight). */
export const teammateBusyOn =
  (blocks: TeammateBlock[], ids: string[]) =>
  (dayStartMs: number): ComposerBusy[] =>
    blocks
      .filter(
        (b) => ids.includes(b.ownerId) && b.startMs < nextDay(dayStartMs) && b.endMs > dayStartMs,
      )
      .map((b) => ({ startMs: b.startMs, endMs: b.endMs, title: b.title ?? "Busy" }));

/** Your busy time and every named teammate's, for the hops. */
export function freeForAll(
  ownBusy: (dayStartMs: number) => ComposerBusy[],
  blocks: TeammateBlock[],
  ids: string[],
): (dayStartMs: number) => ComposerBusy[] {
  const theirs = teammateBusyOn(blocks, ids);
  return (day) => [...ownBusy(day), ...theirs(day)];
}

export function verdictFor(
  blocks: TeammateBlock[],
  id: string,
  startMs: number,
  endMs: number,
  shares: boolean,
): Verdict {
  if (!shares) return "unknown";
  const hit = blocks.filter((b) => b.ownerId === id && b.startMs < endMs && b.endMs > startMs);
  if (hit.some((b) => b.kind !== "focus")) return "busy";
  return hit.length > 0 ? "focus" : "free";
}

export function verdictLine(name: string, verdict: Verdict): string {
  if (verdict === "unknown") return `${name} doesn't share their calendar`;
  return `${name} is ${verdict === "focus" ? "in focus time" : verdict}`;
}

export const verdictsEcho = (list: { name: string; verdict: Verdict }[]): string =>
  list.map((v) => verdictLine(v.name, v.verdict)).join(" · ");
