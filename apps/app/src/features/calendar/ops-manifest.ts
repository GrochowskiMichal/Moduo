// Calendar module manifest (CAL-7, AC14 / module contract §12). Declares the
// AI-interactable surface: native-event intent ops + the loop verbs (which ride
// the shipped Tasks ops — the lens model) + the read resources. Registered in
// src/lib/module-registry.ts; mirrored connector-side in
// supabase/functions/moduo-mcp/modules/calendar.ts. Its own permission lane
// since PERM-1. The loop verbs are Tasks ops, so a key also needs Tasks: Edit.

import type { ModuleManifest } from "../../lib/module-manifest";

export const calendarModuleManifest: ModuleManifest = {
  module: "calendar",
  summary:
    "A time-blocking calendar sharing one data model with Tasks: native events plus task blocks (scheduled tasks), with the schedule-to-completion loop. External calendars are read-only.",
  permissionKey: "calendar",
  activityEntityTypes: ["event"],
  ops: [
    {
      op: "calendar.create_event",
      rpc: "calendar_op_event_create",
      summary:
        "Create a native Moduo event (title, times, all-day, optional repeat, place, meeting link, privacy, calendar, people).",
      args: {
        p_workspace_id: "workspace uuid",
        p_title: "event title",
        p_starts_at: "start instant (ISO 8601)",
        p_ends_at: "end instant (ISO 8601)",
        p_all_day: "boolean — all-day event",
        p_rrule: "optional RFC-5545 RRULE for a repeating event, or null",
        p_description: "optional notes",
        p_calendar_id:
          "optional calendars uuid (a Moduo or custom calendar you can edit); default Your calendar",
        p_location: "optional place",
        p_attendees: "optional people: [{ email, name? }]",
        p_conference_url: "optional meeting link (https://…); its provider is worked out",
        p_is_private: "optional boolean — teammates see only Busy",
      },
    },
    {
      op: "calendar.update_event",
      rpc: "calendar_op_event_update",
      summary:
        "Edit a native event via a camelCase JSON patch (title/times/allDay/rrule/place/link/privacy/calendar/people). External events are rejected.",
      args: {
        p_workspace_id: "workspace uuid",
        p_event_id: "event uuid",
        p_patch:
          "jsonb of only-present camelCase keys: title, description, startsAt, endsAt, allDay, rrule, location, conferenceUrl, isPrivate, calendarId (null = Your calendar), attendees",
      },
    },
    {
      op: "calendar.delete_event",
      rpc: "calendar_op_event_delete",
      summary:
        "Delete a native event (tombstoned; registry cascade cleans spine links). External events are rejected.",
      args: {
        p_workspace_id: "workspace uuid",
        p_event_id: "event uuid",
      },
    },
    {
      op: "calendar.offer_times",
      rpc: "calendar_op_offer_create",
      summary:
        "Offer up to ten times from one of your booking links as one link (/book/r/<token>); held times count as busy and release together when one is picked or after 48 hours.",
      args: {
        p_workspace_id: "workspace uuid",
        p_link_id: "your booking link's uuid",
        p_starts_at: "the offered start instants (ISO 8601), 1 to 10",
        p_hold: "boolean — hold them on your calendar (default true)",
        p_title: "optional title (the link's name by default)",
        p_duration_minutes: "optional length (the link's by default)",
        p_video_provider: "optional google_meet | zoom | guest_choice",
      },
    },
    {
      op: "calendar.release_offer",
      rpc: "calendar_op_offer_release",
      summary: "Release an open offer: its held times leave your calendar together.",
      args: {
        p_workspace_id: "workspace uuid",
        p_offer_id: "offer uuid",
      },
    },
    {
      op: "calendar.schedule_task",
      rpc: "tasks_op_reschedule",
      alsoNeeds: ["tasks"],
      summary:
        "Place a task on the calendar at a clock time — it renders as a task block (the lens).",
      args: {
        p_workspace_id: "workspace uuid",
        p_task_id: "task uuid",
        p_scheduled_at: "the block's start instant (ISO 8601)",
        p_days: "null (absolute schedule; the relative-days form is a Tasks-side detail)",
      },
    },
    {
      op: "calendar.move_block",
      rpc: "tasks_op_reschedule",
      alsoNeeds: ["tasks"],
      summary: "Move an already-scheduled task block to a new time (its duration is preserved).",
      args: {
        p_workspace_id: "workspace uuid",
        p_task_id: "task uuid",
        p_scheduled_at: "the block's new start instant (ISO 8601)",
        p_days: "null",
      },
    },
    {
      op: "calendar.complete_block",
      rpc: "tasks_op_set_status",
      alsoNeeds: ["tasks"],
      summary:
        "Complete a task from its block (recurrence pointer advances) — identical to completing in Tasks.",
      args: {
        p_workspace_id: "workspace uuid",
        p_task_id: "task uuid",
        p_status: "'done'",
        p_recurrence: "optional advanced recurrence rule, or null",
        p_position: "null",
      },
    },
    {
      op: "calendar.roll_forward",
      rpc: "tasks_op_reschedule",
      alsoNeeds: ["tasks"],
      summary:
        "The strip's Move-to-today: reschedule each unfinished-from-earlier task onto today (one attributed reschedule per task).",
      args: {
        p_workspace_id: "workspace uuid",
        p_task_id: "task uuid (called once per rolled task)",
        p_scheduled_at: "today's placement instant (ISO 8601)",
        p_days: "null",
      },
    },
  ],
  resources: [
    {
      name: "calendar.list_events",
      summary:
        "Events in a date range — both native and mirrored-external, with source attribution.",
    },
    {
      name: "calendar.day",
      summary:
        "The composed day: native + external events, scheduled task blocks, and the unfinished-from-earlier strip.",
    },
    {
      name: "calendar.who_sees",
      summary:
        "Who sees what of your calendars, or of one of your events: each teammate sees it all, as Busy, as Focus time, or not at all.",
    },
  ],
};
