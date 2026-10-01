# Booking page — sentence redesign (t/mike/booking-sentence)

Open a real booking link on **staging.moduo.app/book/<slug>** (web). Use a phone for the "Phone" group.

## Picking a time
- [ ] Page opens with the sentence "Let's talk for 30 minutes on *which day* at *what time* *<your city> time*." and the day tray already open.
- [ ] Day tray shows up to three **Soonest** times and a strip of every open day; the bar under each day is longer on busier-free days.
- [ ] Tap a **Soonest** time → day and time fill in at once, tray closes, cursor lands in the name blank.
- [ ] Tap a day → the time tray opens with Morning / Afternoon / Evening rows; the first time has keyboard focus.
- [ ] "Another day" in the time tray goes back to the day strip.
- [ ] On desktop, the ‹ › arrows page the day strip and grey out at either end.
- [ ] Press Escape inside any tray → it closes and focus returns to its blank.

## Timezone
- [ ] Tap "*<city> time*" → a tray of timezones with their current clocks.
- [ ] Pick another zone with a time already chosen → the time stays the same moment, shown in the new zone.
- [ ] When your zone differs from the host's, the line under the button says "That's 4:00 AM for Mike in New York."

## Your details
- [ ] Name and email are typed straight into the sentence; the blank grows with the text.
- [ ] Enter in the name blank jumps to the email blank.
- [ ] The book button reads Pick a day → Pick a time → Add your name → Add your email → (Answer Mike's question) → "Book Wed, Oct 7 at 10:00 AM". Pressing it while something is missing jumps to that thing.
- [ ] With guests enabled on the link: "Bring someone" adds "I'm also bringing *their@email.com*." Two or more guests read "a, b and c". × removes one. The button disappears at 10.
- [ ] With notes enabled: "Add a note" opens "Anything Mike should know?".
- [ ] Custom questions show under "Mike also asks"; optional ones say "(optional)"; a required empty one blocks booking.

## Booking
- [ ] Book → "You're meeting Mike on Wednesday, October 7 at 10:00 AM." with Join Google Meet, the email it went to, and any guests.
- [ ] Real Google event + Meet created, guests on the invite (unchanged backend).
- [ ] Slot taken (book the same time from two tabs) → "Someone just took 10:00 AM. Pick another time.", that time disappears and the time tray reopens.

## Other states
- [ ] Unknown slug → "This booking link isn't available."
- [ ] Paused link → "Mike isn't taking bookings on this link right now."
- [ ] Link with no open times → "Mike has no open times in the next few weeks."
- [ ] Offline on load → "We couldn't load the open times." + Try again works.

## Phone
- [ ] Sentence wraps cleanly, no sideways scroll.
- [ ] The book button stays pinned to the bottom of the screen above the home indicator.
- [ ] Day strip swipes sideways.

## Known gaps
- Verified live with mocked booking data on the dev server (desktop + 375px phone, dark theme). Not yet verified against a real link, Google event creation, or light theme.
