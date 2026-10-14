# Manual test — Moduo landing page (`t/mike/landing-agents-readme`)

Surface: **web** — https://moduo.app (served from `landing/index.html` on `prod-landing`).

## Deploy

- [ ] `https://moduo.app` → redirects to `https://moduo.app/` (apex is canonical; www redirects to it)
- [ ] Page title reads "Moduo — One window for the whole working life"
- [ ] `https://staging.moduo.app` still shows the staging portal (it builds `landing/staging.html`, not this page)

## Hero

- [ ] Headline "One window for the whole working life." and the manifesto fade in on load
- [ ] "Get started" and "Sign in" open `https://app.moduo.app/auth`
- [ ] "See how it links" scrolls to the email → task section
- [ ] Nav gets a thin bottom border after scrolling a little
- [ ] In the app window, click another task row → it becomes selected and the right "Linked" rail swaps its contents
- [ ] Click a task's circle → it checks off green with a small pop; click again → unchecks

## Sections

- [ ] How it links: inbox on the left, task created from the email on the right; the "Make a task" pop-up doesn't cover any text
- [ ] Your day: blocks line up with their hours; the "now" line sits at ~12:15 without crossing text
- [ ] People & money: contact rollup + August number; the bars grow in when scrolled into view
- [ ] Day one: the capture box types a task, then it drops into Inbox, and repeats
- [ ] Principles: four blocks (Instant, Fair, Yours, Bring your own AI)
- [ ] Close: "Stop stitching five apps together." + Get started; footer links work

## Edge cases

- [ ] macOS "Reduce motion" on → no slide/blur animation, capture text shows statically
- [ ] Narrow the window to phone width → no sideways scrolling; app window collapses to the task list
- [ ] Tab through the page → every link shows a visible focus ring; "Skip to content" appears first

## Known gaps

- The page is still `noindex, nofollow` (kept from the placeholder), so search engines won't list it yet.
- No social share image (og:image) yet — the landing build only ships one HTML file.
- Mock data in the product frames (names, amounts) is illustrative.
