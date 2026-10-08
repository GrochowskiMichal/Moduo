// Priority + energy as ambient, NEVER-accent glyphs (spec principles 4-5; accent
// policy keeps these neutral). Both read the level at a glance by COUNT alone —
// only the filled units render, no ghost placeholders (Morgen-style). The count
// IS the level, so the footprint is variable but the read is instant:
//   Priority — 1-3 dots, a centered row (low 1 → high 3).
//   Energy   — 1-3 bars, stacked bottom-up (low 1 → high 3).

import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import { ENERGY_LABELS, PRIORITY_LABELS } from "../helpers";
import type { EnergyLevel, PriorityLevel, Task } from "../model";

const LEVEL_COUNT: Record<string, number> = { low: 1, med: 2, high: 3 };

export function PriorityIcon({ level, className }: { level: PriorityLevel; className?: string }) {
  const n = LEVEL_COUNT[level] ?? 0;
  if (n === 0) return null;
  // Only the filled dots show — the count is the level. Centered horizontally so
  // 1 / 2 / 3 each read as deliberate rather than a fragment of a fixed grid.
  const cxs = n === 1 ? [8] : n === 2 ? [5.5, 10.5] : [3, 8, 13];
  return (
    <svg viewBox="0 0 16 16" className={cn("size-icon", className)} fill="currentColor" aria-hidden>
      {cxs.map((cx, i) => (
        <circle key={i} cx={cx} cy={8} r="2.2" />
      ))}
    </svg>
  );
}

export function EnergyIcon({ level, className }: { level: EnergyLevel; className?: string }) {
  const n = LEVEL_COUNT[level] ?? 0;
  if (n === 0) return null;
  // Only the filled bars show, stacked from the bottom up (mirrors PriorityIcon).
  const ys = [11, 6.75, 2.5]; // bottom → top; render the first n
  return (
    <svg viewBox="0 0 16 16" className={cn("size-icon", className)} fill="currentColor" aria-hidden>
      {ys.slice(0, n).map((y, i) => (
        <rect key={i} x="3" y={y} width="10" height="2.5" rx="1.25" />
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
            <span
              className="flex items-center"
              aria-label={`Priority: ${PRIORITY_LABELS[task.priority]}`}
            >
              <PriorityIcon level={task.priority} />
            </span>
          </TooltipTrigger>
          <TooltipContent>Priority: {PRIORITY_LABELS[task.priority]}</TooltipContent>
        </Tooltip>
      ) : null}
      {task.energyLevel ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="flex items-center"
              aria-label={`Energy: ${ENERGY_LABELS[task.energyLevel]}`}
            >
              <EnergyIcon level={task.energyLevel} />
            </span>
          </TooltipTrigger>
          <TooltipContent>Energy: {ENERGY_LABELS[task.energyLevel]}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
