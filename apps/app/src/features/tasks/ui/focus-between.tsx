// The moment between two tasks on the Focus screen (Tasks v3 TV-F8; REPLAN
// 57, 59a, 62, 62a): in the Now card's place, one offer that needs one
// answer, never a standing line.
//  - Along the way: "Before you leave Acme: Send invoice #14 · 5m — Take it ⏎ ·
//    Not now Esc". After three Not-nows on the same task: Shrink · Move · Let go.
//  - Pomodoro's break, once a work block has ended: "Take a 5-minute break ⏎ ·
//    Skip Esc".
// The screen owns the keys (⏎ is the focused button's, Esc the screen's).

import { CornerDownRight } from "lucide-react";
import { useEffect, useRef } from "react";

import type { LabelColor } from "../../../components/tag-colors";
import { Button } from "../../../components/ui/button";
import { Kbd } from "../../../components/ui/kbd";
import { NavRowDot } from "../../../components/ui/nav-row";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { formatDuration } from "../../../lib/time-format";
import { estimateOf, type Task } from "../model";

const OFFER =
  "flex flex-col gap-2 rounded-lg border border-hairline bg-popover px-5 py-4 text-popover-foreground";

/** The along-the-way offer (57): one quick task from the project you're leaving. */
export function AlongTheWayOffer({
  task,
  projectName,
  projectColor,
  ask,
  onTake,
  onNotNow,
  onShrink,
  onMove,
  onLetGo,
}: {
  task: Task;
  projectName: string;
  projectColor: LabelColor;
  /** Three Not-nows already: Shrink · Move · Let go instead of Take it. */
  ask: boolean;
  onTake: () => void;
  onNotNow: () => void;
  onShrink: () => void;
  onMove: () => void;
  onLetGo: () => void;
}) {
  const firstRef = useRef<HTMLButtonElement>(null);
  // The answer starts here: ⏎ is the focused button's (Take it, or Shrink).
  useEffect(() => {
    firstRef.current?.focus({ preventScroll: true });
  }, []);
  const est = estimateOf(task);
  return (
    <section aria-label="Along the way" data-slot="focus-offer" className={OFFER}>
      <p className="flex items-center gap-1.5 font-sans text-xs text-muted-foreground">
        <CornerDownRight className="size-icon-xs shrink-0" aria-hidden />
        <span>Before you leave</span>
        <NavRowDot color={projectColor} className="size-1.5" />
        <span className="min-w-0 break-words text-foreground">{projectName}</span>
      </p>
      <p className="font-sans text-base text-foreground break-words">
        {task.title || "Untitled"}
        {est ? (
          <span className="tabular-nums text-muted-foreground"> · {formatDuration(est)}</span>
        ) : null}
      </p>
      {ask ? (
        <p className="font-sans text-xs text-muted-foreground">
          You’ve passed on this three times. Shrink it, move it out of the way, or let it go?
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {ask ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button ref={firstRef} size="sm" onClick={onShrink}>
                  Shrink
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open it to split off a smaller first step</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="secondary" onClick={onMove}>
                  Move
                </Button>
              </TooltipTrigger>
              <TooltipContent>To Backlog: kept, but out of the way</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="secondary" onClick={onLetGo}>
                  Let go
                </Button>
              </TooltipTrigger>
              <TooltipContent>Mark it Won’t do</TooltipContent>
            </Tooltip>
          </>
        ) : (
          <Button ref={firstRef} size="sm" onClick={onTake}>
            Take it
            <Kbd className="border-primary-foreground/30 bg-transparent text-primary-foreground">
              ⏎
            </Kbd>
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onNotNow}>
          Not now
          <Kbd className="bg-transparent">Esc</Kbd>
        </Button>
      </div>
    </section>
  );
}

/** Pomodoro's break, offered between tasks once a work block has ended (62a). */
export function BreakOffer({
  minutes,
  long,
  onTake,
  onSkip,
}: {
  minutes: number;
  long: boolean;
  onTake: () => void;
  onSkip: () => void;
}) {
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstRef.current?.focus({ preventScroll: true });
  }, []);
  const length = `${Math.max(1, Math.round(minutes))}-minute`;
  return (
    <section aria-label="Break" data-slot="focus-break-offer" className={OFFER}>
      <p className="font-sans text-xs text-muted-foreground">
        {long ? "That’s a few work blocks in a row." : "Work block done."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button ref={firstRef} size="sm" onClick={onTake}>
          Take a {length} {long ? "long break" : "break"}
          <Kbd className="border-primary-foreground/30 bg-transparent text-primary-foreground">
            ⏎
          </Kbd>
        </Button>
        <Button size="sm" variant="ghost" onClick={onSkip}>
          Skip
          <Kbd className="bg-transparent">Esc</Kbd>
        </Button>
      </div>
    </section>
  );
}
