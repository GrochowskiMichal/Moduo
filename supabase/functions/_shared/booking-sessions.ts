/**
 * A booking link's host is busy during their work sessions from Tasks
 * (TV-D10, REPLAN default d), when the link's busy list has the pseudo-
 * calendar "tasks". The read goes through `tasks__busy_sessions` (TV-D10-fix,
 * `20261010190000_task_sessions_access.sql`), the same task gate as every
 * other path: only the host's live sessions on open tasks they can see, and
 * only the times. What the work is never reaches the guest.
 *
 * A read that fails (say, a database before that migration) blocks nothing,
 * like the calendar events read beside it.
 */

/** The busy list's id for work sessions (the app's TASKS_BUSY_ID, src/features/calendar/booking/model.ts; the test checks they match). */
export const TASKS_BUSY_ID = "tasks";

/** The server function that answers a host's busy times (service role only). */
export const BUSY_SESSIONS_RPC = "tasks__busy_sessions";

export type BusyInterval = { start: Date; end: Date };

/** The part of a Supabase client this reads through (service role). */
export type SessionsDb = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

type BusyRow = { starts_at?: unknown; ends_at?: unknown };

export async function sessionBusyIntervals(
  db: SessionsDb,
  args: { workspaceId: string; userId: string; from: Date; to: Date },
): Promise<BusyInterval[]> {
  const { data, error } = await db.rpc(BUSY_SESSIONS_RPC, {
    p_workspace_id: args.workspaceId,
    p_user_id: args.userId,
    p_from: args.from.toISOString(),
    p_to: args.to.toISOString(),
  });
  if (error || !Array.isArray(data)) {
    if (error) {
      const e = error as { code?: unknown; message?: unknown };
      console.error("[booking] work sessions unread:", e.code, e.message);
    }
    return [];
  }
  const out: BusyInterval[] = [];
  for (const row of data as BusyRow[]) {
    const start = new Date(String(row.starts_at));
    const end = new Date(String(row.ends_at));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) continue;
    out.push({ start, end });
  }
  return out;
}
