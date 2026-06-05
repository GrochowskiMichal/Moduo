ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS icon text,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'note',
  ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notes_kind_check'
      AND conrelid = 'public.notes'::regclass
  ) THEN
    ALTER TABLE public.notes
      ADD CONSTRAINT notes_kind_check
      CHECK (kind = ANY (ARRAY['category'::text, 'folder'::text, 'note'::text]));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS notes_workspace_pinned_idx
  ON public.notes (workspace_id, is_pinned, updated_at DESC)
  WHERE deleted_at IS NULL AND is_archived = false;
