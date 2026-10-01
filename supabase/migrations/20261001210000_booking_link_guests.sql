-- Host toggle: the person booking may invite extra people. Their addresses
-- are stored on the booking and added to the Google Calendar event.

ALTER TABLE public.exposed_slot_links
  ADD COLUMN IF NOT EXISTS guests_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.slot_bookings
  ADD COLUMN IF NOT EXISTS guest_emails jsonb NOT NULL DEFAULT '[]'::jsonb;
