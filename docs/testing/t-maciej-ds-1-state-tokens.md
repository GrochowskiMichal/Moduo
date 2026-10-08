# Manual test checklist — DS-1 state tokens, global scrollbars, Storybook appearance

> Generated 2026-10-08 · branch `t/maciej/ds-1-state-tokens` · **Live-verified:** partial. Checked by the agent in Storybook (the StateLadder story under dark and light, four shades, three accents, all three densities; the Chat workspace and Contact hub stories; the ScrollArea thumb) and in the web app on `/auth` (signed out, with a blue accent stored). The signed-in modules weren't opened live: the preview browser had no session, and signing in to hosted auth with a password is off-limits for the agent.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Storybook appearance toolbar (DS-AC10)
- [ ] **Do:** `bun run storybook`, open any story → **Expect:** the toolbar has six menus: Theme, Shade, Accent, Density, Radius, Font (no Text size) _(Storybook)_
- [ ] **Do:** switch each menu in turn on `Components/ui/button` → **Expect:** the preview restyles every time: light/dark canvas, tinted surfaces, accent colour on the primary button, row/control heights, corner radius, typeface _(Storybook)_
- [ ] **Do:** pick Dense on `Features/dashboard/widgets` → Gallery (it sets its own density), then open another story → **Expect:** the next story renders at the toolbar's density, not the Gallery's _(Storybook)_

## State layer (token half of DS-AC1, DS-AC11)
- [ ] **Do:** open `Foundations/StateLadder`, dark theme, Black shade, Mono accent → **Expect:** on Card, Background, Popover and Muted, the Hover, Active and Selected rows are three different fills; in the Before column, Hover and Active are the same grey (the bug this fixes) _(Storybook)_
- [ ] **Do:** repeat on Warm, Plum and Forest with Blue, Amber and Mono → **Expect:** Selected carries the accent; Hover and Active stay neutral and distinct. Mono is the closest pair (Active vs Selected); "Selected + hairline" separates them clearly — that's the call DS-2 makes _(Storybook)_
- [ ] **Do:** in StateLadder, look at "Raised plate" on dark, then switch to light → **Expect:** on dark, the current segment (Board) is lighter than its track; on light it's a white plate with a soft shadow _(Storybook)_
- [ ] **Do:** sign out, set a hue accent (e.g. Blue) in Settings first, then open `/auth` and the public booking page → **Expect:** both stay monochrome, including any selected booking chip (it used to show your hue) _(web)_

## Scrollbars (DS-AC3)
- [ ] **Do:** open Tasks, Notes, Calendar, Email, Contacts, Chat and Settings → **Expect:** every scrolling pane shows the same thin, quiet scrollbar (no thick native bars), in dark and light _(web + desktop)_
- [ ] **Do:** with macOS set to "Show scroll bars: Always", grow a short list until it scrolls (add tasks to an empty bucket, expand a notes folder) → **Expect:** the rows don't shift sideways when the bar appears _(web + desktop)_
- [ ] **Do:** open the public booking page and scroll the day chips sideways → **Expect:** no visible scrollbar under the chips _(web + desktop)_
- [ ] **Do:** open Contacts with a long directory and hover the left list → **Expect:** its overlay scrollbar thumb uses the same quiet colour as the native bars _(web)_
- [ ] **Do:** check the desktop app on macOS older than 15.2 if you have one → **Expect:** thin pill-shaped bars, not the old thick ones _(desktop)_

## Edge cases
- [ ] **Do:** switch density Comfortable → Compact → Dense in Settings while on Tasks and Notes → **Expect:** panes keep their scrollbars and gutters; nothing overlaps or clips _(web)_
- [ ] **Do:** light theme on Calendar week view → **Expect:** day headers still line up with the hour-grid columns (the grid was deliberately left without the gutter) _(web)_

## Migrations / data
- None. CSS tokens, classes, Storybook and tests only.

## Known gaps / not-yet-testable
- Signed-in module panes were not opened live by the agent (no session in the preview browser). The Chat and Contacts stories render the real panes with the new classes and were checked.
- Old-WebKit rendering (pre-18.2 WKWebView) was not observable here; the `::-webkit-scrollbar` path is covered by `src/global-css.test.ts`, not by eye.
- Visual baselines (`tests/visual/state-ladder.spec.ts`) belong to DS-2, which restyles the primitives and regenerates them deliberately.

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
