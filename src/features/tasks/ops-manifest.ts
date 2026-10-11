// The Tasks module's contract manifest (docs/moduo-module-contract.md) — the
// reference implementation of the per-module AI-readiness contract. Consumed
// by the module registry (src/lib/module-registry.ts) and, from Session 9 on,
// by the Moduo MCP connector. Keep in sync with the tasks_op_* RPCs
// (supabase/migrations/20260612150000_module_activity_intent_ops.sql; every
// create and field edit since TV-D8: 20261010160000_tasks_ops_registry_handles.sql).

import type { ModuleManifest } from "../../lib/module-manifest";

export const tasksModuleManifest: ModuleManifest = {
  module: "tasks",
  summary: "Buckets, tasks, personal queues, subtasks, dependencies, recurrence.",
  permissionKey: "tasks",
  activityEntityTypes: ["task"],
  ops: [
    {
      op: "tasks.create",
      rpc: "tasks_op_create",
      summary:
        "Create a task (TV-D8): numbers it (its handle, MOD-142), registers it for search and @, logs it. Default project: the creator's Inbox; default assignee: the creator. A resend with the same id answers with the task it made.",
      args: {
        p_workspace_id: "workspace uuid",
        p_task:
          "{id?, title, description?, bucket_id?, parent_id?, due_date?, scheduled_at?, duration_minutes?, recurrence?, energy_level?, priority?, status?, position?, assignee_id?}",
      },
    },
    {
      op: "tasks.update",
      rpc: "tasks_op_update",
      summary:
        "Edit a task's fields (TV-D8): only those given change; a rename re-registers it; moving it moves its subtasks; deleted_at deletes (subtasks go top-level), null restores; status and assignee go through their own ops' rules. Answers with the task, then any subtasks it carried.",
      args: {
        p_workspace_id: "workspace uuid",
        p_task_id: "task uuid",
        p_patch:
          "{title?, description?, bucket_id?, parent_id?, due_date?, scheduled_at?, duration_minutes?, recurrence?, energy_level?, priority?, position?, status?, assignee_id?, deleted_at?}",
      },
    },
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
      op: "projects.delete",
      rpc: "projects_op_delete",
      summary:
        "Delete a project (TV-U6, REPLAN 78): every task tree with open work goes to its top task's assignee's Inbox (unassigned: yours), with one quiet notice per person (tasks.project_deleted); the finished tasks go with it to Recently deleted in one batch. Needs Full access to the project.",
      args: {
        p_workspace_id: "workspace uuid",
        p_project_id: "project (bucket) uuid",
      },
    },
    {
      op: "tasks.trash_restore",
      rpc: "tasks_op_trash_restore",
      summary:
        "Restore from Recently deleted (TV-U6), within 30 days: a project with its batch and the open tasks its delete sent to Inboxes that nobody touched since (Full access), or one task (into your Inbox when its project is gone). Not logged.",
      args: {
        p_workspace_id: "workspace uuid",
        p_entity_type: "'bucket' (or 'project') or 'task'",
        p_entity_id: "uuid",
      },
    },
    {
      op: "tasks.trash_purge",
      rpc: "tasks_op_trash_purge",
      summary:
        "Delete forever, from Recently deleted only (TV-U6): a project with its batch (Full access), or one task. Files go at the next daily purge. Not logged.",
      args: {
        p_workspace_id: "workspace uuid",
        p_entity_type: "'bucket' (or 'project') or 'task'",
        p_entity_id: "uuid",
      },
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
        "Change a task's status (todo / in_progress / done / archived). On a repeat the server moves the pointer (never to an occurrence on the day it was done) and records the completion (TV-D8).",
      args: {
        p_workspace_id: "workspace uuid",
        p_task_id: "task uuid",
        p_status: "new status",
        p_recurrence:
          "the client's pointer; used only for a rule the server's engine can't read (optional)",
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
        "Roll the workspace's repeats over now (TV-D8; the server also does it every 15 minutes): repeats come back at their assignee's midnight. Answers with what changed plus the tasks named in p_items (old builds' engine results, otherwise ignored).",
      args: {
        p_workspace_id: "workspace uuid",
        p_items: "[] (builds before TV-D8 send their engine's results; the server ignores them)",
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
