# Manual test — Moduo landing v4/v5 rebuild (`t/mike/landing-v4`)

Surface: **web**. Preview with `bun run preview:landing` → http://127.0.0.1:8765. After publishing: https://www.moduo.app.

## Hero

- [ ] Headline "Every app you need. / None you don’t." rises in word by word; intro, buttons and search box fade in after
- [ ] Intro names the core five plus "planning, time tracking, invoicing, goals and more on the way"
- [ ] The search box types "anna", then "phase 1", then "launch" on its own while it's on screen
- [ ] Click into the box or type → the auto-typing stops for good
- [ ] Results are grouped by module (People, Tasks, Email, Notes, Calendar, Maps, Deals, Time, Invoices, Goals), match underlined
- [ ] ↑ / ↓ move the highlight; the right side shows the item and its linked items; clicking a linked item jumps to it
- [ ] ⌘K (or /) anywhere scrolls to the box and focuses it; "Try" chips run that search
- [ ] Below: "One app · switch modules on per workspace" label, then a slow scrolling strip of modules ending in "& more"

## How it connects (smart relations scroll story)

- [ ] Scrolling keeps the stage pinned; steps advance 01 → 05; the stage is empty ("Listening for new mail") until you reach it
- [ ] 01: a "New mail · Tomasz" pill drops in, then unfolds into the email card; the words fade in one by one
- [ ] 02: a light sweeps across the email; "demo on Thursday", "the 15th", "Kowalska Phase 2" highlight and fly out as chips to the Calendar and Project cards; lines draw behind them
- [ ] 03: the Project card expands: progress ring 4 of 7, three open subtasks. Ticking one strikes it, moves the ring and updates the status line
- [ ] 04: Client card (Anna, a Jun → Sep → Thu history that draws in) and the Deal "Phase 1 · Won"
- [ ] 05: Time card bars grow and hours count up to 38h 20m; the invoice suggestion builds line by line, total counts to €4,600
- [ ] Little dots travel along every live connection; the current step's connections show why they're linked ("the meeting", "attendee", "not billed"…)
- [ ] Hover a card → its connections light up with reasons, everything else dims (phone: tap a card)
- [ ] Drag any card with the mouse → lines follow live; "Reset layout" puts everything back smoothly
- [ ] "Draft invoice" → a "Draft #014" stamp lands; status says what it's linked to
- [ ] Bottom bar: status types itself; "Connections" ticks up to 8 with a bump; "Tagged by you" stays 0
- [ ] Clicking a step scrolls to it; scrolling back up removes cards quickly, scrolling down replays

## Make it yours (board + widget store)

- [ ] Studio / Personal / Side project → highlight slides, modules and board change with smooth reflow
- [ ] Turn a module off → its widgets fade out; back on → they return; last module can't be turned off (shake)
- [ ] "Add widget" opens the store: 26 widgets across 13 modules, search + category chips filter it
- [ ] Widgets already on the board say "On your board"; adding one from a switched-off module turns the module on
- [ ] Added widget flies from its store card to the board and glows briefly; × removes a widget
- [ ] Drag to rearrange (phone: via grip dots); Tab-focus + ⌥ ← / → moves; Reset restores the workspace
- [ ] Timer counts up, Focus counts down, Clock shows local time

## AI over MCP

- [ ] Scrolling to it auto-runs "What's left before the Kowalska demo?"
- [ ] Each prompt: user bubble → tool calls spin then tick with a result → answer streams in
- [ ] Switching prompt mid-run cancels the previous run cleanly
- [ ] Bottom row shows allowed permissions ("Send email · asks first")

## Principles + close

- [ ] Each "never build" line strikes through on scroll; the AI one says "Bring your own over MCP"
- [ ] "Get started" / "Sign in" open https://app.moduo.app/auth

## Edge cases

- [ ] macOS Reduce motion → no word rise, no fly-in, no auto-typing tour; everything still works
- [ ] Phone width (390px) → no sideways scrolling; modules become a horizontal strip; store fills the card; AI panel stacks and fits; widget numbers fit their tiles

## Known gaps

- Relations, widget store, budgets, invoicing, time tracking, goals and per-workspace modules are vision ahead of the product (copy says "on the way", no "Soon" tags).
- Still `noindex, nofollow`; no og:image.
