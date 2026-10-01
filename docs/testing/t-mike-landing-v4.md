# Manual test — Moduo landing v4 rebuild (`t/mike/landing-v4`)

Surface: **web**. Preview with `bun run preview:landing` → http://127.0.0.1:8765. After publishing: https://www.moduo.app.

## Hero

- [ ] Headline words rise in one by one; intro text, buttons and the search box fade in after
- [ ] The search box types "anna", then "friday", then "launch" on its own while it's on screen
- [ ] Click into the box or type → the auto-typing stops for good
- [ ] Typing filters results grouped by People / Tasks / Email / Notes / Calendar / Maps, with the match underlined
- [ ] ↑ / ↓ move the highlight (it slides); the right side shows the item and its linked items
- [ ] Click a linked item → the box quickly retypes and lands on that item (jumping across modules)
- [ ] ⌘K (or /) anywhere on the page scrolls to the box and focuses it
- [ ] "Try" chips under the box run that search

## How it works (scroll story)

- [ ] Scrolling through the section keeps the stage pinned; the steps on the left advance 01 → 05
- [ ] One card morphs between modules: email row → task row → calendar block → note embed → map node
- [ ] The "Linked" chips at the bottom of the stage accumulate (Email, Task, Event, Note, Map)
- [ ] Clicking a step scrolls to that step

## Make it yours

- [ ] Studio / Personal / Side project → the highlight slides, sidebar and widgets change with smooth reflow
- [ ] Turn a module off → it leaves the sidebar and its widgets fade out; turn it back on → they come back where they were
- [ ] Turning off the last module shakes the button and does nothing
- [ ] Drag a widget (mouse anywhere, phone via the grip dots) → others slide out of the way; drop settles smoothly
- [ ] Focus a widget with Tab, then ⌥ + ← / → moves it
- [ ] Each workspace remembers its own arrangement; Reset restores it
- [ ] Today checkboxes tick with a pop; Focus timer counts down; Clock shows your local time

## Principles + close

- [ ] Each "never build" line gets struck through as it scrolls in, then its reason fades in
- [ ] "Get started" / "Sign in" open https://app.moduo.app/auth

## Edge cases

- [ ] macOS Reduce motion → no word rise, no morph animation, no auto-typing tour (search still works)
- [ ] Phone width → no sideways scrolling; story shows one step at a time above the stage; search hides the preview pane

## Known gaps

- Per-workspace module toggles are marketing ahead of the product (not built in the app yet); the mind map is hidden from the app's nav.
- Still `noindex, nofollow`; no og:image.
