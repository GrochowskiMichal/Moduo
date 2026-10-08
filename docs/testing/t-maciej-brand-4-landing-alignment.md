# Manual test checklist — BRAND-4 landing alignment

> Generated 2026-10-08 · branch `t/maciej/brand-4-landing-alignment` (PR into `prod-landing`) · **Live-verified:** yes, locally (`bun run preview:landing`) in headless Chromium at 1440, 1024, 390 and 320px, plus reduced motion; no console errors, no sideways scroll. Not checked on a Vercel preview (En5hi-authored commits don't deploy until Mike merges).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

Local preview: `PORT=8765 bun scripts/preview-landing.ts`, then open http://127.0.0.1:8765/ in a **new tab** (typing the URL counts as arriving from outside).

## Nav lockup and the reveal (landing)
- [ ] **Do:** open http://127.0.0.1:8765/ in a fresh tab → **Expect:** top left, the mark appears out of nothing: two thin slivers grow on both sides while the windows stay empty, the three strokes settle in under a second, then "moduo" fades in beside it. It plays once and stays still. _(web)_
- [ ] **Do:** compare the nav logo with the old one on moduo.app → **Expect:** the drawn lockup artwork (bigger mark, drawn letters), not the typed "moduo" in Geist. _(web)_
- [ ] **Do:** reload the page (⌘R) → **Expect:** no reveal; the lockup is simply there. _(web)_
- [ ] **Do:** open /privacy, click the logo to go back to the landing → **Expect:** no reveal (you came from inside the site). _(web)_
- [ ] **Do:** open http://127.0.0.1:8765/#pricing in a new tab → **Expect:** no reveal (a link to a section). _(web)_
- [ ] **Do:** turn on System Settings → Accessibility → Display → Reduce motion, open the landing in a new tab → **Expect:** no slide; the whole lockup fades in quickly. _(web)_
- [ ] **Do:** narrow the window to phone width (390px, and 320px) → **Expect:** the full lockup stays in the nav next to "Join the waitlist" (phones used to show the mark alone); nothing overlaps. _(web)_

## Footer
- [ ] **Do:** scroll to the footer → **Expect:** first cell shows the lockup at the top, then the headline **"One window for the whole working life."** (the old "The last productivity app you'll ever set up." is gone), the lede at the bottom of the cell. _(web)_
- [ ] **Do:** check the rest of the footer → **Expect:** unchanged: link columns, the "Depth 14" wireframe mark, the wordmark plate ("Point at the letters…"), the legal bar. _(web)_

## Text pages (manifesto, privacy, terms)
- [ ] **Do:** open /manifesto, /privacy and /terms → **Expect:** the nav shows the lockup artwork (no typed "Moduo"), dark in light mode and white in dark mode; the "Light"/"Dark" toggle flips it. No reveal on these pages. _(web)_

## Share image
- [ ] **Do:** open http://127.0.0.1:8765/assets/og.png → **Expect:** the same card as before, with the drawn lockup top left instead of the typed "moduo"; the headline, grid, frame and product picture are untouched. _(web)_
- [ ] **Do:** after Mike merges, paste https://www.moduo.app into the LinkedIn Post Inspector or opengraph.xyz → **Expect:** the new card (social sites cache the old one; the inspector refreshes it). _(web)_

## Code-level checks (no visible change)
- [ ] **Do:** search `landing/` for `--ai` → **Expect:** no matches. The "Make it yours" accent picker still offers pink as one of eight accents. _(web)_
- [ ] **Do:** search `landing/` for colour, centre, grey, honour, behaviour, travelling, favourite → **Expect:** no matches (only `aria-labelledby`, which is the HTML attribute's real name). _(web)_
- [ ] **Do:** read `landing-agents-readme.md` → **Expect:** it points to the brand brief, uses "Fire ten apps. Keep the work." as the hero line and "One window for the whole working life." as the brand line, has a Logo section (lockup rules), the reveal under Motion, no "AI disc", module order email, tasks, notes, calendar, contacts, chat. _(repo)_

## Known gaps / not-yet-testable
- Not checked on Safari or Firefox (the reveal uses SVG masks and attribute transforms, which both support). Worth one look in Safari.
- The Vercel preview won't build for En5hi-authored commits; the landing build was reproduced locally instead (see the PR).
- The masters are provisional (BRAND-0). When Maciej redraws them, the lockup paths, the reveal stroke and og.png need re-copying (see the readme's Logo section).
