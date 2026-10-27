---
paths: ["apps/app/src/features/calendar/**", "supabase/functions/booking-*/**", "supabase/functions/calendar-google-web/**", "supabase/functions/_shared/oauth-connect.ts", "supabase/functions/_shared/app-origin.ts", "apps/desktop/src-tauri/src/commands/caldav.rs", "supabase/migrations/*calendar*", "supabase/migrations/*booking*"]
incident: "Booking-link saves failed on the hosted DB against CHECK constraints no migration in the repo declares, and an unparseable ICS feed could tombstone a whole account (CAL-8)"
expires: 2027-01-31
---

# Calendar: mirror, booking links, CalDAV

Most traps are commented at their code (`mirror.ts`, `ics-mirror.ts`, `use-calendar-sync.ts`, `caldav-connect.ts`, the booking functions).

- **`exposed_slot_links` has legacy CHECK constraints not in the repo's migrations** (`video_provider`, `location_type`, `schedule_type`, which must include `weekly`). A new value saves locally and fails on the hosted DB: read them first (`select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.exposed_slot_links'::regclass and contype='c'`). `user_integrations_provider_check` allows only `zoom`, `google_meet`, `google_calendar`: extend it in the same change as a new provider.
- **A provider fetch on the delete-diff path must throw, never return `[]`, when it can't read:** an empty result tombstones the account's whole mirror.
- **Known gaps with guests in the loop:** calendar sync tombstones every mirrored event outside its −30/+120-day fetch, and `calendar_events_booking_follow` reads a tombstoned future booking as a host cancel, so a booked meeting moved in Google past +120 days emails its guests a cancellation. A reconnected Google account re-inserts its events as new rows (the mirror upsert skips tombstoned ones), so a booking keeps pointing at the dead row and later Google moves or cancels of it go unseen.
- **A second Google account needs `account_key`** (the Google email; `''` for Zoom and Meet): `user_integrations` is unique on `(user_id, provider, account_key)`.
- **Live-verify the web mirror without the desktop OAuth engine** by calling `calendar_op_account_upsert` then `calendar_op_mirror_events` from the browser with the session token; `calendar_op_account_remove` tests the cascade.
- **`calendar_events_booking_follow` is a deferred constraint trigger:** a SQL test in one rolled-back transaction must `SET CONSTRAINTS ALL IMMEDIATE` after each step (and `DEFERRED` before the next), or it never fires.
- **Booking functions run with `verify_jwt=false`** and deploy after the web app (new functions with an old app strand every connect on `/calendar`).
