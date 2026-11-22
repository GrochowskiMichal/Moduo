// Status writes waiting their turn in one store (`WorkspaceStore.sendStatusInTurn`,
// a drop's status part). What is queued for the task while one waits is newer:
// it waits behind it until the turn has gone live or given up. Split out of
// store.ts; the cross-store order of live status writes is `status-order.ts`.

import { nextTurn, wakeTurns } from "./status-order";

/**
 * A status write waiting its turn (`sendStatusInTurn`, a drop). What is queued
 * for its task while it waits is newer: it waits behind it (`blocks`) until
 * the turn has gone live or given up (`ended`).
 */
export type Turn = { readonly blocks: Set<string>; readonly ended: Promise<void> };

/** Status writes waiting their turn, by task, oldest first. */
export class StatusTurns {
  private readonly byTask = new Map<string, Set<Turn>>();

  /** Take a place in line for a status write to this task; `end` gives it up
   * (gone live or given up) and wakes whoever waits on a turn. */
  take(taskId: string): { turn: Turn; end: () => void } {
    let resolve = () => {};
    const turn: Turn = {
      blocks: new Set(),
      ended: new Promise<void>((r) => {
        resolve = r;
      }),
    };
    const turns = this.byTask.get(taskId) ?? new Set<Turn>();
    turns.add(turn);
    this.byTask.set(taskId, turns);
    const end = () => {
      turns.delete(turn);
      if (turns.size === 0 && this.byTask.get(taskId) === turns) this.byTask.delete(taskId);
      resolve();
      wakeTurns();
    };
    return { turn, end };
  }

  /** An outbox entry queued for this task now is newer than every turn waiting: it goes after them. */
  queueBehind(taskId: string, entryId: string): void {
    for (const turn of this.byTask.get(taskId) ?? []) turn.blocks.add(entryId);
  }

  /**
   * For the flush, before it sends an entry: while the entry is queued behind
   * a waiting turn, wait until that turn ends or anything else moves on, and
   * answer true (pick the head again). Never only for the turn: an older
   * write can come back in front of the held entry (a live one that failed,
   * handed over from the store before, MOD-569), and the turn waits for it.
   */
  async heldBack(taskId: string, entryId: string): Promise<boolean> {
    const turn = this.holding(taskId, entryId);
    if (!turn) return false;
    await Promise.race([turn.ended, nextTurn()]);
    return true;
  }

  /** The turn an outbox entry was queued behind, while it still waits. */
  holding(taskId: string, entryId: string): Turn | undefined {
    for (const turn of this.byTask.get(taskId) ?? []) {
      if (turn.blocks.has(entryId)) return turn;
    }
    return undefined;
  }
}
