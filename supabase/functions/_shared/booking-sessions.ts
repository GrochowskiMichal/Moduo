/**
 * A booking link's host is busy during their work sessions from Tasks
 * (TV-D10, REPLAN default d), when the link's busy list has the pseudo-
 * calendar "tasks". Only the times come back: what the work is never reaches
 * the guest, and closed or deleted tasks don't block anything.
 *
 * A read that fails (say, a database before TV-D10's migration) blocks
 * nothing, like the calendar events read beside it.
 */

/** The busy list's id for work sessions (the app's TASKS_BUSY_ID, src/features/calendar/booking/model.ts; the test checks they match). */
export const TASKS_BUSY_ID = "tasks";

export type BusyInterval = { start: Date; end: Date };

/** The part of a Supabase client this reads through (service role). */
export type SessionsDb = { from(table: string): any };

type SessionRow = {
  starts_at?: unknown;
  ends_at?: unknown;
  tasks?: { status?: unknown; status_category?: unknown; deleted_at?: unknown } | null;
};

/**
 * Finished tasks block nothing: @contracts TASK_CLOSED_CATEGORIES (kept here
 * so the function doesn't load zod; booking-sessions.test.ts checks they
 * match), plus the legacy status words for a row without a category.
 */
export const CLOSED_TASK_CATEGORIES: readonly string[] = ["done", "wont_do"];
const CLOSED_LEGACY = new Set(["done", "archived"]);

function isClosed(task: NonNullable<SessionRow["tasks"]>): boolean {
  if (typeof task.status_category === "string") {
    return CLOSED_TASK_CATEGORIES.includes(task.status_category);
  }
  return typeof task.status === "string" && CLOSED_LEGACY.has(task.status);
}

export async function sessionBusyIntervals(
  db: SessionsDb,
  args: { workspaceId: string; userId: string; from: Date; to: Date },
): Promise<BusyInterval[]> {
  const { data, error } = await db
    .from("task_sessions")
    .select("starts_at, ends_at, tasks!inner(status, status_category, deleted_at)")
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
    if (!task || task.deleted_at != null || isClosed(task)) continue;
    const start = new Date(String(row.starts_at));
    const end = new Date(String(row.ends_at));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) continue;
    out.push({ start, end });
  }
  return out;
}
