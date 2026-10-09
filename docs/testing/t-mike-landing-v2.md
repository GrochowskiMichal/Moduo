# Manual test — Moduo landing v2 (`t/mike/landing-v2`)

Surface: **web** — https://moduo.app (served from `landing/index.html` on `prod-landing`). Preview locally first with `bun run preview:landing` → http://127.0.0.1:8765.

## Deploy

- [ ] `https://moduo.app` → redirects to `https://moduo.app/` (apex is canonical; www redirects to it)
- [ ] Page title reads "Moduo — Fire five apps. Keep the work."
- [ ] No mention of finance, invoices or money anywhere on the page
- [ ] `https://staging.moduo.app` still shows the staging portal

## Hero

- [ ] Headline "Fire five apps. Keep the work." fades in; "Get started" / "Sign in" open `https://app.moduo.app/auth`
- [ ] "Build your workspace" scrolls to "Make it yours"
- [ ] App window: click a task row → it becomes selected and the right "Linked" rail changes; click a circle → it checks off with a pop

## The stack tax

- [ ] Scroll to it → after ~1.5s the six tabs collapse into one "Moduo — everything" tab and the counters drop to 1
- [ ] "Bring the chaos back" restores the six tabs; "Close five tabs" collapses them again

## Five tools. One brain (feature tabs)

- [ ] Tabs Tasks · Notes · Email · Calendar · Mindmap switch the panel; ← / → keys move between tabs when one is focused
- [ ] Tasks: the focus timer counts, the progress bar fills
- [ ] Notes: the slash menu sits under the `/ta` line and covers nothing
- [ ] Email: the "Make a task" pop-up doesn't cover the next email
- [ ] Calendar: blocks line up with their hours
- [ ] Mindmap: click any branch → a pop-up opens beside it (toward the centre) without covering other nodes; "Turn into N tasks" toggles to done and back

## How it links / Make it yours

- [ ] Contact rollup and the email → task → calendar → note chain render without overlaps
- [ ] Workspace switch Studio / Personal / Side gig → modules, sidebar and board all change
- [ ] Turn a module off → it disappears from the sidebar and its widgets leave the board; turn it back on → a default widget returns
- [ ] Try to turn off the very last module → the switch shakes and stays on
- [ ] × on a widget removes it; "Add widget" opens the gallery (Esc / outside click closes it); "Reset" restores the preset

## Rest of the page

- [ ] Day one: the capture box types a task and drops it into Inbox, repeating
- [ ] What we refuse to build: strike-through lines animate in on scroll
- [ ] Close CTA + footer links work

## Edge cases

- [ ] macOS "Reduce motion" on → no auto-collapse animation or typing, content shows statically
- [ ] Phone width (390px) → no sideways scrolling; "Make it yours" stacks controls above the board
- [ ] Tab through the page → visible focus rings on tabs, switches and buttons

## Known gaps

- Per-workspace module on/off and the custom widget board are **marketing ahead of the product**: the app has the widget board, but module toggles per workspace aren't built yet, and the mindmap is still hidden from the app's nav.
- Page is still `noindex, nofollow`; no og:image.
