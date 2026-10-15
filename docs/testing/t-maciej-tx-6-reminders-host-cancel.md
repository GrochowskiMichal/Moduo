# Manual test checklist — TX-6 booking reminders + host-side cancel

> Generated 2026-10-15 · branch `t/maciej/tx-6-reminders-host-cancel` (PR #378) · **Live-verified:** partial. Not on prod yet (release train, docs/email-runbook.md §TX-6). The triggers are proven on the local stack by `supabase/tests/booking_reminders.test.sql` (40 checks); the templates and the editor by unit tests. No real email was sent by the agent.
> Run top-to-bottom after the release train; check off as you go. Each item is a step → what you should see → where.

## Link editor
- [ ] **Do:** Calendar → booking links → edit a link → Limits → **Expect:** "Remind guests" reads "24 hours before" on every existing link _(web, desktop)_
- [ ] **Do:** set it to "1 hour before", save, reopen → **Expect:** it stays "1 hour before" _(web)_
- [ ] **Do:** set it to "Off", save, reopen → **Expect:** "Off" _(web)_

## Reminder (C7)
- [ ] **Do:** book a slot 2–3 days out from a second address, adding one extra guest → **Expect:** the day before, both get "Tomorrow at <time>: <you>"; the booker's copy has "Can't make it? Cancel the meeting", the extra guest's doesn't _(email)_
- [ ] **Do:** book a slot 3 hours out on a 1-hour link → **Expect:** an hour before, "Today at <time>: <you>" _(email)_
- [ ] **Do:** book a slot 2 hours out on a 24-hour link → **Expect:** no reminder _(email)_
- [ ] **Do:** move a booked meeting a day later (Moduo edit, or in Google then sync) → **Expect:** the reminder arrives a day before the new time, not the old one _(email)_
- [ ] **Do:** switch a link with upcoming bookings to Off → **Expect:** no reminders for those bookings _(email)_

## Host cancel (C6)
- [ ] **Do:** on a link without Google, delete a booked meeting in Moduo → **Expect:** the slot is bookable again at once; ~2 minutes later the guests get "<you> canceled your meeting on <day>" with "Pick another time" and a calendar file that removes it _(web + email)_
- [ ] **Do:** delete another booked meeting and press Undo within a minute → **Expect:** the booking stands, nobody is emailed _(web)_
- [ ] **Do:** on a Google Meet link, cancel the meeting in Google, open Moduo so it syncs → **Expect:** the guests get Google's cancellation and ours (no calendar file in ours) _(email)_
- [ ] **Do:** disconnect the Google calendar account in Moduo → **Expect:** nobody is emailed; bookings stay booked _(web)_

## Edge cases
- [ ] **Do:** guest cancels via the cancel link → **Expect:** C4/C5 as before (TX-5), no "<you> canceled" email _(email)_
- [ ] **Do:** delete a booked meeting that already started → **Expect:** no email _(web)_

## Migrations / data
- [ ] **Do:** `select tgname from pg_trigger where tgname in ('calendar_events_booking_follow','slot_bookings_email_follow','slot_bookings_email_forget','exposed_slot_links_reminder_follow');` → **Expect:** four rows _(Supabase SQL)_
- [ ] **Do:** `select kind, status, send_after, last_error from public.email_outbox where kind in ('booking_guest_reminder','booking_guest_host_cancelled') order by created_at desc limit 20;` after the tests → **Expect:** rows `sent` or `cancelled`, no `last_error` _(Supabase SQL)_

## Known gaps / not-yet-testable
- Bookings made before the release have no saved email details: no reminder, no C6.
- On Google Meet links a host cancels in Google; Moduo refuses deleting Google meetings.
- Calendar sync treats meetings moved past +120 days (or to another calendar) as deleted: those guests would get a wrong C6 (docs/gotchas/calendar.md).
- After a Google reconnect, later Google cancels/moves of existing bookings go unseen.
