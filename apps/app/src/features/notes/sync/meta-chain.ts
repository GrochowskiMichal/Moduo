/**
 * The runner for Notes' metadata intent ops (creates, renames, moves, …): one
 * chain per engine, so ops reach the server one at a time in the order they
 * were made, with the offline meta outbox replayed FIFO ahead of them. Split
 * out of engine-v2.ts; the engine owns one `MetaOpChain` and hands it the few
 * engine facts it needs through `MetaChainHost`.
 */

import type { ModuoRuntime } from "../../../lib/runtime.types";
import {
  deleteMetaOutboxEntries,
  enqueueMetaOp,
  type MetaOutboxEntry,
  type NotesOwner,
  ownerErased,
  ownerLive,
  ownerOf,
  readMetaOutbox,
} from "./idb";
import { callMetaOp, isNetworkError, metaSlot, replayDecision, replayOrder } from "./meta-outbox";

/**
 * Which op reached the server last for each of a person's note facts, in this
 * page's order (a counter, never the clock). An older op kept after its
 * engine stopped (MOD-569) that turns up after a newer one for the same fact
 * went out is stale: dropped, never replayed over it. Ops from another page
 * life carry no place in this order and replay as before.
 */
const LIFE =
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
let madeSeq = 0;
const sentUpTo = new Map<string, number>();

function sentKey(owner: NotesOwner, slot: string): string {
  return `${ownerOf(owner)}:${slot}`;
}

function markSent(
  owner: NotesOwner,
  kind: MetaOutboxEntry["kind"],
  args: Record<string, unknown>,
  seq: number,
): void {
  const slot = metaSlot(kind, args);
  if (!slot) return;
  const key = sentKey(owner, slot);
  sentUpTo.set(key, Math.max(sentUpTo.get(key) ?? 0, seq));
}

/** A newer op of this page for the same fact already reached the server. */
function superseded(owner: NotesOwner, entry: MetaOutboxEntry): boolean {
  const slot = metaSlot(entry.kind, entry.args);
  if (!slot || entry.made?.life !== LIFE) return false;
  return (sentUpTo.get(sentKey(owner, slot)) ?? 0) > entry.made.seq;
}

export class NotesStillSyncingError extends Error {
  constructor() {
    super("Your latest changes are still syncing. Try again once you're back online.");
    this.name = "NotesStillSyncingError";
  }
}

/** What the chain needs from its engine. */
export type MetaChainHost = {
  readonly runtime: ModuoRuntime | null;
  /** Whose meta outbox this chain reads and writes. */
  readonly owner: NotesOwner;
  /** Called after a replay applied something, once no op waits in the chain. */
  readonly onRemoteMetaChange?: () => void;
  /** A live op went through: heal the offline dot when nothing else waits. */
  afterLiveOp(): Promise<void>;
  /** An op was queued for later while the engine runs (the offline dot). */
  onQueued(): void;
  /** An op was queued after the engine stopped: the person's running engine sends it. */
  handOff(): void;
  /** Push a note's queued edits now; true when some still wait after. */
  pushNoteNow(noteId: string): Promise<boolean>;
};

export class MetaOpChain {
  private replaying: Promise<boolean> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  private reloadDue = false;

  constructor(private readonly host: MetaChainHost) {}

  /** Run a metadata intent op with offline queueing: online → straight
   * through; network-dead → queue + resolve (the caller applied it
   * optimistically); server rejection → rethrow (honest toast). Ops run one at
   * a time in the order they were made, and what already waits replays first;
   * while anything still waits this one queues behind it rather than
   * overtaking it (an older rename replayed later would win; 509-2). */
  run(kind: MetaOutboxEntry["kind"], args: Record<string, unknown>): Promise<"applied" | "queued"> {
    if (!this.host.runtime) return Promise.reject(new Error("Runtime unavailable."));
    // One chain: a newer op checks the outbox only after an older live call
    // (and the enqueue its timeout leads to) has settled.
    const made = { at: Date.now(), seq: ++madeSeq };
    return this.inTurn(() => this.runInOrder(kind, args, made));
  }

  /**
   * Run a live op that reads a note back from the server (Duplicate copies the
   * server's note) only once everything this device still holds for it is
   * there: it takes its turn on the meta chain (behind an older op still on its
   * way), replays the meta outbox and pushes the note's queued edits first. It
   * rejects (`NotesStillSyncingError`) while anything of that still waits: the
   * server's note would be older than the one on screen (645-1 variant).
   */
  runAfterQueued<T>(noteId: string, op: () => Promise<T>): Promise<T> {
    if (!this.host.runtime) return Promise.reject(new Error("Runtime unavailable."));
    return this.inTurn(async () => {
      const owner = this.host.owner;
      if (!ownerLive(owner)) throw new NotesStillSyncingError();
      if (await this.replay()) this.reloadDue = true;
      if ((await readMetaOutbox(owner)).length > 0) throw new NotesStillSyncingError();
      if (await this.host.pushNoteNow(noteId)) throw new NotesStillSyncingError();
      return op();
    });
  }

