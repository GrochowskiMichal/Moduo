// One store per person and workspace, and what a sign-in or a sign-out does
// to them and their device copies (sync kernel, Track C).
//
//   - **Refcounted.** A surface holds a store while mounted (`acquire`); the
//     first hold starts it, the last release stops it (the copy stays).
//   - **Keyed by person.** A store made for another person is thrown away,
//     and so are other people's device copies when someone signs in, except
//     what still waits to sync, which stays under its person's key until they
//     sign in here again (decisions/tasks.md, "A sign-out keeps what waits to
//     sync").
//   - **A null session is not a sign-out** (docs/gotchas/supabase.md):
//     auth-js answers null for an expired token it couldn't refresh offline,
//     and `INITIAL_SESSION` emits null too, while the session comes back
//     online. Null stops the stores and keeps every copy whole; only
//     `SIGNED_OUT` (`wipe`) and account deletion take rows away.

/** What the registry needs of a store. */
export type RegisteredStore = {
  readonly userId: string;
  readonly workspaceId: string;
  /** Stop for good. `persist: false`: write nothing more (its copy is being wiped). */
  dispose(opts: { persist: boolean }): void;
};

/** A store's holds: the first `acquire` runs `start`, the last release runs `stop`. */
export type Holds = {
  /** Hold it; call the returned function when done (each release counts once). */
  acquire(): () => void;
  /** Whether anyone holds it now. */
  held(): boolean;
};

export function refcount(start: () => void, stop: () => void): Holds {
  let refs = 0;
  return {
    acquire() {
      refs += 1;
      if (refs === 1) start();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        refs -= 1;
        if (refs <= 0) stop();
      };
    },
    held: () => refs > 0,
  };
}

/** The `<person>:<workspace>` key every device copy is stored under. */
export function ownerKey(userId: string, workspaceId: string): string {
  return `${userId}:${workspaceId}`;
}

/** Whether a copy's key belongs to this person. */
export function isOwnedBy(key: string, userId: string): boolean {
  return key.startsWith(`${userId}:`);
}

/**
 * The running stores of one kind. Keyed by a scope object (the runtime's
 * part a store talks to: each test's fake runtime gets its own) and the
 * workspace.
 */
export class StoreRegistry<S extends RegisteredStore> {
  private byScope = new WeakMap<object, Map<string, S>>();
  private every = new Set<S>();

  /** The workspace's store, made on first use; one made for another person is thrown away. */
  get(scope: object, userId: string, workspaceId: string, make: () => S): S {
    let byWorkspace = this.byScope.get(scope);
    if (!byWorkspace) {
      byWorkspace = new Map();
      this.byScope.set(scope, byWorkspace);
    }
    let store = byWorkspace.get(workspaceId);
    if (store && store.userId !== userId) {
      store.dispose({ persist: false });
      this.every.delete(store);
      store = undefined;
    }
    if (!store) {
      store = make();
      byWorkspace.set(workspaceId, store);
      this.every.add(store);
    }
    return store;
  }

  /** The workspace's store if one is running. */
  find(scope: object, workspaceId: string): S | null {
    return this.byScope.get(scope)?.get(workspaceId) ?? null;
  }

  /** Every running store. */
  all(): S[] {
    return [...this.every];
  }

  /** Dispose every store `keep` doesn't keep (with `persist`), and forget it. */
  disposeWhere(scopeOf: (store: S) => object, keep: (store: S) => boolean, persist: boolean): void {
    for (const store of [...this.every]) {
      if (keep(store)) continue;
      store.dispose({ persist });
      const byWorkspace = this.byScope.get(scopeOf(store));
      if (byWorkspace?.get(store.workspaceId) === store) byWorkspace.delete(store.workspaceId);
      this.every.delete(store);
    }
  }
}

/** A kind of device copy as the person lifecycle sees it: records by owner key. */
export type OwnedCopies<E> = {
  keys(): Promise<string[]>;
  /**
   * Cut one record down to its waiting entries (what it stored plus
   * `inMemory`, each id once, never one in `handled`: sent or dropped by a
   * store whose last write may not have landed); answers how many stayed.
   * Zero: the caller deletes the record.
   */
  keepOnlyWaiting(
    key: string,
    inMemory: readonly E[],
    handled: ReadonlySet<string>,
  ): Promise<number>;
  deleteWhere(match: (key: string) => boolean): Promise<void>;
  clear(): Promise<void>;
};

