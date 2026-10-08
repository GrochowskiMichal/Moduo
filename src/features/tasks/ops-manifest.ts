// The Tasks module's contract manifest (docs/moduo-module-contract.md) — the
// reference implementation of the per-module AI-readiness contract. Consumed
// by the module registry (src/lib/module-registry.ts) and, from Session 9 on,
// by the Moduo MCP connector. Keep in sync with the tasks_op_* RPCs
// (supabase/migrations/20260612150000_module_activity_intent_ops.sql).

import type { ModuleManifest } from "../../lib/module-manifest";

export const tasksModuleManifest: ModuleManifest = {
  module: "tasks",
  summary: "Buckets, tasks, today's commit queue, subtasks, dependencies, recurrence.",
  permissionKey: "tasks",
  activityEntityTypes: ["task"],
  ops: [
    {
      op: "tasks.commit",
      rpc: "tasks_op_commit",
      summary:
        "Add a task to a day's commit queue ('doing this today'); recommitting moves it to the end of the queue.",
      args: {
        p_workspace_id: "workspace uuid",
        p_task_id: "task uuid",
        p_for: "queue date (YYYY-MM-DD)",
      },
    },
    {
      op: "tasks.uncommit",
      rpc: "tasks_op_uncommit",
      summary: "Remove a task from its commit queue. Idempotent, never intercepted.",
      args: { p_workspace_id: "workspace uuid", p_task_id: "task uuid" },
    },
    {
      op: "tasks.skip_today",
      rpc: "tasks_op_skip_today",
      summary:
        "Skip a committed task out of the day's queue; atomically increments the ambient reschedule counter.",
      args: { p_workspace_id: "workspace uuid", p_task_id: "task uuid" },
    },
    {
      op: "tasks.assign",
      rpc: "tasks_op_assign",
      summary:
        "Assign a task to a member who can work on tasks, or unassign it (null). Assigning someone else notifies them once (TV-D1).",
      args: {
        p_workspace_id: "workspace uuid",
        p_task_id: "task uuid",
        p_assignee_id: "member uuid, or null to unassign",
      },
    },
    {
      op: "tasks.set_status",
      rpc: "tasks_op_set_status",
      summary:
        "Change a task's status (todo / in_progress / done / archived), with the recurrence pointer ride-along on recurring tasks.",
      args: {
        p_workspace_id: "workspace uuid",
        p_task_id: "task uuid",
        p_status: "new status",
        p_recurrence: "advanced recurrence rule (recurring tasks only; optional)",
        p_position: "board position (optional)",
      },
    },
    {
      op: "tasks.reschedule",
      rpc: "tasks_op_reschedule",
      summary:
        "Move a scheduled task's time (drift triage). Does not touch the reschedule counter.",
      args: {
        p_workspace_id: "workspace uuid",
        p_task_id: "task uuid",
        p_scheduled_at: "new scheduled datetime (ISO)",
        p_days: "days pushed, for the trail (optional)",
      },
    },
    {
      op: "tasks.unschedule",
      rpc: "tasks_op_unschedule",
      summary: "Clear a task's stale scheduled time, keeping the task (drift-triage Ignore).",
      args: { p_workspace_id: "workspace uuid", p_task_id: "task uuid" },
    },
    {
      op: "tasks.skip_occurrence",
      rpc: "tasks_op_skip_occurrence",
      summary:
        "Jump an open recurring task past its pending occurrence without done-credit. Forward-only.",
      args: {
        p_workspace_id: "workspace uuid",
        p_task_id: "task uuid",
        p_scheduled_at: "the next occurrence (ISO)",
        p_recurrence: "rule with the advanced pointer",
        p_release_commit: "clear the day's commit when the new occurrence isn't that day",
      },
    },
    {
      op: "tasks.catch_up",
      rpc: "tasks_op_catch_up",
      summary:
        "Batched recurrence catch-up on app open: reopen arrived done tasks, collapse missed occurrences forward.",
      args: {
        p_workspace_id: "workspace uuid",
        p_items:
          "engine results: [{task_id, kind, status?, scheduled_at?, recurrence, clear_commit}]",
      },
    },
  ],
  resources: [
    { name: "buckets", summary: "The workspace's buckets (rail sections, Inbox)." },
    { name: "tasks", summary: "Tasks with computed drift/blocked state, subtasks, recurrence." },
    { name: "today", summary: "The day's ordered commit queue." },
    { name: "drift", summary: "Open tasks whose scheduled time has passed (ambient, per bucket)." },
    { name: "tags", summary: "Workspace-level tags and their task links." },
    { name: "relations", summary: "Blocker → blocked dependency edges (DAG)." },
    { name: "activity", summary: "The attributed intent-op trail for a task." },
  ],
};
