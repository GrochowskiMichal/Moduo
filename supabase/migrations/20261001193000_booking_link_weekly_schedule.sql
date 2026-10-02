-- Weekly hours are the booking-link schedule. The legacy check only
-- allowed working_hours and custom, so saving a link failed.

ALTER TABLE public.exposed_slot_links
  DROP CONSTRAINT exposed_slot_links_schedule_type_check;

ALTER TABLE public.exposed_slot_links
  ADD CONSTRAINT exposed_slot_links_schedule_type_check
  CHECK (schedule_type = ANY (ARRAY['working_hours'::text, 'custom'::text, 'weekly'::text]));
