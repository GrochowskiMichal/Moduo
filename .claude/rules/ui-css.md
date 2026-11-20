---
paths: ["apps/app/src/**/*.tsx", "apps/app/src/global.css", "apps/app/src/styles/**"]
incident: "Board columns scrolled sideways under a classic scrollbar (MOD-143), the List ringed itself on every reload (MOD-121), and plain size classes on Avatar/Separator never applied (TV-U1)"
expires: 2027-01-31
---

# Layout, CSS and tokens (app code)

Compiled from the UI gotchas (HV-14b). Token rules themselves are in [docs/DESIGN_SYSTEM.md](../../docs/DESIGN_SYSTEM.md) and [docs/DESIGN_RULES.md](../../docs/DESIGN_RULES.md); `lint:tw`, `lint:css` and `lint:ast` (`primitive-size-class-overridden`) enforce the mechanical part.

## Scrollbars and scroll boxes
- `scrollbar-width` (Tailwind's `scrollbar-thin`) makes Chromium ignore every `::-webkit-scrollbar` rule for that element; pair it with `scrollbar-color`. Hide a bar with `.no-scrollbar` (`apps/app/src/global-css.test.ts` fails the bare utility).
- `.pane-scroll` (a stable gutter) goes on the element that scrolls, never on a wrapper whose child scrolls; side panels drop it. Excluded on purpose: the calendar hours grid, the calendar rail, the notes Outline, Radix `ScrollArea`.
- A classic scrollbar (a mouse, "Always", Windows, older WKWebView) takes 10–11 px of width: nothing inside a scrolling column has a fixed width equal to its inside, and a sideways-safe column is `overflow-x-hidden`. Headless Chromium hides bars unless launched without `--hide-scrollbars`.
- An auto-growing `rows={1}` textarea keeps `overflowY: hidden` until `scrollHeight` passes its max height.
- `overflow: hidden` makes an element the box its sticky children stick to; use `overflow-clip` when you only need the clipping. `overflow-x: clip` beside a scrolling `overflow-y` computes to `hidden`.
- `overflow-y: auto` makes `overflow-x` auto too: "does this scroll sideways?" needs `scrollWidth > clientWidth`.
- A hidden copy kept for measuring still widens its scroll box: put it in a `size-0 overflow-hidden` box with `w-max`.
- Sideways swipes: `overscroll-behavior-x: none` on `html, body` and `overscroll-x-contain` on sideways scrollers; headless Chromium can't show swipe chaining, so check the computed value.

## Flex, grid and sizing
- A flex item that is also a flex container needs `min-h-0`, and each level fills through flex, not chained `h-full`.
- A virtual list's box in a flex column is `shrink-0`, or it shrinks to the screen and never scrolls.
- `ch` is measured in the font of the element that carries the width: put the cells' face on the sized element itself.
- `nth-child` follows the DOM, not flex items: it skips the children of a `display: contents` wrapper. A truncating `min-w-[10ch]` is capped `min-w-[min(10ch,100%)]`.
- A 15 px title at the body's 1.5 line height grows a dense row past `--row-h`: hand-built rows take `leading-snug`, as `RowTitle` does.
- A primitive's `data-[…]:` size variant beats a plain size class (`Avatar size="…"` + `size-4`, vertical `Separator` + `h-4`): use the `size` prop, or size on the same variant.
- A contenteditable must not be a flex child (Chrome mis-focuses); the notes editor sits in a grid wrapper.
- `mask-image` masks everything on the element, focus rings included.
- Tailwind's preflight `img { height: auto }` beats the `height` attribute; reserve an image box in CSS.
- `CSSProperties.zIndex` rejects a `var()` string: use `z-(--z-…)` classes.
- `react-resizable-panels` v4 hit-tests separators by geometry (`resizeTargetMinimumSize`) and exposes `data-separator`; `::before` reach and `data-dragging` do nothing (`apps/app/src/components/ui/resizable.tsx`).

## Fills, states and theme
- A translucent state fill replaces an opaque rest fill: a filled control hovers one step up the ladder (`bg-state-active` → `bg-state-active-hover`).
- In Tailwind v4 `aria-*:` and `data-*:` variants come after `hover:`, so the current state wins over hover.
- A full-strength hover edge outshines the 32 % selection ring: drop it below (`hover:border-foreground/30`).
- A scoped `data-accent` wrapper defeats theme-compound rules keyed on `<html>`: write both `[data-theme="light"][data-accent="mono"]` and `[data-theme="light"] [data-accent="mono"]`. A wrapper that sets `--primary` some other way leaves the derived tokens on the outer value; add the attribute instead (`apps/app/src/styles/tokens.css` §5b).
- Small caps are for fixed chrome: `<Eyebrow>{expr}</Eyebrow>` fails `lint:tw` unless the expression is on `SMALL_CAPS_CHROME` (`scripts/check-text-rules.ts`), so pass literal text or list it with where the words come from. Names a person typed go in `GroupHeader`. `command.tsx` keeps its eyebrow recipe in sync by hand. The same check fails the word `capitalize` anywhere in quotes or spaces, so name a helper differently.

## Motion
- Pick the motion token by what you animate: `--motion-fade` stays on under reduced motion (opacity and colour only); movement uses the zeroed `--motion-*` tokens.
- A decorative loop with a hard-coded duration needs a `:root[data-motion="reduced"]` companion and `:root:not([data-motion="full"])` on its reduce media query, or the in-app motion setting misses it (`apps/app/src/global.css`).
- Translate a whole pane with an inline transform and a token CSS transition, so the end state is always committed (a JS tween froze mid-slide in a frame-starved tab).
- `.motion-pop` lists both tooltip states (`delayed-open`, `instant-open`).

## Measuring in a browser
- `getComputedStyle` can report a transitioned property's old value indefinitely after a token or theme flip: disable transitions (`*{transition:none!important}`) and reflow, or trust the element's resolved custom property and a screenshot.
- Custom properties read back minified from the dev build (`.1s`, `0s`): parse to ms before comparing. Computed colours come back as `oklch(…)`.
- jsdom resolves no custom properties and lays nothing out: token scoping tests read the stylesheet (`apps/app/src/styles/tokens.test.ts`); sizes are measured in a browser.
- "The app looks huge on web" was browser zoom: check it before chasing density.
