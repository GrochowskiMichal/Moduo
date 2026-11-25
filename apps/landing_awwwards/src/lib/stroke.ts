// The one shape every graphic on the site is made of: the middle stroke of Moduo's mark
// (`#mk-stroke` in apps/landing, the mark's 1000-unit box). Vertical sides, 44.9° edges,
// rounded acute corners. The mark is three of these, one offset apart, and where two overlap
// the overlap cancels into a window: visible = (left ∪ right) XOR middle (brand brief §3).
//
// A chain is n strokes in a row. Even strokes form layer A, odd strokes layer B, and the chain
// shows A XOR B: with n strokes stacked in one place nothing is visible, and a chain at the
// mark's offset reproduces the mark's windows. Plain functions, safe at build time and in the
// browser.

const MARK_STROKE =
  "M334.245 527.551C334.245 517.385 334.245 512.3 335.395 507.518C336.415 503.278 338.097 499.226 340.38 495.511C342.956 491.32 346.557 487.732 353.756 480.557L552.663 282.348C588.149 246.985 605.894 229.303 621.122 228.125C634.336 227.103 647.24 232.465 655.841 242.552C665.755 254.177 665.755 279.232 665.755 329.341V472.45C665.755 482.617 665.755 487.701 664.605 492.483C663.584 496.723 661.903 500.776 659.62 504.491C657.044 508.681 653.443 512.268 646.244 519.443L447.337 717.653C411.851 753.016 394.106 770.698 378.877 771.876C365.664 772.898 352.76 767.535 344.158 757.449C334.245 745.824 334.245 720.769 334.245 670.66Z";

/** Stroke metrics in mark units. */
export const STROKE = {
  /** Left edge of the middle stroke in the mark box. */
  x0: 334.245,
  /** Width of one stroke. */
  w: 331.51,
  /** The mark's offset between strokes. At this offset a chain looks like the mark. */
  offset: 194.24,
  /** Vertical extent of the artwork. */
  top: 227.1,
  bottom: 772.9,
  /** Vertical center of every window. */
  windowY: 500,
} as const;

export const STROKE_H = STROKE.bottom - STROKE.top;

/** The stroke's top cap (its highest point), from its left edge: where a stroke's name sits. */
export const CAP_X = 621.122 - STROKE.x0;

/** Offset at which two neighbors just touch (no window). */
export const TOUCH = STROKE.w / STROKE.offset;

type Seg = { cmd: string; nums: number[] };

function parse(d: string): Seg[] {
  const out: Seg[] = [];
  const re = /([MLCVHZ])([^MLCVHZ]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const nums = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
    out.push({ cmd: m[1].toUpperCase(), nums });
  }
  return out;
}

const SEGS = parse(MARK_STROKE);
const round = (n: number) => Math.round(n * 100) / 100;

/** The stroke path with its left edge moved to x = dx (absolute commands only). */
export function strokePath(dx = 0): string {
  const shift = dx - STROKE.x0;
  return SEGS.map(({ cmd, nums }) => {
    if (cmd === "Z") return "Z";
    if (cmd === "V") return `V${round(nums[0])}`;
    if (cmd === "H") return `H${round(nums[0] + shift)}`;
    return cmd + nums.map((n, i) => round(i % 2 === 0 ? n + shift : n)).join(" ");
  }).join("");
}

/** The stroke with its left edge at x = 0: the shape a <use> places with a translate. */
export const STROKE_PATH = strokePath(0);

/** The stroke in a unit box (0–1 on both axes), for `clipPathUnits="objectBoundingBox"`: any
 *  element, a photo included, can be cut to the stroke at whatever size it is laid out. */
export const STROKE_UNIT_PATH = SEGS.map(({ cmd, nums }) => {
  const h = STROKE.bottom - STROKE.top;
  const fx = (n: number) => Math.round(((n - STROKE.x0) / STROKE.w) * 10000) / 10000;
  const fy = (n: number) => Math.round(((n - STROKE.top) / h) * 10000) / 10000;
  if (cmd === "Z") return "Z";
  if (cmd === "V") return `V${fy(nums[0])}`;
  if (cmd === "H") return `H${fx(nums[0])}`;
  return cmd + nums.map((n, i) => (i % 2 === 0 ? fx(n) : fy(n))).join(" ");
}).join("");

/** Left edges of a chain. `gaps[i]` is the separation between stroke i and i + 1, as a multiple
 *  of the mark's offset: 1 = the mark's overlap, TOUCH = just touching, 0 = stacked. */
export function chainX(gaps: number[]): number[] {
  const xs = [0];
  for (const g of gaps) xs.push(xs[xs.length - 1] + g * STROKE.offset);
  return xs;
}

export const uniformGaps = (n: number, g: number) => Array.from({ length: n - 1 }, () => g);

export function chainWidth(xs: number[]): number {
  return xs[xs.length - 1] + STROKE.w;
}

/** Center of the window between stroke k and k + 1 (null when they do not overlap). */
export function windowCenter(
  xs: number[],
  k: number,
): { x: number; y: number; open: number } | null {
  const overlap = xs[k] + STROKE.w - xs[k + 1];
  if (overlap <= 0) return null;
  return {
    x: (xs[k + 1] + xs[k] + STROKE.w) / 2,
    y: STROKE.windowY,
    open: Math.min(1, overlap / (STROKE.w - STROKE.offset)),
  };
}

/** Union path of the strokes at these left edges (one path, nonzero fill). */
export function unionPath(xs: number[]): string {
  return xs.map((x) => strokePath(x)).join("");
}

/** The A (even) and B (odd) layers of a chain. Painted A, B, then A again in Canvas black
 *  clipped by B, which leaves exactly A XOR B on the black page. */
export function chainLayers(xs: number[]): { a: string; b: string } {
  return {
    a: unionPath(xs.filter((_, i) => i % 2 === 0)),
    b: unionPath(xs.filter((_, i) => i % 2 === 1)),
  };
}

/** The mark itself, built from the rule: three strokes one offset apart. */
export const MARK_X = chainX([1, 1]);