  /** Queue `step` on the chain; the list reload waits until the chain is idle. */
  private inTurn<T>(step: () => Promise<T>): Promise<T> {
    this.waiting++;
    const run = this.chain.then(step).finally(() => {
      this.waiting--;
      this.reloadWhenIdle();
    });
    this.chain = run.catch(() => {});
    return run;
  }

  /** The list reload after a replay waits until no op is waiting in the chain:
   * it would otherwise undo a newer op's optimistic change on screen. */
  reloadWhenIdle(replayed = false): void {
    if (replayed) this.reloadDue = true;
    if (!this.reloadDue || this.waiting > 0) return;
    this.reloadDue = false;
    this.host.onRemoteMetaChange?.();
  }

  private async runInOrder(
    kind: MetaOutboxEntry["kind"],
    args: Record<string, unknown>,
    made: { at: number; seq: number },
  ): Promise<"applied" | "queued"> {
    const owner = this.host.owner;
    if (await this.replay()) this.reloadDue = true;
    // A stopped engine sends nothing (the session may be someone else's now).
    if (ownerLive(owner) && (await readMetaOutbox(owner)).length === 0) {
      try {
        await this.call(kind, args);
        markSent(owner, kind, args, made.seq);
        await this.host.afterLiveOp();
        return "applied";
      } catch (e) {
        if (!isNetworkError(e)) throw e;
      }
    }
    // Stamped when it was made: one that failed after its engine stopped
    // replays in front of what the person queued since (MOD-569 variant).
    await enqueueMetaOp(owner, {
      kind,
      args,
      queuedAt: made.at,
      made: { life: LIFE, seq: made.seq },
    });
    if (!ownerLive(owner)) {
      // Kept for the person: their running engine (signed back in) sends it now.
      if (!ownerErased(owner)) this.host.handOff();
      return "queued";
    }
    this.host.onQueued();
    return "queued";
  }

  private call(kind: MetaOutboxEntry["kind"], args: any): Promise<unknown> {
    return callMetaOp(this.host.runtime!, kind, args);
  }

  /** One replay at a time; a caller that arrives mid-replay waits for it.
   * True when it applied something (the caller reloads the list). */
  replay(): Promise<boolean> {
    if (!this.host.runtime || !ownerLive(this.host.owner)) return Promise.resolve(false);
    this.replaying ??= this.replayOnce().finally(() => {
      this.replaying = null;
    });
    return this.replaying;
  }

  private async replayOnce(): Promise<boolean> {
    let replayedAny = false;
    // Each entry is tried once per pass (a delete that failed leaves it for the next wake).
    const tried = new Set<number>();
    // Re-read until drained: an op queued behind this replay goes in the same pass.
    for (;;) {
      const entries = replayOrder(await readMetaOutbox(this.host.owner)).filter(
        (e) => typeof e.key === "number" && !tried.has(e.key),
      );
      if (entries.length === 0) break;
      let stop = false;
      for (const entry of entries) {
        tried.add(entry.key!);
        const decision = await this.replayEntry(entry);
        if (decision === "stop") {
          stop = true;
          break;
        }
        if (decision === "applied") replayedAny = true;
      }
      if (stop) break;
    }
    return replayedAny;
  }

  /** Replay one queued op; "stop" keeps it and everything after it queued (FIFO). */
  private async replayEntry(entry: MetaOutboxEntry): Promise<"applied" | "dropped" | "stop"> {
    const owner = this.host.owner;
    if (!ownerLive(owner)) return "stop";
    if (superseded(owner, entry)) {
      await deleteMetaOutboxEntries([entry.key!]);
      return "dropped";
    }
    let error: unknown = null;
    try {
      await this.call(entry.kind, entry.args);
    } catch (e) {
      error = e;
    }
    const decision = replayDecision(entry, error);
    if (decision === "retry-later") return "stop"; // still offline — keep FIFO intact
    if (decision === "applied" && entry.made?.life === LIFE) {
      markSent(owner, entry.kind, entry.args, entry.made.seq);
    }
    await deleteMetaOutboxEntries([entry.key!]);
    if (decision === "drop") console.warn("[notes-sync] dropped queued op", entry.kind, error);
    return decision === "applied" ? "applied" : "dropped";
  }
}