/** What a sign-in, a sign-out or a workspace list does to one kind of store and copy. */
export type PersonLifecycle = {
  /** Who is signed in now (the auth shell calls it on every change). */
  attachUser(userId: string | null): Promise<void>;
  /** Signed out: rows go, waiting entries stay (`keepWaiting: false`: everything goes). */
  wipe(opts?: { keepWaiting?: boolean }): Promise<void>;
  /** The person's workspace list came back: copies of workspaces not on it go. */
  keepWorkspaces(userId: string, workspaceIds: readonly string[]): Promise<void>;
  /** How many entries wait to sync in the running stores. */
  waitingCount(): number;
};

const lifecycles = new Set<PersonLifecycle>();

/** What the stores that are stopping hold, by copy key. */
type Leaving<E> = { waiting: Map<string, readonly E[]>; handled: Map<string, Set<string>> };

/** Waiting entries across every kind of store (a sign-out warns first). */
export function waitingEverywhere(): number {
  let count = 0;
  for (const lc of lifecycles) count += lc.waitingCount();
  return count;
}

export function personLifecycle<S extends RegisteredStore, E>(opts: {
  registry: StoreRegistry<S>;
  scopeOf: (store: S) => object;
  copies: () => OwnedCopies<E>;
  waiting: (store: S) => readonly E[];
  /** Ids a store sent or dropped (its copy may still list them). */
  handled?: (store: S) => Iterable<string>;
  /** Counted by `waitingEverywhere` (the sign-out warning). */
  counted?: (entry: E) => boolean;
}): PersonLifecycle {
  const { registry } = opts;
  const keyOf = (store: S) => ownerKey(store.userId, store.workspaceId);
  const dispose = (keep: (store: S) => boolean, persist: boolean) =>
    registry.disposeWhere(opts.scopeOf, keep, persist);

  /** What each matching running store still has waiting, by its copy's key (some may not be written yet). */
  const waitingByKey = (match: (store: S) => boolean): Leaving<E> => {
    const waiting = new Map<string, readonly E[]>();
    const handled = new Map<string, Set<string>>();
    for (const store of registry.all()) {
      if (!match(store)) continue;
      const key = keyOf(store);
      const entries = opts.waiting(store);
      if (entries.length > 0) waiting.set(key, entries);
      const done = [...(opts.handled?.(store) ?? [])];
      if (done.length > 0) handled.set(key, new Set([...(handled.get(key) ?? []), ...done]));
    }
    return { waiting, handled };
  };

  /** Cut each matching copy down to what waits; a copy with nothing waiting goes. */
  const keepOnlyWaiting = async (match: (key: string) => boolean, leaving: Leaving<E>) => {
    const copies = opts.copies();
    const keys = new Set([...(await copies.keys()), ...leaving.waiting.keys()]);
    const empty = new Set<string>();
    for (const key of keys) {
      if (!match(key)) continue;
      const kept = await copies.keepOnlyWaiting(
        key,
        leaving.waiting.get(key) ?? [],
        leaving.handled.get(key) ?? new Set(),
      );
      if (kept === 0) empty.add(key);
    }
    if (empty.size > 0) await copies.deleteWhere((key) => empty.has(key));
  };

  const lc: PersonLifecycle = {
    attachUser(userId) {
      if (userId === null) {
        // Not a sign-out: the stores stop, every copy stays whole.
        dispose(() => false, true);
        return Promise.resolve();
      }
      const leaving = waitingByKey((store) => store.userId !== userId);
      dispose((store) => store.userId === userId, false);
      return keepOnlyWaiting((key) => !isOwnedBy(key, userId), leaving);
    },
    wipe(wipeOpts = {}) {
      if (wipeOpts.keepWaiting === false) {
        dispose(() => false, false);
        return opts.copies().clear();
      }
      const leaving = waitingByKey(() => true);
      dispose(() => false, false);
      return keepOnlyWaiting(() => true, leaving);
    },
    keepWorkspaces(userId, workspaceIds) {
      const keep = new Set(workspaceIds.map((ws) => ownerKey(userId, ws)));
      dispose((store) => store.userId !== userId || keep.has(keyOf(store)), false);
      return opts.copies().deleteWhere((key) => isOwnedBy(key, userId) && !keep.has(key));
    },
    waitingCount() {
      let count = 0;
      for (const store of registry.all()) {
        const waiting = opts.waiting(store);
        count += opts.counted ? waiting.filter(opts.counted).length : waiting.length;
      }
      return count;
    },
  };
  lifecycles.add(lc);
  return lc;
}
