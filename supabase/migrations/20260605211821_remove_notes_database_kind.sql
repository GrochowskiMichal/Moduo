UPDATE public.notes
SET kind = 'folder'
WHERE kind NOT IN ('folder', 'note');

ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS notes_kind_check;

ALTER TABLE public.notes
  ADD CONSTRAINT notes_kind_check
  CHECK (kind = ANY (ARRAY['folder'::text, 'note'::text]));
