ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS notes_kind_check;

UPDATE public.notes
SET kind = 'section'
WHERE kind <> 'note';

ALTER TABLE public.notes
  ADD CONSTRAINT notes_kind_check
  CHECK (kind = ANY (ARRAY['note'::text, 'section'::text]));
