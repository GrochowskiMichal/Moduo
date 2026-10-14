# Manual test checklist — TX-5 booking emails

> Generated 2026-10-14 · branch `t/maciej/tx-5-booking-emails` (PR #349) · **Live-verified:** partial. Prod has `email-worker` v4, `booking-public` v24 and migration `20261010160147` since 2026-10-10; smoke checks only (unknown link/token answer 404, function list reconciled, grants checked). No real booking was sent by the agent: it needs a booking link and an inbox. Every rendered email is unit-tested and visible in the Storybook email gallery.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Emails, look (Storybook)
- [ ] **Do:** `bun run storybook` → Transactional email → gallery → C1–C5, light, dark and plain text → **Expect:** they match `.design/transactional-email/email-set.html` (C1 host face top-left, "Scheduled with Moduo" on C1/C2 only, one button at most) _(web)_

## Google-connected link (book)
- [ ] **Do:** book a slot on your Google-connected link from a second address, adding one extra guest → **Expect:** the guest gets C1 from "<you> via Moduo", subject "Booked: <you>, <day> at <time>", times in the guest's zone with the zone named, "Google is sending the calendar invite separately.", no calendar file; Google's own invite also arrives; the extra guest gets only Google's invite _(email)_
- [ ] **Do:** reply to C1 → **Expect:** the reply goes to you, not hello@ _(email)_
- [ ] **Do:** check your inbox → **Expect:** C3 "New booking: <guest>, …" in your zone, with the guest's note and answers, "Open in Moduo" opens the event; reply goes to the guest _(email + web)_
- [ ] **Do:** open the bell → **Expect:** "<guest> booked <link name> · Fri 16 Oct, 14:00", opening the event _(web, desktop)_
- [ ] **Do:** the booking page after booking → **Expect:** "A calendar invite from Google and a short email with a way to cancel are on their way to …" _(web; needs the app promotion)_

## Zoom-only link (book + cancel)
- [ ] **Do:** book on a Zoom-only link with one extra guest → **Expect:** C1 and C2 each carry `invite.ics`; opening it adds the meeting to the calendar; the page says "A short email with the details and a calendar file is on its way to …" _(email, web)_
- [ ] **Do:** use C1's "Cancel the meeting" link → cancel → **Expect:** the page says "The time is free again. An email with a calendar update that removes it is on its way."; you get C4 + a bell line "<guest> canceled <link name> · <day>"; the guest gets C5 with a cancelling file and "Pick another time"; the extra guest gets "<guest> canceled the meeting with <you> …" with a cancelling file; both calendar entries disappear _(email, web)_

## Settings
- [ ] **Do:** Settings → Preferences → Notifications → turn off **Bookings** → book again → **Expect:** no bell line (C3 email still arrives: the email switch is TX-8) _(web)_

## Edge cases
- [ ] **Do:** book with a name like "Win at casino.example" on a Zoom-only link with an extra guest → **Expect:** the extra guest's C2 reads "Someone added you: …" _(email)_
- [ ] **Do:** cancel a booking after its start time → **Expect:** the booking is released, no emails, the page says only "The time is free again." _(web)_
- [ ] **Do:** paste a 3,000-character note with emoji → **Expect:** the note box stops at 2,000; the booking succeeds _(web)_

## Migrations / data
- [ ] **Do:** `select kind, status, attempts, last_error from public.email_outbox where kind like 'booking_%' order by created_at desc limit 20;` after the tests → **Expect:** every row `sent`, no `last_error` _(Supabase SQL)_

## Known gaps / not-yet-testable
- No live send by the agent (needs a real link + inbox).
- The booking/cancel page copy and the 24-hour date format reach guests only with the next app promotion (develop → staging-app → prod-app).
- If you connect Google between a Zoom-only booking and its cancel, the CANCEL file names a different organizer; some calendar apps may ignore it.
