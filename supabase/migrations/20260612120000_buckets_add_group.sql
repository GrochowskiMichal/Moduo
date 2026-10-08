-- Tasks module — bucket sections (improvement-plan Session 4).
--
-- An optional, presentational "section" label on a bucket. Buckets that share a
-- `group_label` render under a collapsible section header in the Plan-mode left
-- rail (two levels max: section → bucket). Nullable / unset by default — the
-- rail stays flat until a bucket is assigned a section (design principle 1:
-- quiet until the user decides otherwise). Capture and task→bucket assignment are
-- untouched; this only affects how buckets are grouped in the rail.
--
-- Column is named `group_label` (not `group`) to avoid the SQL reserved word; the
-- web runtime maps it to the camelCase model field `group`.

ALTER TABLE public.buckets
  ADD COLUMN IF NOT EXISTS group_label text;
