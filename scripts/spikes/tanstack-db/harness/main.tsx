// Spike entry (its own Rsbuild entry, see ../rsbuild.config.ts; nothing in
// apps/app/src mounts it). The session and workspace come from the same
// localStorage keys the app uses (the driver writes them). ?persist=0 runs
// the collection without SQLite.

import { createClient } from "@supabase/supabase-js";
import ReactDOM from "react-dom/client";
import { App, type Bucket } from "./app";
import { startTaskWrites } from "./mutations";
import { openTasksCollection } from "./tasks-collection";

const q = new URLSearchParams(location.search);
const url = import.meta.env.PUBLIC_SUPABASE_URL as string;
const key = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY as string;
const supabase = createClient(url, key);

type SpikeWindow = Window & { __spike?: Record<string, unknown> };
const w = window as SpikeWindow;

async function main() {
  const t0 = 0; // performance.now() is relative to navigation start
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) throw new Error("no session: the driver signs in first");
  const workspaceId = localStorage.getItem(`moduo:selected-workspace:${user.id}`) ?? "";
  const authed = Math.round(performance.now());
  const { data: buckets, error } = await supabase
    .from("buckets")
    .select("id,name,is_system,position")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("is_system", { ascending: false })
    .order("position");
  if (error) throw error;
  const tasks = await openTasksCollection({
    supabase,
    workspaceId,
    t0,
    persist: q.get("persist") !== "0",
  });
  const serverRows: Array<{ id: string; at: number }> = [];
  const { editTask, executor } = startTaskWrites({
    supabase,
    workspaceId,
    tasks,
    onServerRow: (row) => serverRows.push({ id: row.id, at: performance.now() }),
  });
  w.__spike = {
    authed,
    timings: tasks.timings,
    serverRows,
    size: () => tasks.collection.size,
    status: () => tasks.collection.status,
    close: () => tasks.close(),
    executor,
  };
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <App tasks={tasks} buckets={buckets as Bucket[]} editTask={editTask} />,
  );
}

main().catch((e) => {
  console.error("[spike]", e);
  w.__spike = { error: String(e) };
});
