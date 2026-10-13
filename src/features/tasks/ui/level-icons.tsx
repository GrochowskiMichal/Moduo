// Priority + energy as ambient, NEVER-accent glyphs (spec principles 4-5; the
// accent policy keeps these neutral). Both have a fixed footprint: three bars
// are always drawn and the level is read by fill, the unfilled ones staying as
// faint ghosts (tasks-v2 §6, U7). The footprint never changes, so the glyphs
// line up down a column and "low" can't read as a stray mark.
//   Priority — three bars rising left to right (low 1 → high 3).
//   Energy   — three bars stacked bottom-up (low 1 → high 3).

import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import { ENERGY_LABELS, PRIORITY_LABELS } from "../helpers";
import type { EnergyLevel, PriorityLevel } from "../model";

/** How many bars a level fills. Typed by the vocabulary, so a new level can't
 * silently render as zero bars (the old map's "med" key never matched "medium"). */
const LEVEL_FILL: Record<PriorityLevel & EnergyLevel, 1 | 2 | 3> = {
  low: 1,
  medium: 2,
  high: 3,
};

const PRIORITY_BARS = [
  { x: 2, y: 9, height: 5 },
  { x: 6.5, y: 6, height: 8 },
  { x: 11, y: 3, height: 11 },
] as const;

const ENERGY_BARS = [11, 6.75, 2.5] as const; // bottom → top

/** Priority: three rising bars, `level` of them filled. Null level = all ghosts. */
export function PriorityIcon({
  level,
  className,
}: {
  level: PriorityLevel | null;
  className?: string;
}) {
  const filled = level ? LEVEL_FILL[level] : 0;
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("size-icon-sm shrink-0", className)}
      fill="currentColor"
      aria-hidden
      data-level={filled}
    >
      {PRIORITY_BARS.map((bar, i) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={bar.y}
          width="3"
          height={bar.height}
          rx="1"
          className={i < filled ? undefined : "opacity-25"}
        />
      ))}
    </svg>
  );
}

/** Energy: three stacked bars, filled from the bottom. Null level = all ghosts. */
export function EnergyIcon({
  level,
  className,
}: {
  level: EnergyLevel | null;
  className?: string;
}) {
  const filled = level ? LEVEL_FILL[level] : 0;
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("size-icon-sm shrink-0", className)}
      fill="currentColor"
      aria-hidden
      data-level={filled}
    >
      {ENERGY_BARS.map((y, i) => (
        <rect
          key={y}
          x="3"
          y={y}
          width="10"
          height="2.5"
          rx="1.25"
          className={i < filled ? undefined : "opacity-25"}
        />
      ))}
    </svg>
  );
}

/** A row's or card's priority glyph with its tooltip; nothing when unset. */
export function PriorityMark({ level }: { level: PriorityLevel | null }) {
  if (!level) return null;
  const label = PRIORITY_LABELS[level];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center text-muted-foreground" role="img" aria-label={label}>
          <PriorityIcon level={level} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** A row's or card's energy glyph with its tooltip; nothing when unset. */
export function EnergyMark({ level }: { level: EnergyLevel | null }) {
  if (!level) return null;
  const label = ENERGY_LABELS[level];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center text-muted-foreground" role="img" aria-label={label}>
          <EnergyIcon level={level} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
