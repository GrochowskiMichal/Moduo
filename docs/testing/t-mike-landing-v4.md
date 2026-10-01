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
- [ ] 01: a "New mail · Anna Carter" pill drops in, then unfolds into the email card; the words fade in one by one
- [ ] 02: a light sweeps across the email; "demo on Thursday", "the 15th", "website redesign" highlight and fly out as chips to the Calendar and Project cards; lines draw behind them
- [ ] 03: the Project card expands: progress ring 4 of 7, three open subtasks. Ticking one strikes it, moves the ring and updates the status line
- [ ] 04: Client card (Anna, a Jun → Sep → Thu history that draws in) and the Deal "Phase 1 · Won"
- [ ] 05: Time card bars grow and hours count up to 38h 20m; the invoice suggestion builds line by line, total counts to €4,600
- [ ] Little dots travel along every live connection; the current step's connections show why they're linked ("the meeting", "attendee", "not billed"…)
- [ ] Hover a card → its connections light up with reasons, everything else dims (phone: tap a card)
- [ ] Drag any card with the mouse → lines follow live; "Reset layout" puts everything back smoothly
- [ ] "Draft invoice" → a "Draft #014" stamp lands; status says what it's linked to
- [ ] Bottom bar: status types itself; "Connections" ticks up to 8 with a bump; "Tagged by you" stays 0
- [ ] Clicking a step scrolls to it; scrolling back up removes cards quickly, scrolling down replays

## Make it yours (board + store)

- [ ] No module sidebar; the board header shows the installed modules as small icons, plus a "+"
- [ ] Clicking a module icon opens the store on Widgets, filtered to that module; "+" opens the store on Modules
- [ ] Store → Modules: Installed and Available lists. Install adds the module and its default widget to the board; Remove takes the module and its widgets off (footer says how many)
- [ ] Removing the last module shakes the row and says a workspace needs at least one module
- [ ] Store → Widgets: search + category chips (green dot = installed). Widgets from uninstalled modules say "Add · installs …"; adding one flies it onto the board and installs the module
- [ ] Drag a widget's bottom-right corner → it snaps between sizes (up to 3 wide × 2 tall) with a size badge; neighbours reflow smoothly
- [ ] Click the corner (or Enter on it) → cycles Small → Wide → Tall → Large; ⌥ ⇧ arrows resize from the keyboard
- [ ] Tall number widgets show a small trend chart; the Today list fades out at the bottom instead of cutting a row
- [ ] Customize (sliders icon): rename live, pick a size, pick a color (number, chart, ring and meter take the color), toggle "Show details", "Remove from board"; Escape or clicking outside closes it
- [ ] Studio / Personal / Side project each keep their own modules, sizes and colors; Reset restores the preset
- [ ] Drag to rearrange still works (phone: via the grip dots); Timer counts up, Focus counts down

## AI over MCP

- [ ] Scrolling to it auto-runs "What's left before the Carter demo?"
- [ ] Each prompt: user bubble → tool calls spin then tick with a result → answer streams in
- [ ] Switching prompt mid-run cancels the previous run cleanly
- [ ] Bottom row shows allowed permissions ("Send email · asks first")

## Close

- [ ] No "Things we will never build" section; nav has How it connects · Make it yours · AI
- [ ] Close section shows the email field + "Join the waitlist" (no "Get started" / "Sign in"); note reads "Early access opens in waves…"

## Waitlist (Supabase `waitlist-join`)

- [ ] Nav: one "Join waitlist" button (no "Sign in") → opens a dialog with the mark, title, email field; focus lands in the field
- [ ] Dialog closes with Esc, the × button and a click on the dimmed backdrop; clicking inside the card does not close it
- [ ] Footer "Join the waitlist" link opens the same dialog; https://www.moduo.app/#waitlist opens it on load
- [ ] Hero: email field + "Join the waitlist", note "One email when your invite is ready. No spam.", then "See how it connects ⌄"
- [ ] Submit empty → red outline + "Enter your email to join."; type → error clears
- [ ] Submit `anna@carter` → "That email doesn’t look right — check it and try again."
- [ ] Submit a real address → spinner on the button, then green "You’re on the list. We’ll email <address>…" in hero, close AND dialog; nav button turns into "✓ You’re on the list"
- [ ] Reload → still shows "You’re on the list" everywhere (remembered on this browser)
- [ ] "Use a different email" → every form back to empty; the waitlist row is NOT deleted
- [ ] Submit the same address again → still "You’re on the list" (no "already registered" message — by design)
- [ ] Supabase dashboard → Table editor → `waitlist`: the row has lowercase email, `source` = hero/close/nav, `status` = pending, `ip_hash` (64 hex chars), no raw IP
- [ ] DevTools offline → submit → "Couldn’t reach the server. Check your connection and try again."
- [ ] 9+ submits from one network within an hour → "Too many tries from this network…"

## Edge cases

- [ ] macOS Reduce motion → no word rise, no fly-in, no auto-typing tour; everything still works
- [ ] Phone width (390px) → no sideways scrolling; modules become a horizontal strip; store fills the card; AI panel stacks and fits; widget numbers fit their tiles

## Known gaps

- Relations, widget store, budgets, invoicing, time tracking, goals and per-workspace modules are vision ahead of the product (copy says "on the way", no "Soon" tags).
- Still `noindex, nofollow`; no og:image.
- Waitlist sends no confirmation email to the signer and no notification to the team (rows are read in the Supabase dashboard). No double-opt-in yet — `status` stays `pending` until that exists.
- The live endpoint only accepts moduo.app, www.moduo.app, `moduo*.vercel.app` and the local preview (127.0.0.1/localhost:8765). Another preview domain needs adding to `ALLOWED_ORIGINS`.
