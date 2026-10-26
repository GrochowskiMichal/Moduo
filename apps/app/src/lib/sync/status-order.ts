// Status writes in order (MOD-587). The server applies a task's status ops in
// the order they arrive, so a status write for a task never leaves while an
// older one for it is on its way: it waits in the outbox behind it, and the
// flush holds it until the live one has answered (or failed and gone back in
// front). Kept per person, workspace and task across stores: one that stopped
// (a sign-out, a lost session) may still have one out when the next store for
// that person opens.

const noop = () => {};

/** Live status writes on their way, by `<person>:<workspace>:<task>`; each settles once its fallback is done. */
const live = new Map<string, Promise<void>>();

/** Who waits for a task's turn; woken when anything may have freed one. */
const waiters = new Set<() => void>();

/** The live status write on its way for this key, if any (settles once it and its fallback are done). */
export function liveStatusOf(key: string): Promise<void> | undefined {
  return live.get(key);
}

/** A live status write for this key is on its way until `run` settles. Answers `run`. */
export function trackLiveStatus<T>(key: string, run: Promise<T>): Promise<T> {
  const settled = run.then(noop, noop);
  const before = live.get(key);
  const done = before ? Promise.all([before, settled]).then(noop) : settled;
  live.set(key, done);
  void done.then(() => {
    if (live.get(key) === done) live.delete(key);
    wakeTurns();
  });
  return run;
}

/** Resolves the next time a turn may have freed up. */
export function nextTurn(): Promise<void> {
  return new Promise((resolve) => waiters.add(resolve));
}

/** Something that held a task's turn moved on (an answer, the network, a stopped store). */
export function wakeTurns(): void {
  const waiting = [...waiters];
  waiters.clear();
  for (const fn of waiting) fn();
}
