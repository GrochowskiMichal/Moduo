// My share of a task's tracked time, for the detail panel's "you 50m" (tasks-v2
// §5; TV-D3's `tasks_time_totals`, the only read that shows a person their own
// share and nobody else's). The RPC answers for a whole workspace, so one read
// serves every task opened in the next half minute; a task whose total moved
// since (Focus saved, someone typed a value) reads again.

import { useEffect, useState } from "react";

import type { ModuoRuntime } from "@/lib/runtime.types";
import type { TaskTimeTotals } from "../model";

const FRESH_MS = 30_000;

type Snapshot = { at: number; rows: Map<string, TaskTimeTotals> };
const snapshots = new Map<string, Snapshot>();

function snapshotKey(userId: string, workspaceId: string): string {
  return `${userId}:${workspaceId}`;
}

/** Forget every cached read (tests; a sign-out drops them with the page). */
export function clearTaskTimeShares(): void {
  snapshots.clear();
}

/** Seconds of the task's total that are mine; null while unknown. */
export function useTaskTimeShare(
  runtime: ModuoRuntime | null,
  workspaceId: string | null,
  userId: string | null,
  taskId: string,
  totalSeconds: number,
): number | null {
  const [mine, setMine] = useState<number | null>(null);

  useEffect(() => {
    if (!runtime || !workspaceId || !userId || taskId.startsWith("tmp-")) {
      setMine(null);
      return;
    }
    // No time on the task, no share to read (and the row says nothing about it).
    if (totalSeconds <= 0) {
      setMine(0);
      return;
    }
    const key = snapshotKey(userId, workspaceId);
    const hit = snapshots.get(key);
    const row = hit?.rows.get(taskId);
    const fresh = hit && Date.now() - hit.at < FRESH_MS;
    if (fresh && row && row.totalSeconds === totalSeconds) {
      setMine(row?.mySeconds ?? 0);
      return;
    }
    let cancelled = false;
    // A total that moves in quick steps (several saves in a row) reads once.
    const timer = setTimeout(() => {
      runtime.tasks
        .listTimeTotals(workspaceId)
        .then((rows) => {
          const map = new Map(rows.map((r) => [r.taskId, r]));
          snapshots.set(key, { at: Date.now(), rows: map });
          if (!cancelled) setMine(map.get(taskId)?.mySeconds ?? 0);
        })
        .catch(() => {
          if (!cancelled) setMine(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runtime, workspaceId, userId, taskId, totalSeconds]);

  return mine;
}
