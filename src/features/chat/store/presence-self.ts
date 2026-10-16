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

/** Where "Show me as online" comes from: the signed-in person's prefs. */
export type ShowOnlineSource = {
  /** Their switch, or null while it isn't known (then nothing is tracked). */
  get: (userId: string) => boolean | null;
  subscribe: (fn: () => void) => () => void;
  /** Read it from the server (for whoever is signed in); a successful read
   *  tells `subscribe`'s listeners. */
  read: () => Promise<unknown>;
};

/** Whether the tab is in view, and its changes. */
export type TabVisibility = {
  isVisible: () => boolean;
  onChange: (fn: () => void) => () => void;
};

export type PresenceSelfRegistryDeps = PresenceSelfDeps & {
  visibility?: TabVisibility;
};

/** How often the switch is read again while the tab is in view, for a change
 *  made on another device or browser (other tabs here hear it at once). */
export const SHOW_ONLINE_REREAD_MS = 60_000;
/** A failed first read tries again after 2 s, 4 s, … at most a minute apart. */
export const SHOW_ONLINE_RETRY_MAX_MS = 60_000;

/**
 * The tab's one "me", for one person at a time. Asking for another person (an
 * account switch) or `forget()` (sign-out) disposes the previous one, so no
 * earlier person's switch, idle timer or listener stays behind. A new person
 * tracks nothing until their own switch is read; a failed read tries again.
 * While `watch()` is held, the switch is read again each minute (hidden tabs
 * too) and at once whenever the tab comes back into view.
 */
export class PresenceSelfRegistry {
  private held: {
    userId: string;
    self: PresenceSelfWatcher;
    stop: () => void;
    retry: unknown;
  } | null = null;
  private watchers = 0;
  private stopVisibility: (() => void) | null = null;
  private rereadTimer: unknown = null;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(
    private readonly source: ShowOnlineSource,
    private readonly deps: PresenceSelfRegistryDeps = {},
  ) {
    this.setTimer = deps.setTimer ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
    this.clearTimer =
      deps.clearTimer ??
      ((h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>));
  }

  for(userId: string): PresenceSelfWatcher {
    if (this.held?.userId === userId) return this.held.self;
    this.forget();
    const known = this.source.get(userId);
    const self = new PresenceSelfWatcher(known ?? false, this.deps);
    const stop = this.source.subscribe(() => {
      const on = this.source.get(userId);
      // Someone else's prefs (or none yet) never turn tracking on.
      self.setShowOnline(on ?? false);
    });
    this.held = { userId, self, stop, retry: null };
    if (known === null) this.load(userId, 0);
    return self;
  }

  /** The person this tab holds, if any. */
  get userId(): string | null {
    return this.held?.userId ?? null;
  }

  /** Re-read the switch while held (ref-counted); returns the stop. */
  watch(): () => void {
    this.watchers += 1;
    if (this.watchers === 1) this.startWatching();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.watchers -= 1;
      if (this.watchers === 0) this.stopWatching();
    };
  }

  forget(): void {
    const held = this.held;
    this.held = null;
    if (!held) return;
    held.stop();
    if (held.retry !== null) this.clearTimer(held.retry);
    // Untrack anywhere it was tracked, then stop the timers.
    held.self.setShowOnline(false);
    held.self.dispose();
  }

  /** The first read; a failure tries again while this tab still holds the
   *  person and their switch is still unknown. */
  private load(userId: string, attempt: number): void {
    const held = this.held;
    if (held?.userId !== userId) return;
    void this.source.read().catch(() => {
      // Only the holding that asked retries (not a later one for the same person).
      if (this.held !== held) return;
      held.retry = this.setTimer(
        () => {
          held.retry = null;
          if (this.held === held && this.source.get(userId) === null) {
            this.load(userId, attempt + 1);
          }
        },
        Math.min(SHOW_ONLINE_RETRY_MAX_MS, 2_000 * 2 ** attempt),
      );
    });
  }

  private visible(): boolean {
    return this.deps.visibility?.isVisible() ?? true;
  }

  private reread(): void {
    if (this.held) void this.source.read().catch(() => undefined);
  }

  private startWatching(): void {
    // Back in view: read at once. A hidden tab keeps its minute re-read (the
    // browser may slow it), so it never goes on tracking after a change
    // made elsewhere.
    this.stopVisibility =
      this.deps.visibility?.onChange(() => {
        if (!this.visible()) return;
        this.reread();
        this.armReread();
      }) ?? null;
    this.armReread();
  }

  private stopWatching(): void {
    this.stopVisibility?.();
    this.stopVisibility = null;
    this.disarmReread();
  }

  private armReread(): void {
    this.disarmReread();
    this.rereadTimer = this.setTimer(() => {
      this.rereadTimer = null;
      this.reread();
      if (this.watchers > 0) this.armReread();
    }, SHOW_ONLINE_REREAD_MS);
  }

  private disarmReread(): void {
    if (this.rereadTimer !== null) this.clearTimer(this.rereadTimer);
    this.rereadTimer = null;
  }
}

/** The document's visibility, for `visibility`. */
export function documentVisibility(): TabVisibility | undefined {
  if (typeof document === "undefined") return undefined;
  return {
    isVisible: () => document.visibilityState === "visible",
    onChange: (fn) => {
      document.addEventListener("visibilitychange", fn);
      return () => document.removeEventListener("visibilitychange", fn);
    },
  };
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
