// What waits for the network (sync kernel, Track C). A write that can't go
// now waits in an outbox kept with the device copy and is sent in order, each
// entry under its own id, so a resend never makes a second row. Two policies:
//
//   - **"fifo-drop-on-refusal"** (Tasks' captures and check-offs): the head
//     goes first; a refusal won't go through later either, so it leaves the
//     outbox (the caller says so) and the next one goes.
//   - **"hold-failed-for-retry"** (Chat's sends): a refused entry stays,
//     marked failed ("Not sent · Retry"), and is skipped; later entries go.
//
// A lost network stops the drain either way: the head waits for the network.
//
// **Two tabs share one copy.** Each tab's outbox is written with the entries
// other tabs left in the copy (`merged`), and takes them on (`adopt`). What a
// tab sent or dropped is `handled`: another tab's older copy can't bring it
// back. An entry adopted from the copy that has since left it was sent or
// dropped by another tab (`goneElsewhere`).

export type OutboxPolicy = "fifo-drop-on-refusal" | "hold-failed-for-retry";

export type OutboxEntryBase = { id: string };

export class Outbox<E extends OutboxEntryBase> {
  private entries: E[] = [];
  /** Sent or dropped by this tab. */
  private handled = new Set<string>();
  /** Taken from the device copy: another tab may send or drop them. */
  private adopted = new Set<string>();

  constructor(
    readonly policy: OutboxPolicy,
    /** Hold policy: whether an entry was refused and waits for a Retry. */
    private readonly isFailed: (entry: E) => boolean = () => false,
  ) {}

  get length(): number {
    return this.entries.length;
  }

  /** Every entry, in order (a copy). */
  list(): E[] {
    return [...this.entries];
  }

  find(match: (entry: E) => boolean): E | undefined {
    return this.entries.find(match);
  }

  some(match: (entry: E) => boolean): boolean {
    return this.entries.some(match);
  }

  has(id: string): boolean {
    return this.entries.some((e) => e.id === id);
  }

  push(entry: E): void {
    this.entries.push(entry);
  }

  /**
   * The entry to send next, or none. FIFO: the head, if `ready`. Hold: the
   * first entry that isn't failed and is `ready` (a Chat send waiting on its
   * files holds only itself).
   */
  next(ready: (entry: E) => boolean = () => true): E | undefined {
    if (this.policy === "fifo-drop-on-refusal") {
      const head = this.entries[0];
      return head && ready(head) ? head : undefined;
    }
    return this.entries.find((e) => !this.isFailed(e) && ready(e));
  }

  /** An entry leaves for good (sent, dropped, discarded): no copy brings it back. */
  remove(id: string): E | undefined {
    const i = this.entries.findIndex((e) => e.id === id);
    this.handled.add(id);
    this.adopted.delete(id);
    if (i < 0) return undefined;
    return this.entries.splice(i, 1)[0];
  }

  /** Whether this tab sent or dropped it. */
  isHandled(id: string): boolean {
    return this.handled.has(id);
  }

  /** Whether it came from the device copy (another tab may have sent it). */
  isAdopted(id: string): boolean {
    return this.adopted.has(id);
  }

  /**
   * Take on entries from the device copy (this tab's start, or another tab's
   * waiting entries): those this tab doesn't hold or handled join the end
   * (or the front, `first`).
   * Returns the ones that joined.
   */
  adopt(stored: unknown, opts: { first?: boolean } = {}): E[] {
    const joined = this.othersWaiting(stored);
    for (const entry of joined) this.adopted.add(entry.id);
    // `first`: the device copy's entries are older than any this tab queued
    // before it read the copy (a start-up race): they go first.
    this.entries = opts.first ? [...joined, ...this.entries] : [...this.entries, ...joined];
    return joined;
  }

  /**
   * Entries in the stored outbox that this tab neither holds nor handled.
   * `mine`: what this tab held when it took what to write (a write runs later).
   */
  othersWaiting(stored: unknown, mine: readonly E[] = this.entries): E[] {
    if (!Array.isArray(stored)) return [];
    const have = new Set(mine.map((e) => e.id));
    const out: E[] = [];
    for (const e of stored as E[]) {
      if (!e || typeof e.id !== "string" || have.has(e.id) || this.handled.has(e.id)) continue;
      have.add(e.id);
      out.push(e);
    }
    return out;
  }

  /** What to write to the copy: this tab's entries, then the others still waiting there. */
  merged(stored: unknown): E[] {
    return [...this.entries, ...this.othersWaiting(stored)];
  }

  /**
   * Adopted entries the stored outbox no longer has: another tab sent or
   * dropped them. `except`: one this tab is sending right now stays.
   */
  goneElsewhere(stored: readonly E[], except: string | null = null): string[] {
    const there = new Set(stored.map((e) => e.id));
    return [...this.adopted].filter((id) => !there.has(id) && id !== except);
  }

  /** Forget everything (the store is disposed). */
  clear(): void {
    this.entries = [];
  }
}

/** One send's outcome. */
export type SendOutcome<R> = { ok: true; value: R } | { ok: false; error: unknown };

/**
 * Send what waits, in order, one at a time, until the outbox has nothing
 * ready or the network goes. The outbox's policy decides a refusal: FIFO
 * removes the entry (then `refused`); hold leaves it (`refused` marks it).
 *  - `before(entry)`: "send", "skip" (it left meanwhile: pick again) or "stop".
 */
export async function drainOutbox<E extends OutboxEntryBase, R>(
  outbox: Outbox<E>,
  run: {
    running(): boolean;
    ready?(entry: E): boolean;
    before?(entry: E): Promise<"send" | "skip" | "stop"> | "send" | "skip" | "stop";
    send(entry: E): Promise<SendOutcome<R>>;
    isNetwork(error: unknown): boolean;
    sent(entry: E, value: R): void;
    refused(entry: E, error: unknown): void;
    offline(entry: E, error: unknown): void;
  },
): Promise<void> {
  for (;;) {
    if (!run.running()) return;
    const entry = outbox.next(run.ready);
    if (!entry) return;
    const go = run.before ? await run.before(entry) : "send";
    if (go === "stop") return;
    if (go === "skip") continue;
    if (!run.running()) return;
    const res = await run.send(entry);
    if (res.ok) {
      outbox.remove(entry.id);
      run.sent(entry, res.value);
      continue;
    }
    if (run.isNetwork(res.error)) {
      run.offline(entry, res.error);
      return;
    }
    if (outbox.policy === "fifo-drop-on-refusal") outbox.remove(entry.id);
    run.refused(entry, res.error);
  }
}

/** Waits that grow while the network stays away: `base`, ×2 each time, at most `max`. */
export class Backoff {
  private tries = 0;

  constructor(
    private readonly base: number,
    private readonly max: number,
  ) {}

  next(): number {
    const wait = Math.min(this.max, this.base * 2 ** this.tries);
    this.tries += 1;
    return wait;
  }

  reset(): void {
    this.tries = 0;
  }
}
