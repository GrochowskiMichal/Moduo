// Everyone's "now" in a workspace (CV-17): statuses, do not disturb and
// Focusing from `chat_now(ws)`, held app-wide while something shows people.
// A status change travels live (`user_statuses` is published and read under
// its rule, so only statuses you may see arrive); Focusing can't push (a run
// is its person's own row), so the store also re-reads every minute while the
// tab is visible, and when it becomes visible again. Display only.

import { useEffect, useMemo, useSyncExternalStore } from "react";

import { readPeopleNow } from "./api";
import type { PersonNow } from "./model";

export type PeopleNowSnapshot = {
  people: ReadonlyMap<string, PersonNow>;
  loaded: boolean;
};

const EMPTY: PeopleNowSnapshot = { people: new Map(), loaded: false };
/** How often Focusing is re-read while the tab is visible. */
export const PEOPLE_NOW_REFRESH_MS = 60_000;

/** The live source: calls `onChange` on any visible status change; returns the stop. */
export type StatusChangeSource = (onChange: () => void) => () => void;

export type PeopleNowDeps = {
  read: (workspaceId: string) => Promise<Map<string, PersonNow>>;
  live: StatusChangeSource;
  /** Visibility, for the interval (tests pass their own). */
  visible?: () => boolean;
  onVisible?: (fn: () => void) => () => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

export class PeopleNowStore {
  private snapshot: PeopleNowSnapshot = EMPTY;
  private listeners = new Set<() => void>();
  private refs = 0;
  private stops: Array<() => void> = [];
  private reading: Promise<void> | null = null;
  private again = false;
  /** Bumped by dispose(): a read begun before it is dropped. */
  private gen = 0;

  constructor(
    readonly workspaceId: string,
    private readonly deps: PeopleNowDeps,
  ) {}

  /** Stop everything and forget what was read (sign-out). */
  dispose(): void {
    this.gen += 1;
    this.again = false;
    this.refs = 0;
    this.stop();
    this.snapshot = EMPTY;
    for (const fn of this.listeners) fn();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): PeopleNowSnapshot => this.snapshot;

  /** Read again now (after you set your own status, say). Overlapping calls
   *  coalesce into one more read. */
  refresh = (): Promise<void> => {
    if (this.reading) {
      this.again = true;
      return this.reading;
    }
    const gen = this.gen;
    this.reading = this.deps
      .read(this.workspaceId)
      .then(
        (people) => {
          if (gen !== this.gen) return;
          // Nothing changed: keep the snapshot, so readers don't re-render.
          if (this.snapshot.loaded && samePeople(this.snapshot.people, people)) return;
          this.snapshot = { people, loaded: true };
          for (const fn of this.listeners) fn();
        },
        () => undefined, // keep what we had; the next tick tries again
      )
      .finally(() => {
        this.reading = null;
        if (this.again && gen === this.gen) {
          this.again = false;
          void this.refresh();
        }
      });
    return this.reading;
  };

  acquire(): () => void {
    this.refs += 1;
    if (this.refs === 1) this.start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.refs -= 1;
      if (this.refs <= 0) this.stop();
    };
  }

  private start(): void {
    void this.refresh();
    this.stops.push(this.deps.live(() => void this.refresh()));
    const set = this.deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
    const clear =
      this.deps.clearInterval ??
      ((h) => globalThis.clearInterval(h as ReturnType<typeof globalThis.setInterval>));
    const visible = this.deps.visible ?? (() => true);
    const handle = set(() => {
      if (visible()) void this.refresh();
    }, PEOPLE_NOW_REFRESH_MS);
    this.stops.push(() => clear(handle));
    if (this.deps.onVisible) this.stops.push(this.deps.onVisible(() => void this.refresh()));
  }

  private stop(): void {
    for (const s of this.stops.splice(0)) s();
  }
}

// ── the app's stores ────────────────────────────────────────────────────────

let defaultDeps: (() => PeopleNowDeps) | null = null;

/** The browser's sources (set by `./live.ts`, kept out of tests). */
export function setDefaultPeopleNowDeps(make: () => PeopleNowDeps): void {
  defaultDeps = make;
}

/** One store per person and workspace: what one person may see never shows
 *  for the next one signed in on this tab. */
const stores = new Map<string, PeopleNowStore>();

export function peopleNowStore(userId: string, workspaceId: string): PeopleNowStore | null {
  const key = `${userId}:${workspaceId}`;
  let store = stores.get(key);
  if (!store) {
    if (!defaultDeps) return null;
    store = new PeopleNowStore(workspaceId, defaultDeps());
    stores.set(key, store);
  }
  return store;
}

/** Re-read a workspace's "now" (after setting your own status). */
export function refreshPeopleNow(userId: string | null, workspaceId: string | null): void {
  if (userId && workspaceId) void stores.get(`${userId}:${workspaceId}`)?.refresh();
}

/** Sign-out: stop every store's feed and forget what it read. */
export function forgetPeopleNow(): void {
  for (const store of stores.values()) store.dispose();
  stores.clear();
}

const noSubscribe = () => () => {};
const empty = () => EMPTY;

/** Everyone's "now" in the workspace, held while mounted. */
export function usePeopleNow(userId: string | null, workspaceId: string | null): PeopleNowSnapshot {
  const store = useMemo(
    () => (userId && workspaceId ? peopleNowStore(userId, workspaceId) : null),
    [userId, workspaceId],
  );
  useEffect(() => store?.acquire(), [store]);
  return useSyncExternalStore(
    store ? store.subscribe : noSubscribe,
    store ? store.getSnapshot : empty,
    store ? store.getSnapshot : empty,
  );
}

export { readPeopleNow };

/** Whether two reads say the same thing (the server's order is stable). */
function samePeople(a: PeopleNowSnapshot["people"], b: PeopleNowSnapshot["people"]): boolean {
  if (a.size !== b.size) return false;
  for (const [id, now] of a) {
    const other = b.get(id);
    if (!other || JSON.stringify(other) !== JSON.stringify(now)) return false;
  }
  return true;
}
