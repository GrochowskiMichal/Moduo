# Manual test checklist — web Google calendar + public booking links

> Generated 2026-10-01 · branch `t/mike/calendar-booking-links` · **Live-verified:** no — the database migration and the three edge functions are deployed; the app and the public `/book` host update when staging finishes deploying.
> Run top-to-bottom on **https://app.staging.moduo.app** after the deploy. Check off as you go.

## Booking link address
- [ ] **Do:** On Calendar, copy a booking link. → **Expect:** the address starts with `https://staging.moduo.app/book/`, not `app.staging.moduo.app`. _(web)_
- [ ] **Do:** Open that link in a private window. → **Expect:** the booking page (calendar, then times), not the marketing page. The address stays on `staging.moduo.app`. _(web)_
- [ ] **Do:** Book a time. → **Expect:** confirmation with the Meet link. The cancel link in the guest email also starts with `https://staging.moduo.app/book/cancel`. _(web)_

## The Google calendar you already connected
- [ ] **Do:** Open Calendar. → **Expect:** under Calendars, a **Google** label and your Gmail address, then each calendar in that mailbox (Familijne, IT Events, and the rest). Moduo stays above that group. _(web)_
- [ ] **Do:** Open the ••• menu on one of those calendars. → **Expect:** the destructive action says **Remove calendar**, not Remove account. Removing it drops that calendar only. The others stay. _(web)_
- [ ] **Do:** Open Settings → Integrations. → **Expect:** Google Calendar says **1 account connected**. The mailbox address is shown once, with the calendars listed under it. Disconnect removes the whole mailbox. Remove drops one calendar. _(web)_
- [ ] **Do:** Draw a new event and, in the popover, choose one of the Google calendars, then press Enter. → **Expect:** the event shows on the Moduo grid and in that calendar on Google. _(web)_
- [ ] **Do:** Connect another Google account from Settings → Integrations, or from + Connect calendar…. → **Expect:** you stay in the app, Google’s sign-in opens, and the new calendars appear in both lists. _(web)_

## Add guests
- [ ] **Do:** Edit a booking link and turn **Add guests** on. Save. Open the link. → **Expect:** under Email, an **Add guests** button. Links with the toggle off do not show it. _(web)_
- [ ] **Do:** Add one or two other email addresses and book a time. → **Expect:** confirmation says those addresses get the invite. Each guest receives a Google Calendar invite with the Meet link. Cancelling the booking cancels that invite for them too. _(web)_

## Who the booking page shows
- [ ] **Do:** Change your name or profile photo in Settings, then open a booking link you already created (private window is fine). → **Expect:** the page shows the new name and the new photo, without editing the link. If you have no photo, your initials show. _(web)_

## Still desktop
- [ ] **Do:** On the web, look at Outlook and CalDAV in Settings → Integrations. → **Expect:** those two still say Desktop only. Google does not. _(web)_

## Known gaps
- Outlook, CalDAV, and ICS still connect from the desktop app. Their logins live in the desktop keychain.
- Editing or dragging an event that came from Google still happens in Google. New events you add on that calendar in Moduo are written to Google.
- Production (`moduo.app` / `app.moduo.app`) was not updated.
