# Manual test: landing v7 (`t/maciej/landing-v4`)

Mike's v5 look, rebuilt section by section to match the real app and the 2 October decisions.

Surface: **web, localhost only**. Run `PORT=8766 bun scripts/preview-landing.ts`, then open http://127.0.0.1:8766.

⚠ Waitlist forms post to the **production** Supabase. They return 403 from localhost:8766 (that origin isn't allowlisted). Don't add it.

Check the page at three sizes: 1512 × 982 (laptop), 2560 × 1440 (4K at 150%) and 390 px (phone).

## Header
- [ ] The logo reads "moduo" in lowercase, with a larger mark. The links sit in the centre with no numbers. The button reads "Join the waitlist", the same label as every form.
- [ ] Over the hero the bar is transparent: only its content shows.
- [ ] As the pane reaches the bar, the glass fades in smoothly and never jumps. Scroll slowly back and forth around that point to check.
- [ ] When docked, the progress line runs edge to edge on the bottom edge as a gradient, and a soft light spreads up into the glass from its tip.
- [ ] Phone, and any screen where the hero scrolls normally: the glass appears as soon as you scroll.

## Hero stage
- [ ] On desktop the hero holds still while the pane slides over it.
- [ ] The frame is vertically centred, with air above and below. It's wider on 4K, and the header content lines up with its edges.
- [ ] The top row has three quiet facts (private beta, platforms, founding price) in sentence case: no mono, no dots, no green pill.
- [ ] The headline is sentence case on exactly two lines: "Fire ten apps. / Keep the work."
- [ ] The form is the biggest control. The note under it reads "One email when your invite is ready. No spam."
- [ ] Rulers run on the top and left edges. Inside the frame a notch and a number follow the pointer.
- [ ] The windows drift with the pointer anywhere over the hero, not only over the mockup.
- [ ] The counters band is compact: Apps 10 → 01, Subscriptions 06 → 01, Search bars 10 → 01.

## Hero assembly
- [ ] The tab strip above the mockup shows ten crowded tabs and "10 tabs". On assembly it folds into one "moduo · Home" tab and "1 tab".
- [ ] "Your stack today": ten windows pile around the centre, with no Moduo window behind them.
- [ ] "With Moduo": a light, wireframe-like shell.
  - Top bar: logo, module icons and an avatar placeholder.
  - Bottom bar: one narrating line that changes as modules are traced.
  - No bright outline around the bars, and no clipped corners.
- [ ] Five links, none crossing. Hover the mockup, then click "With Moduo": no jump. The switch doesn't bounce.

## Pane and lineup
- [ ] The pane edge looks like a frosted sheet with square corners, no outline and no lighter slab. While it covers the hero, the hero shows blurred through its top.
- [ ] The lineup starts a bit lower than before.
  - Seven tiles; Chat is dashed and tagged "Coming".
  - The hover arcs and the auto tour work.
  - The feature strip loops without a jump and can be dragged.

## How it connects
- [ ] The heading reads "Open anything. See everything it touches."
- [ ] Seven steps with no trailing periods, from "A message lands" to "See it all at home".
- [ ] The stage is bigger. Each step frames only its cards (camera), and step 7 zooms out to the whole graph.
- [ ] The window title follows the step: Inbox, Inbox · Anna Carter, Anna Carter, Task, Task · Jamie Ross, Calendar · Friday, Home.
- [ ] No "Copied 0", no "Sam", no "Carter Studio". Jamie's card says "Assigned by you".

## Make it yours
- [ ] The board shows more cards: four columns, 9 or 10 widgets per workspace.
- [ ] The picker bar at the bottom changes the preview only.
  - Settings: theme, 6 shades, 8 accents, font, density, corners.
  - "Surprise me" mixes everything except light/dark.
- [ ] Dark → Light fades inside the preview; the page stays dark.
- [ ] The accent shows on done checkboxes, "Add widget" and the progress ring.

## Any AI
- [ ] The model switch changes the assistant's name. "Local model" reads "Llama in LM Studio · runs on this Mac".
- [ ] Set Email to None, then ask "Link Maya's emails…": the tool row turns amber, the Email row flashes, and the assistant says it can't see email.
- [ ] Set it back to View: the link is made and the note tile updates.
- [ ] The training note says we don't train models, plus the provider caveat.

## Stack tax
- [ ] Monthly prices.
  - Just me: $85.99 vs Moduo Pro $12.
  - Two of us: $189.48 vs Duo $20; Slack Pro appears.
  - Team of 5: $473.70 vs Team $75.
- [ ] The struck total is as big as the Moduo price.

## Fast
- [ ] Eight shortcut rows taken from the app's real keys, plus the "and many more" line. Pressing T, J, K, E, S, R, ? or ⌘1–6 lights the matching row.
- [ ] The ⌘K demo looks like the app's palette.
  - Empty: Navigate and Actions.
  - Typing: Tasks, Notes, Contacts, Email and Events, with type badges.
  - No preview pane and no footer. The typing tour still runs.

## Yours, shipping, on purpose
- [ ] "Yours" is a settings-style panel: Export, Import, AI keys, training "Never", Delete.
- [ ] "Shipping every week" has five mock entries dated relatively (This week … Last month).
- [ ] "What we won't build": the answers are larger than the struck lines.

## Pricing
- [ ] Four plans with module icons.
  - Chat is dimmed on Free and Pro, dashed with a dot on Duo and Team.
  - Prices: yearly $0 / $10 / $16 for two / $12 a seat; monthly $0 / $12 / $20 / $15.
  - Founding price lines line up near the buttons.
- [ ] "Save 20%" is a pill. "Compare every plan" opens a table.

## Made by two, FAQ, close
- [ ] The founders section shows placeholders: [Maker name], [Role] and photo frames.
- [ ] The FAQ has ten questions, matching the decisions on platforms, offline, training and plans.
- [ ] The close shows the platform chips (Mac and Web in beta, Windows next, phones later) and the large form.
- [ ] After joining (on prod), the success box shows an unticked "Also send me build updates" box. It only shows "on" once the server confirms.

## Share image
- [ ] `/assets/og.png` loads (1200 × 630). The head has og:image and a large Twitter card.

## Known gaps
- **Waitlist opt-in backend is not live yet.** Needs `supabase/migrations/20261002120000_waitlist_updates_opt_in.sql`, then a redeploy of `waitlist-join`, in that order. Until then the checkbox shows "Couldn't save that."
- Social links: LinkedIn exists but its tagline is outdated. The X, Product Hunt, GitHub and YouTube links 404, and the Discord invite is invalid. Waiting for the real links.
- Privacy, Terms, About, Changelog and Download for Mac are "soon" placeholders.
- Founders' names, photos and lines are placeholders.
- The changelog entries are mock data.
