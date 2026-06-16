// Priority + energy as ambient, NEVER-accent glyphs (spec principles 4-5; accent
// policy keeps these neutral). Both read the level at a glance:
//   Priority — dots climbing a pyramid (low 1 → high 3, peak fills last).
//   Energy   — bars stacked bottom-up (low 1 → high 3).
// Unfilled positions stay as faint ghosts so the footprint is constant and the
// filled count = the level. Replaces the old single-dot LevelDots (which didn't
// even distinguish low/med/high).

import { cn } from "../../../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import { ENERGY_LABELS, PRIORITY_LABELS } from "../helpers";
import type { EnergyLevel, PriorityLevel, Task } from "../model";

const LEVEL_COUNT: Record<string, number> = { low: 1, med: 2, high: 3 };
const GHOST = 0.28;

export function PriorityIcon({
  level,
  className,
}: {
  level: PriorityLevel;
  className?: string;
}) {
  const n = LEVEL_COUNT[level] ?? 0;
  // bottom-left, bottom-right, apex — filled in that order (base → peak)
  const dots = [
    { cx: 3, cy: 9, on: n >= 1 },
    { cx: 9, cy: 9, on: n >= 2 },
    { cx: 6, cy: 3.5, on: n >= 3 },
  ];
  return (
    <svg viewBox="0 0 12 12" className={cn("size-icon-sm", className)} fill="currentColor" aria-hidden>
      {dots.map((d, i) => (
        <circle key={i} cx={d.cx} cy={d.cy} r="1.6" opacity={d.on ? 1 : GHOST} />
      ))}
    </svg>
  );
}

export function EnergyIcon({
  level,
  className,
}: {
  level: EnergyLevel;
  className?: string;
}) {
  const n = LEVEL_COUNT[level] ?? 0;
  const bars = [
    { y: 8.4, on: n >= 1 },
    { y: 5.1, on: n >= 2 },
    { y: 1.8, on: n >= 3 },
  ];
  return (
    <svg viewBox="0 0 12 12" className={cn("size-icon-sm", className)} fill="currentColor" aria-hidden>
      {bars.map((b, i) => (
        <rect key={i} x="2" y={b.y} width="8" height="1.8" rx="0.9" opacity={b.on ? 1 : GHOST} />
      ))}
    </svg>
  );
}

/** Ambient priority + energy glyphs with tooltips. Neutral (muted-foreground). */
export function LevelDots({ task }: { task: Task }) {
  if (!task.priority && !task.energyLevel) return null;
  return (
    <div className="flex items-center gap-1 text-muted-foreground">
      {task.priority ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center" aria-label={`Priority: ${PRIORITY_LABELS[task.priority]}`}>
              <PriorityIcon level={task.priority} />
            </span>
          </TooltipTrigger>
          <TooltipContent>Priority: {PRIORITY_LABELS[task.priority]}</TooltipContent>
        </Tooltip>
      ) : null}
      {task.energyLevel ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center" aria-label={`Energy: ${ENERGY_LABELS[task.energyLevel]}`}>
              <EnergyIcon level={task.energyLevel} />
            </span>
          </TooltipTrigger>
          <TooltipContent>Energy: {ENERGY_LABELS[task.energyLevel]}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
