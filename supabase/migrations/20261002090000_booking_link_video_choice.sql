-- A booking link's video can be one platform or the guest's choice.
-- The legacy check only allowed zoom and google_meet.

ALTER TABLE public.exposed_slot_links
  DROP CONSTRAINT IF EXISTS exposed_slot_links_video_provider_check;

ALTER TABLE public.exposed_slot_links
  ADD CONSTRAINT exposed_slot_links_video_provider_check
  CHECK (video_provider IS NULL OR video_provider IN ('google_meet', 'zoom', 'guest_choice'));
