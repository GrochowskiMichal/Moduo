/**
 * A booking link's host is busy during their work sessions from Tasks
 * (TV-D10, REPLAN default d), when the link's busy list has the pseudo-
 * calendar "tasks". Only the times come back: what the work is never reaches
 * the guest, and closed or deleted tasks don't block anything.
 *
 * A read that fails (say, a database before TV-D10's migration) blocks
 * nothing, like the calendar events read beside it.
 */

/** The busy list's id for work sessions (src/features/calendar/booking/model.ts). */
export const TASKS_BUSY_ID = "tasks";

export type BusyInterval = { start: Date; end: Date };

/** The part of a Supabase client this reads through (service role). */
export type SessionsDb = { from(table: string): any };

type SessionRow = {
  starts_at?: unknown;
  ends_at?: unknown;
  tasks?: { status_category?: unknown; deleted_at?: unknown } | null;
};

const CLOSED = new Set(["done", "wont_do"]);

export async function sessionBusyIntervals(
  db: SessionsDb,
  args: { workspaceId: string; userId: string; from: Date; to: Date },
): Promise<BusyInterval[]> {
  const { data, error } = await db
    .from("task_sessions")
    .select("starts_at, ends_at, tasks!inner(status_category, deleted_at)")
    .eq("workspace_id", args.workspaceId)
    .eq("user_id", args.userId)
    .is("deleted_at", null)
    .lt("starts_at", args.to.toISOString())
    .gt("ends_at", args.from.toISOString());
  if (error || !Array.isArray(data)) {
    if (error) console.error("[booking] work sessions unread:", error.code, error.message);
    return [];
  }
  const out: BusyInterval[] = [];
  for (const row of data as SessionRow[]) {
    const task = row.tasks;
    if (!task || task.deleted_at != null) continue;
    if (typeof task.status_category === "string" && CLOSED.has(task.status_category)) continue;
    const start = new Date(String(row.starts_at));
    const end = new Date(String(row.ends_at));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) continue;
    out.push({ start, end });
  }
  return out;
}
