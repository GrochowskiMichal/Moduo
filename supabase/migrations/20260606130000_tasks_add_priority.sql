-- Tasks module — add the optional `priority` axis to tasks.
--
-- `energy_level` already captures *how demanding* a task is. `priority` captures
-- a distinct axis: *how important* it is to get done (its weight in time). Both
-- are optional, ambient (never alarming), and offered as opt-in group-by
-- dimensions in the List view. `priority` mirrors `energy_level`'s low/med/high
-- shape; an `urgent` tier is a non-breaking future CHECK extension.
--
-- Append-only follow-up to 20260606120000_create_tasks_module.sql.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS priority text
    CHECK (priority IN ('low', 'medium', 'high'));

-- Recreate the drift view so its expanded `t.*` column list picks up `priority`.
-- (A view defined with SELECT * freezes its columns at creation time.)
DROP VIEW IF EXISTS public.tasks_with_drift;
CREATE VIEW public.tasks_with_drift
WITH (security_invoker = true)
AS
SELECT
  t.*,
  (
    t.scheduled_at IS NOT NULL
    AND t.scheduled_at < now()
    AND t.status NOT IN ('done', 'archived')
  ) AS drifted
FROM public.tasks t;
