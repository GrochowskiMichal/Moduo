// The Tasks module's contract manifest (docs/moduo-module-contract.md) — the
// reference implementation of the per-module AI-readiness contract. Consumed
// by the module registry (src/lib/module-registry.ts) and, from Session 9 on,
// by the Moduo MCP connector. Keep in sync with the tasks_op_* RPCs
// (supabase/migrations/20260612150000_module_activity_intent_ops.sql).

import type { ModuleManifest } from "../../lib/module-manifest";

export const tasksModuleManifest: ModuleManifest = {
  module: "tasks",
  summary: "Buckets, tasks, personal queues, subtasks, dependencies, recurrence.",
  permissionKey: "tasks",
  activityEntityTypes: ["task"],
  ops: [
    {
      op: "tasks.queue_add",
      rpc: "tasks_op_queue_add",
      summary:
        "Add a task to your own queue (TV-D2): at the end, or the top. Already queued: 'end' leaves it, 'top' moves it. Done/archived tasks can't be queued.",
      args: {
        p_workspace_id: "workspace uuid",
        p_task_id: "task uuid",
        p_at: "'end' (default) or 'top'",
      },
    },
    {
      op: "tasks.queue_remove",
      rpc: "tasks_op_queue_remove",
      summary: "Take a task out of your own queue. Idempotent.",
      args: { p_workspace_id: "workspace uuid", p_task_id: "task uuid" },
    },
    {
      op: "tasks.queue_reorder",
      rpc: "tasks_op_queue_reorder",
      summary:
        "Move a task within your queue: right after another queued task, or to the top (null). Not logged.",
      args: {
        p_workspace_id: "workspace uuid",
        p_task_id: "task uuid",
        p_after_task_id: "queued task uuid to follow, or null for the top",
      },
    },
    {
      op: "tasks.queue_move_to_end",
      rpc: "tasks_op_queue_move_to_end",
      summary:
        "Send a queued task to the end of your queue (Skip in a run). Not logged; never a reschedule.",
      args: { p_workspace_id: "workspace uuid", p_task_id: "task uuid" },
    },
    {
      op: "tasks.commit",
      rpc: "tasks_op_commit",
      summary:
        "Legacy (until TV-D7): commit a task for a day; since TV-D2 it also goes to the end of your queue, and recommitting moves it there.",
      args: {
        p_workspace_id: "workspace uuid",
        p_task_id: "task uuid",
        p_for: "queue date (YYYY-MM-DD)",
      },
    },
    {
      op: "tasks.uncommit",
      rpc: "tasks_op_uncommit",
      summary:
        "Legacy (until TV-D7): clear the day's commit and take the task out of your queue. Idempotent.",
      args: { p_workspace_id: "workspace uuid", p_task_id: "task uuid" },
    },
    {
      op: "tasks.skip_today",
      rpc: "tasks_op_skip_today",
      summary:
        "Legacy (until TV-D7): skip a task out of the day's commit and your queue. No longer counts as a reschedule (TV-D2).",
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
    { name: "queue", summary: "Your own queue, in order (TV-D2)." },
    { name: "today", summary: "Legacy alias of the queue (until TV-D7)." },
    { name: "drift", summary: "Open tasks whose scheduled time has passed (ambient, per bucket)." },
    { name: "tags", summary: "Workspace-level tags and their task links." },
    { name: "relations", summary: "Blocker → blocked dependency edges (DAG)." },
    { name: "activity", summary: "The attributed intent-op trail for a task." },
    { name: "attachments", summary: "A task's files, with short-lived download links (AT-1)." },
  ],
};
