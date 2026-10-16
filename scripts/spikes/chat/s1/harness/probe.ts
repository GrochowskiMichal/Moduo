// CV-0 spike 1: frame-accurate sampling.
//
// A row that jumps for one frame and comes back is still a visible jump, so
// every anchoring check samples each frame *after* layout and after the
// libraries' ResizeObserver callbacks (where TanStack corrects the scroll
// position), i.e. the state that paints. The trick: a 1 px sentinel resized
// in every requestAnimationFrame, observed by a ResizeObserver created after
// the stream's own (observers are called in creation order).

export const raf = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

export async function waitFrames(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await raf();
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type FrameHooks = {
  /** In requestAnimationFrame, before layout: scroll writes, state changes. */
  before?: (frame: number, t: number) => void;
  /** After layout and the libraries' observers: the painted state. */
  sample: (frame: number, t: number) => void;
};

export class PaintProbe {
  private readonly sentinel: HTMLDivElement;
  private ro: ResizeObserver | null = null;
  private onPaint: (() => void) | null = null;
  private flip = false;

  constructor() {
    const el = document.createElement("div");
    el.setAttribute("aria-hidden", "true");
    el.className = "s1-sentinel";
    el.style.position = "fixed";
    el.style.left = "0";
    el.style.top = "0";
    el.style.height = "1px";
    el.style.width = "1px";
    el.style.pointerEvents = "none";
    el.style.opacity = "0";
    document.body.append(el);
    this.sentinel = el;
  }

  /** (Re)create the observer: call right after the stream (re)mounts. */
  arm(): void {
    this.ro?.disconnect();
    this.ro = new ResizeObserver(() => this.onPaint?.());
    this.ro.observe(this.sentinel);
  }

  /** Run until `frames` frames or `ms` milliseconds; returns rAF timestamps. */
  run(
    limit: { frames?: number; ms?: number; stop?: () => boolean },
    hooks: FrameHooks,
  ): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const times: number[] = [];
      let i = 0;
      let start = -1;
      const tick = (t: number) => {
        if (start < 0) start = t;
        try {
          hooks.before?.(i, t);
        } catch (e) {
          reject(e);
          return;
        }
        this.flip = !this.flip;
        this.sentinel.style.width = this.flip ? "2px" : "1px";
        this.onPaint = () => {
          this.onPaint = null;
          try {
            hooks.sample(i, t);
          } catch (e) {
            reject(e);
            return;
          }
          times.push(t);
          i++;
          const done =
            (limit.frames !== undefined && i >= limit.frames) ||
            (limit.ms !== undefined && t - start >= limit.ms) ||
            limit.stop?.() === true;
          if (done) resolve(times);
          else requestAnimationFrame(tick);
        };
      };
      requestAnimationFrame(tick);
    });
  }
}

/** Long animation frames (Chromium) or long tasks, while `run` runs. */
export async function longFrames<T>(
  run: () => Promise<T>,
): Promise<{ result: T; loaf: number[]; longtasks: number[]; supported: string[] }> {
  const supported = (PerformanceObserver.supportedEntryTypes ?? []).filter(
    (t) => t === "long-animation-frame" || t === "longtask",
  );
  const loaf: number[] = [];
  const longtasks: number[] = [];
  const observers: PerformanceObserver[] = [];
  for (const type of supported) {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) (type === "longtask" ? longtasks : loaf).push(e.duration);
    });
    po.observe({ type, buffered: false });
    observers.push(po);
  }
  const result = await run();
  await waitFrames(2);
  for (const po of observers) {
    for (const e of po.takeRecords()) {
      (e.entryType === "longtask" ? longtasks : loaf).push(e.duration);
    }
    po.disconnect();
  }
  return { result, loaf, longtasks, supported };
}

export function stats(values: readonly number[]): {
  n: number;
  p50: number;
  p95: number;
  max: number;
} {
  if (values.length === 0) return { n: 0, p50: 0, p95: 0, max: 0 };
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] as number;
  return {
    n: s.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(s[s.length - 1] as number),
  };
}

export const round = (v: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
