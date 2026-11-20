// The listener, seen from above: a head drawn as contour lines (like a terrain
// map), ears at the sides and a hint of a nose pointing to the front, over
// shoulders that spread out below. The paths are computed once.

import type { CSSProperties } from "react";

function arc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from: number,
  to: number,
  wobble: number,
  phase: number,
  steps: number,
) {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    const w = 1 + wobble * Math.sin(3 * t + phase) + wobble * 0.6 * Math.sin(5 * t - phase * 1.7);
    d += `${i ? "L" : "M"}${(cx + Math.cos(t) * rx * w).toFixed(1)} ${(cy + Math.sin(t) * ry * w).toFixed(1)}`;
  }
  return d;
}

function buildPaths() {
  const shoulders = ["", "", ""];
  for (let k = 0; k < 18; k++) {
    shoulders[k < 6 ? 0 : k < 12 ? 1 : 2] +=
      `${arc(0, 20 + k * 0.9, 46 + k * 4.7, 24 + k * 2.3, -14, 194, 0.022 + k * 0.001, k * 0.7, 64)} `;
  }
  const head = ["", "", ""];
  for (let j = 1; j < 15; j++) {
    head[j < 5 ? 0 : j < 10 ? 1 : 2] +=
      `${arc(0, -6 - j * 0.8, 31 - j * 2.05, 37 - j * 2.45, 0, 360, 0.008, j, 72)} `;
  }
  const edge = arc(0, -6, 31, 37, 0, 360, 0, 0, 96);
  const ears = `${arc(-31.5, -4, 3.4, 7.8, 0, 360, 0, 0, 24)} ${arc(31.5, -4, 3.4, 7.8, 0, 360, 0, 0, 24)} M-4.5 -42.6 Q0 -48.5 4.5 -42.6`;
  return { shoulders, head, edge, ears };
}

const PATHS = buildPaths();

/** Stroke weights stay hairline whatever size the figure is drawn at. */
const LINE = "fill-none stroke-foreground [stroke-width:0.7px] [vector-effect:non-scaling-stroke]";

export function HeadFigure({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="-130 -130 260 260" aria-hidden className={className} style={style}>
      <path className={`${LINE} opacity-10`} d={PATHS.shoulders[2]} />
      <path className={`${LINE} opacity-20`} d={PATHS.shoulders[1]} />
      <path className={`${LINE} opacity-35`} d={PATHS.shoulders[0]} />
      <path className="fill-card stroke-none" d={`${PATHS.edge}Z`} />
      <path className={`${LINE} opacity-50`} d={PATHS.ears} />
      <path className={`${LINE} opacity-15`} d={PATHS.head[2]} />
      <path className={`${LINE} opacity-30`} d={PATHS.head[1]} />
      <path className={`${LINE} opacity-50`} d={PATHS.head[0]} />
      <path className={`${LINE} opacity-80`} d={PATHS.edge} />
    </svg>
  );
}
