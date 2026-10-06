# Manual test: landing (`t/maciej/landing-v4`), rounds 3–7

Mike's v5 look, rebuilt section by section to match the real app. Round 3 (2 October) covers Maciej's 24-point list on top of v7 (`9ff4407`). Round 4 (the same day) is the final polish: a quieter hero, richer widgets, the Moduo stage in the AI demo, the tax entrance, the new Yours and the values fixes. Round 5 (3 October) trims the hero further and polishes the details. Round 7 (6 October) adds the announcement pill, removes the hero frame, and reworks every section for phones. A live, clickable app window was tried in the hero and is parked until the app UI is final (see the end of this list).

Surface: **web**. Locally, run `PORT=8766 bun scripts/preview-landing.ts`, then open http://127.0.0.1:8766.

Staging: the work is merged into `staging-landing` (c2d8687). Staging keeps its portal at `/`, so the landing is published for review at **https://staging.moduo.app/landing.html** (noindex). The first deploy was blocked by Vercel because the commit author (En5hi) isn't a member of Mike's Vercel project; it goes live once Mike redeploys that commit or adds Maciej to the project. Production (`moduo.app`) changes only when `staging-landing` is promoted to `prod-landing`.

⚠ Waitlist forms post to the **production** Supabase. They return 403 from localhost:8766 (that origin isn't allowlisted). Don't add it.

Check the page at three sizes: 1512 × 982 (laptop), 2560 × 1440 (4K at 150%) and 390 px (phone). Also check once with reduced motion turned on.

## Header
- [ ] The glow at the progress tip is soft. There's no vertical cut above the tip, and the lit layer fades out before it.
- [ ] Over the hero the bar is transparent. As the pane arrives, the glass fades in without a jump.

## Hero
- [ ] The pill above the headline reads "Private beta · Early members keep the founding price" and links to Pricing. On a phone it reads "Founding price for early members".
- [ ] No frame: no box, grid, corner marks, counters band or before/after switch. The copy sits on the left, the workspace on the right; on tablets and phones the workspace goes below the copy.
- [ ] Ten app windows scatter, then slide together into the Moduo workspace after about two seconds.
  - While they fly, the workspace fades in behind them as the faintest outlines. There are no dashed lines.
  - Each slot fills as its app lands.
  - Once it's built, the outline brightens and a very soft glow separates the workspace from the page. Nothing jumps from one style to another.
- [ ] Before it assembles, the windows drift a little with the pointer. Afterwards nothing highlights itself: modules light up only on hover, with their links.
- [ ] The link lines use the same thin stroke as the story, with no heavy end circles. Chat appears as a module that already exists (no "Coming" anywhere).
- [ ] Desktop: the hero holds still and the pane slides straight over it. The bar stays clear until the pane arrives.
- [ ] Reduced motion: the workspace shows built straight away.

## Lineup and story
- [ ] There's clear space between "Everything your day runs on" and the tiles. The hover arcs never touch the heading.
- [ ] Each arc has its own shape: it leaves from its own spot on the card, lands off-centre, and longer links arc higher so they nest. Hovering the same card twice gives the same shapes.
- [ ] No widget count is stated anywhere on the page.
- [ ] Phones: one compact row per module, icon beside the words. No empty card space and no lone tile at the end.
- [ ] The story has six steps, ends on "Give it a slot", and the last step zooms out to the whole picture. The track is shorter than before.
- [ ] No window chrome around the story. The cards are readable, and nothing says "See it all at home".
- [ ] Phones (720px and below): no pinned canvas. The six steps run as a timeline joined by a thin line, each step with the one card it's about, readable at full size.

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
- [ ] The sample Home lives on this week's Tuesday, like the hero, so it reads the same on any day.

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
- [ ] Phones: the key becomes a strip of five module chips. A tap steps None, View, Edit, and the hint reads "Tap a module to change what this key can do". A prompt and its result fit on one screen.

## Stack tax and Fast
- [ ] On first view the receipt adds itself up in about a second and a half: each line counts in, the total counts and gets struck, then Moduo's price lands and the savings count up.
- [ ] Switching Just me, Two of us and Team of 5 never changes the receipt's height. The Slack line prints in and out, and the totals count to their new values.
- [ ] Fast lists six shortcuts, with the last two fading. There's no J/K and no E/S/R. The two columns are balanced.
- [ ] On touch screens the line under the shortcuts reads "And many more, at your keyboard." It doesn't ask you to press keys.

## Yours, values, pricing
- [ ] "Yours." uses the same heading size as the other sections. The sentence underneath is a step larger than a normal lead (about 20–26 px), with five promise pills on the text's baseline and their icons centred on the words.
  - On first view the pills light up one after another.
  - Hover, focus or tap a pill to open a small card: export progress, import sources, a revocable key, training locked off, and a hold-to-delete ring.
  - On a phone a tap toggles the card.
- [ ] "What we won't build" is the cards that turn over; the other layouts are gone.
  - The refusal stays readable, with a clear but light strike drawn in after a moment.
  - Hovering near a card's edge doesn't stutter: hover sits on the list item, which never moves.
- [ ] The Free plan lists exactly what it has: tasks, notes, calendar, email and contacts, linked. Chat shows on Duo and Team only. The FAQ plan answer matches.
- [ ] "Compare every plan" has a chevron with space after the label, and the four plan columns are the same width.
- [ ] Phones: the plans have no module icon rows. Those rows rely on hover tooltips, and each plan's list already says the same.

## Made by a duo, shipping, questions
- [ ] "Made by a duo": Maciej Grzywacz (Product and Design) and Mike Grochowski (Engineering) are equal in weight, each with a first-person quote.
  - Both photos are square, from `landing/assets/makers/`.
- [ ] "Shipping every week" is hidden for now. It's commented out in the HTML, and the footer's Changelog shows "soon".
- [ ] Questions: the lead invites a hello or a project chat at hello@moduo.app.

## Close
- [ ] The lead is wider and the waitlist field is as wide as the hero's (33rem), so headline, lead and form read as one column, not an upside-down pyramid.

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
- [ ] No stray construction circle crosses the "d".
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
- The changelog entries are mock data with relative dates.

## Parked: the live app window
- The round-7 hero with the real, clickable Moduo window is saved in full at `landing/parked/live-hero.html`. It isn't deployed: vercel-build ships only `landing/index.html` and `landing/assets`.
- Preview it locally at http://127.0.0.1:8766/parked/live-hero
- It comes back as the first section of the pane once the app UI is final and invites start rolling out. When it does, rebuild its screens from the finished app. Its window shows 24-hour times and a Chat tab drawn in the app's style.
