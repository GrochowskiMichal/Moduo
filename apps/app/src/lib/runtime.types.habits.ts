/** The runtime port's habits (implemented in runtime.web.habits.ts). */

/** One habit row (DB-7). Preference-class, user-scoped; `checks` are local-date
 * strings ('YYYY-MM-DD'). Streaks are computed client-side. */
export type HabitRow = {
  id: string;
  workspaceId: string;
  name: string;
  emoji: string;
  position: string;
  checks: string[];
  createdAt: string;
  updatedAt: string;
};

/**
 * Habits (DB-7) — preference-class, user-scoped CRUD (no intent ops). `list`
 * degrades to [] pre-migration (the table is deploy-gated); writes throw so the
 * widget's optimistic update can roll back.
 */
export type HabitsRuntime = {
  list(workspaceId: string): Promise<HabitRow[]>;
  upsert(input: {
    id?: string;
    workspaceId: string;
    name: string;
    emoji: string;
    position: string;
  }): Promise<HabitRow>;
  setChecks(input: { id: string; checks: string[] }): Promise<void>;
  remove(id: string): Promise<void>;
};
