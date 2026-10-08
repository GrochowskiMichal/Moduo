// The mod's type contract: every value it keeps in $.state, and the shapes they hold.
// Self-contained on purpose (the engine refuses imports here); the hooks import from it.

export type Task = {
  id: string;
  title: string;
  bucket_id: string | null;
  status: string;
  drifted?: boolean;
  blocked?: boolean;
  assignee_id?: string;
  subtask_count?: number;
  scheduled_at?: string;
  duration_minutes?: number;
  committed_for?: string;
  commit_order?: number | null;
  recurrence?: unknown;
};

export type Bucket = { id: string; name: string; is_system?: boolean };

export type Filter = "me" | "anyone";

export type Problem = "nokey" | "rejected" | "noaccess" | "offline" | "error" | "endpoint";

export type Row = {
  id: string;
  title: string;
  meta: string;
  tone: "drift" | "blocked" | "plain";
  subtasks: number;
  queuePos: number | null;
};

export type Group = { id: string; name: string; rows: Row[] };

export type QueueCard = { id: string; pos: number; title: string; minutes: number | null };

export type ViewModel = {
  groups: Group[];
  queue: QueueCard[];
  doneToday: { id: string; title: string }[];
  plannedMinutes: number | null;
  drifting: number;
  total: number;
};

export type PanelState = {
  filter: Filter;
  /** null while the first load runs; set on every successful refresh. */
  view: ViewModel | null;
  /** The last refresh's problem, or null when it worked. */
  problem: Problem | null;
  ownerId: string | null;
  updatedAt: number | null;
  showDone: boolean;
};

declare module "claude-code" {
  interface PluginState {
    "moduo-tasks": { panel: PanelState };
  }
}
