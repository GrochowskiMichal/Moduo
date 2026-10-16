// How you appear on the presence topic (CV-17, spec §10, #17, #20, CH48):
// "Show me as online" off means the client never tracks itself (you show as
// offline to others); on, it tracks while Moduo is open, and says "away"
// after 10 minutes without input (no "since" time). Reachable · away ·
// offline are derived here and by the readers, never stored.

export const AWAY_AFTER_MS = 10 * 60_000;

export type PresenceSelfState = {
  /** Track yourself at all ("Show me as online"). */
  track: boolean;
  /** Idle 10 minutes. */
  away: boolean;
};

export interface PresenceSelf {
  get(): PresenceSelfState;
  subscribe(fn: () => void): () => void;
}

export type PresenceSelfDeps = {
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Calls `fn` on any input (pointer, key, wheel, focus); returns the stop. */
  onInput?: (fn: () => void) => () => void;
};

/** The tab's own "me": the switch and an idle timer. One per tab. */
export class PresenceSelfWatcher implements PresenceSelf {
  private state: PresenceSelfState;
  private listeners = new Set<() => void>();
  private timer: unknown = null;
  private stopInput: (() => void) | null = null;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private lastInput = 0;
  private readonly now: () => number;

  constructor(showOnline: boolean, deps: PresenceSelfDeps = {}) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
    this.clearTimer =
      deps.clearTimer ??
      ((h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>));
    this.state = { track: showOnline, away: false };
    this.lastInput = this.now();
    this.stopInput = deps.onInput ? deps.onInput(() => this.input()) : null;
    this.arm();
  }

  get = (): PresenceSelfState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /** "Show me as online" changed. */
  setShowOnline(on: boolean): void {
    if (on === this.state.track) return;
    this.set({ ...this.state, track: on });
  }

  /** Input: back from away at once; the idle clock starts again (throttled). */
  input(): void {
    const at = this.now();
    if (this.state.away) {
      this.lastInput = at;
      this.set({ ...this.state, away: false });
      this.arm();
      return;
    }
    // Re-arm at most every few seconds; a mouse move is constant.
    if (at - this.lastInput < 5_000) return;
    this.lastInput = at;
    this.arm();
  }

  dispose(): void {
    this.stopInput?.();
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private arm(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (!this.state.away) this.set({ ...this.state, away: true });
    }, AWAY_AFTER_MS);
  }

  private set(next: PresenceSelfState): void {
    this.state = next;
    for (const fn of this.listeners) fn();
  }
}

/** The browser's input events, for `onInput`. */
export function windowInput(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const events = ["pointerdown", "pointermove", "keydown", "wheel", "focus"] as const;
  for (const e of events) window.addEventListener(e, fn, { passive: true });
  return () => {
    for (const e of events) window.removeEventListener(e, fn);
  };
}
