# Booking links — Zoom and "Their choice" (t/mike/booking-zoom)

Prerequisite: the Zoom app secrets are set (see docs/gotchas.md → "Zoom on booking links"). Until then Zoom and Their choice show "Not available yet".

## Host: link editor (web + desktop)
- [ ] Calendar rail → New booking link → Video lists Google Meet, Zoom, Their choice, Moduo video (Later).
- [ ] Pick Zoom while Zoom isn't connected → "Connect Zoom" box appears; Save says "Connect Zoom first, or pick another video option."
- [ ] Connect Zoom (web) → Zoom consent → back on /calendar, Zoom row says Connected, `?zoom=` is gone from the address bar.
- [ ] Connect Zoom (desktop) → opens the browser; after consenting, switch back to the app → Zoom row says Connected.
- [ ] Deny on Zoom's consent screen → back on /calendar with "Zoom didn't connect. Try again."
- [ ] Their choice with only Google connected → hint "Connect Zoom too, or guests will only see Google Meet".
- [ ] Disconnect Zoom → Zoom row goes back to "Connect your Zoom account"; a Zoom-only link's Copy button disables.
- [ ] Reopen a saved link → its video choice is remembered.

## Guest: booking page
- [ ] Google Meet link → sentence reads "Let's talk over Google Meet for 30 minutes on …" with Google Meet as a fixed word.
- [ ] Zoom link → "Let's talk over Zoom …"; booking creates a Zoom meeting on the host's account; confirmation says "30 minutes on Zoom" and "Join Zoom" opens the zoom.us link.
- [ ] Zoom booking with Google connected → Google event on the host's calendar has the Zoom link as location; guests get Google's invite.
- [ ] Their choice link → "Google Meet" is an underlined blank; tapping it opens "Choose how to meet" with Google Meet / Zoom cards; picking Zoom updates the sentence and the footer ("Zoom link arrives by email.").
- [ ] Guest email (Resend) names the right platform.
- [ ] Cancel a Zoom booking from the email → the Zoom meeting is gone from the host's Zoom account.
- [ ] Host disconnects Zoom while a Zoom-only link is shared → page shows "isn't taking bookings on this link right now."

## Known gaps
- Guest page verified on the dev server with mocked data (Their choice → Zoom → booked). Link editor not viewed live (no sign-in from the agent browser). Real Zoom API calls untested until the Zoom app exists.
