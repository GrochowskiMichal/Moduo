-- Lightweight time-tracking for the Tasks module (improvement-plan Session 11 ·
-- Round D, lightweight-cloud variant chosen 2026-06-15).
--
-- A single cached total of tracked seconds on the task, written through the
-- normal task-save path (RLS-covered, like any other task field) — no sessions
-- table, no intent-op, no activity row. The "Duration" estimate reuses the
-- existing tasks.duration_minutes (no new column). Per-session history + the
-- "tracked Nm" activity trail can be layered on later if wanted.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS time_spent_seconds integer NOT NULL DEFAULT 0
  CONSTRAINT tasks_time_spent_seconds_nonneg CHECK (time_spent_seconds >= 0);
