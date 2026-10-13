// "Not now" on Focus's along-the-way offer (Tasks v3 TV-F8, call 57): it costs
// nothing, but the app counts it per task, so after three the next offer of
// that task asks "Shrink · Move · Let go" instead. Kept on this device per
// person and workspace (a count of skips is nobody else's business, and losing
// it on another device only means one more plain offer).

const PREFIX = "moduo:tasks:along:";

const keyOf = (userId: string, workspaceId: string) => `${PREFIX}${userId}:${workspaceId}`;

/** How many times each task was answered "Not now". */
export function readNotNows(userId: string | null, workspaceId: string): Record<string, number> {
  if (!userId || typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(keyOf(userId, workspaceId));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [id, n] of Object.entries(parsed)) {
      if (typeof n === "number" && Number.isFinite(n) && n > 0) out[id] = Math.floor(n);
    }
    return out;
  } catch {
    return {};
  }
}

function write(userId: string, workspaceId: string, counts: Record<string, number>): void {
  if (typeof localStorage === "undefined") return;
  try {
    // A few hundred tasks at most: the oldest skips go first past that.
    const entries = Object.entries(counts).slice(-300);
    localStorage.setItem(keyOf(userId, workspaceId), JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* storage full or off: the count is a nicety */
  }
}

/** One more "Not now" on `taskId`; answers the new count. */
export function bumpNotNow(userId: string | null, workspaceId: string, taskId: string): number {
  if (!userId) return 0;
  const counts = readNotNows(userId, workspaceId);
  const next = (counts[taskId] ?? 0) + 1;
  delete counts[taskId];
  counts[taskId] = next;
  write(userId, workspaceId, counts);
  return next;
}

/** The task was taken, shrunk, moved or let go: its count starts over. */
export function clearNotNows(userId: string | null, workspaceId: string, taskId: string): void {
  if (!userId) return;
  const counts = readNotNows(userId, workspaceId);
  if (!(taskId in counts)) return;
  delete counts[taskId];
  write(userId, workspaceId, counts);
}
