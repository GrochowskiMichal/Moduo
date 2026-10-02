# Manual test: landing (`t/maciej/landing-v4`), rounds 3–5

Mike's v5 look, rebuilt section by section to match the real app. Round 3 (2 October) covers Maciej's 24-point list on top of v7 (`9ff4407`). Round 4 (the same day) is the final polish: a quieter hero, richer widgets, the Moduo stage in the AI demo, the tax entrance, the new Yours and the values fixes. Round 5 (3 October) trims the hero further and polishes the details.

Surface: **web, localhost only**. Run `PORT=8766 bun scripts/preview-landing.ts`, then open http://127.0.0.1:8766.

⚠ Waitlist forms post to the **production** Supabase. They return 403 from localhost:8766 (that origin isn't allowlisted). Don't add it.

Check the page at three sizes: 1512 × 982 (laptop), 2560 × 1440 (4K at 150%) and 390 px (phone). Also check once with reduced motion turned on.

## Header
- [ ] The glow at the progress tip is soft. There's no vertical cut above the tip, and the lit layer fades out before it.
- [ ] Over the hero the bar is transparent. As the pane arrives, the glass fades in without a jump.

## Hero
- [ ] No tab strip above the mockup and no top row grid. The frame holds only the copy, the mockup and the counters band.
- [ ] Quiet at rest: no rulers on the edges and no pointer coordinates.
  - The grid is faint and lights up only in a soft circle around the pointer.
  - The counters band uses the UI font, not monospace.
  - The mockup is larger than in round 3.
- [ ] After the windows assemble, the auto tour highlights one module and its links without dimming the others. Hovering a module dims the rest only lightly.
- [ ] Move the pointer far left and right: the windows never get clipped by the mockup box. The scatter isn't a regular 3-4-3 grid.
- [ ] The link lines use the same thin stroke as the story, with no heavy end circles.
- [ ] Chat appears as a module that already exists (no "Coming" anywhere). The top row says "Mac, Windows and web".

## Lineup and story
- [ ] There's clear space between "Everything your day runs on" and the tiles. The hover arcs never touch the heading.
- [ ] Each arc has its own shape: it leaves from its own spot on the card, lands off-centre, and longer links arc higher so they nest. Hovering the same card twice gives the same shapes.
- [ ] No widget count is stated anywhere on the page.
- [ ] The story has six steps, ends on "Give it a slot", and the last step zooms out to the whole picture. The track is shorter than before.
- [ ] No window chrome around the story. The cards are readable, and nothing says "See it all at home".

## Make it yours
- [ ] Corners nest. At 1512 px, the shell is 33 px = card 20 px + padding 13 px. Inputs and buttons inside cards use the card radius minus its padding.
- [ ] Reconnect's ring sits exactly around the initials.
- [ ] The analog clock has no grey face.
- [ ] Weather looks like the other cards: no blue tint. Place and temperature are on top; conditions are at the bottom, with the rain kept inside its icon.
- [ ] Notes and Recently linked have their picture centred and the text at the bottom. Countdown's segments sit at the bottom.
- [ ] Phone: no dots button over the content; tapping a card opens its settings. Ticking a task doesn't.
- [ ] Switching Studio, Personal and Side project plays a split-flap cascade: each tile turns away and the new one turns in, rippling from the top left.
- [ ] Widgets show richer visuals:
  - task progress ring and bar
  - next-event card and an agenda with a "Now" line, on a fixed demo time of 11:20
  - time split by project and a week chart
  - a mini link graph
  - activity sparkline
  - age bars for things that drifted
  - reconnect rings
  - weather tint with falling rain, and an hourly line
  - pomodoro ticks
  - countdown segments
  - capture that types and sends lines
  - habit heatmaps
  - a page stack for notes
- [ ] Pick an accent: it shows in all of them. Mono shows white.
- [ ] The preview and the dock are separate: a 16:9 Home on its own, with the dock below it.
- [ ] The dock is one row and never wraps. On a phone it scrolls sideways and fades at the right edge.
- [ ] Studio, Personal and Side project all use the same layout (M S S / S S M). Switching changes only what's inside it.
- [ ] Theme, shade, accent, font, density and corners change only the insides of the cards. The Home never changes size; check the height before and after.
- [ ] Dense shows more rows in the same cards. Light mode stays inside the preview and is a step dimmer than pure white.
- [ ] Hover a widget and open the dots.
  - The card turns over to its settings: Widget, Size (only the sizes that widget has in the app), Show, Move.
  - Asking for a size that doesn't fit is refused with a shake and "No room for L…".
  - Shrinking leaves an empty dashed slot.
- [ ] Drag one widget onto another to swap them; the rest glide into place. On touch screens the page still scrolls, and the hint says to tap the dots.
- [ ] Live details: the timer counts up, the pomodoro counts down, the clock hands move.

## Bring any AI
- [ ] The assistant and Moduo windows are the same size, and the windows sit a little closer together. Radii nest in the model switch, the key rows and their pills, and the input.
- [ ] The signal is a small dot. It slips out from under one window and disappears under the next, and it never pops into view in the gap.
- [ ] Where the signal touches a window, a short piece of that window's outline lights up. At the key it turns red when blocked.
- [ ] Moduo has a dock of modules. On each call the right module comes up from the dock as a card:
  - reads its lines with a light band sweeping across the words, like an assistant's "thinking" shimmer, cascading down the list; no highlight boxes
  - adds a task, or links two cards with a drawn line and chips
  - sends a packet back into the wire, then returns to the dock
- [ ] Every prompt can be replayed as often as you like. With a module set to None, its dock icon flashes red and "Nothing reached Moduo".
- [ ] Three windows joined by wires: the assistant, the Moduo key and Moduo.
- [ ] The model switch shows the real Claude, OpenAI, Gemini and Ollama logos. The input placeholder follows the switch.
- [ ] The auto tour (it stops as soon as you click anything in the demo):
  1. Read the tasks and send them back.
  2. Create "Invoice Anna · Fri".
  3. Email switches to None, so the request stops at the key: the row flashes red and "Nothing reached Moduo".
  4. Email goes back to View, and the link draws between the note and Maya's emails.
- [ ] Set Tasks to View and ask for the invoice task. It's blocked at the key, and the assistant explains why.
- [ ] Adding the task doesn't make the Moduo card grow.
- [ ] On tablet and phone the windows stack, with vertical wires.

## Stack tax and Fast
- [ ] On first view the receipt adds itself up in about a second and a half: each line counts in, the total counts and gets struck, then Moduo's price lands and the savings count up.
- [ ] Switching Just me, Two of us and Team of 5 never changes the receipt's height. The Slack line prints in and out, and the totals count to their new values.
- [ ] Fast lists six shortcuts, with the last two fading. There's no J/K and no E/S/R. The two columns are balanced.

## Yours, values, pricing
- [ ] "Yours." uses the same heading size as the other sections. The sentence underneath is lead-sized, with five promise pills on the text's baseline and their icons centred on the words.
  - On first view the pills light up one after another.
  - Hover, focus or tap a pill to open a small card: export progress, import sources, a revocable key, training locked off, and a hold-to-delete ring.
  - On a phone a tap toggles the card.
- [ ] "What we won't build" is the cards that turn over; the other layouts are gone.
  - The refusal stays readable, with a clear but light strike drawn in after a moment.
  - Hovering near a card's edge doesn't stutter: hover sits on the list item, which never moves.
- [ ] The Free plan lists exactly what it has: tasks, notes, calendar, email and contacts, linked. Chat shows on Duo and Team only. The FAQ plan answer matches.
- [ ] "Compare every plan" has a chevron with space after the label, and the four plan columns are the same width.

## Made by a duo, shipping, questions
- [ ] "Made by a duo": Maciej Grzywacz (Product and design) and Mike Grochowski (Engineering) are equal in weight, each with a first-person quote.
  - Mike's photo comes from `landing/assets/makers/mike.jpg`, cropped to the frame.
  - Maciej's slot reads "Photo soon".
- [ ] "Shipping every week" sits after the makers as its own section. It has seven entries, the last two fading, plus the line about building for over a year.
- [ ] Questions: the lead invites a hello or a project chat at hello@moduo.app.

## Footer
- [ ] One footer, not two: no signup form. The statement is large and in sentence case.
- [ ] Columns:
  - Product
  - Modules, including Chat and Home
  - Company: About us, Changelog, Press kit soon, Contact
  - Resources: Questions, plus Help center, MCP docs, Import guide, Security and Status, all soon
  - Follow along
  - Say hello
- [ ] No monospace in the footer.
- [ ] The wordmark is the real "moduo" (Pilat Extended outlines). Its guides are true to the letters:
  - ascender, x-height, baseline and the overshoot bands
  - the o built on a circle in its square
  - the d's bowl circle meeting the stem
  - the stem guides and the 71 stem dimension
- [ ] Hover a letter: its real nodes and handles appear, and the mod or duo bracket shows. The coordinate readout is in font units, from the baseline.
- [ ] The 3D lineart mark still follows the pointer.

## Known gaps
- **The waitlist opt-in backend is not live yet.** It needs `supabase/migrations/20261002120000_waitlist_updates_opt_in.sql`, then a redeploy of `waitlist-join`, in that order. Until then the checkbox shows "Couldn't save that."
- Social links: LinkedIn exists but its tagline is outdated. X, Product Hunt, GitHub and YouTube return 404, and the Discord invite is invalid.
- Privacy, Terms, Cookies, Download, Press kit, Help center, MCP docs, Import guide, Security and Status are "soon" placeholders.
- Maciej's photo is still a placeholder.
- The changelog entries are mock data with relative dates.
