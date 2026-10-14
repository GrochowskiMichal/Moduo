# CV-0-S1 — Spike 1: the message list in the real webviews

> Branch `t/maciej/cv-0-s1-list` · head: the commit that adds this file (base `02c18c75`) · status: built, not landed
> Migration: none. Nothing in `src/`; the harness is `scripts/spikes/chat/s1/` (TanStack only). The Legend List variant, with `@legendapp/list@3.6.0` in its `package.json`, is on `t/maciej/cv-0-s1-legend`.

**Verdict: TanStack Virtual stays (decision #16 holds).** With four settings (below) it clears every bar in Chromium and in WebKit (WKWebView): 0 px anchor drift on 10 × 10 prepends, folds, edits above the viewport while scrolling up, arrivals and density switches; jumps land within 0.03 px; no frame over 18 ms in a 2 s fling; ≤ 200 elements in the stream. **Legend List 3.6.0** passes in Chromium out of the box but **fails the prepend bar in WebKit** (the anchor row drifts 3.38 px, the same in 5 of 5 runs) and keeps ~1,510 elements in the DOM. It stays the runner-up.

**One gap:** WebKit was measured in a plain WKWebView host (the same system WebKit the desktop app uses), not inside the Tauri window. The Tauri app built (10 s incremental) and started the run, but macOS kept its window off screen during this unattended session (most likely a full-screen Space in front), and WebKit draws no frames for a window that isn't on screen. The Tauri-window pass and real trackpad momentum are in the manual checklist.

## Delivered against the row

- **The harness, `scripts/spikes/chat/s1/`.** Its own Rsbuild entry over the app's config (`rsbuild.config.ts`: same React Compiler, aliases and defines, dev build), so nothing in `src/` mounts it. `harness/fixture.ts`: 10,000 seeded messages over ~318 days (50 % one-liners, 22 % paragraphs, 8 % long multi-paragraph, 7 % code blocks, 5 % images with stored sizes, links, Polish text), 50 reply chains with replies in the stream, ~300 day boundaries. `harness/tanstack-stream.tsx` is the `MessageStream` candidate; `harness/rows.tsx` the compiled rows (avatar, name, time, body, code, image box, folded chain) at three densities.
- **The runner, `harness/runner.tsx`, runs inside the page** so one harness measures every engine. Each anchoring check samples **every painted frame** (after layout and after the libraries' ResizeObserver callbacks, through a sentinel observer created after theirs), so a one-frame flash counts. Results go to a collector (`collect.ts`) as `results/<engine>.json`; `summary.ts` prints them.
- **Drivers:** `run-chromium.ts` (Playwright's Chromium 153, headed), `wkhost.swift` (a WKWebView in a floating, non-activating panel that quits itself), `run-tauri.ts` (the desktop shell under its own identifier `com.moduo.spike-s1`, so it never opens the installed app's data).
- **Results:** `results/chromium.json` (TanStack: 8 configurations, 89 checks; Legend), `results/chromium-dpr2.json` (pixel ratio 2), `results/wkwebview.json` (both libraries), `results/wkwebview-repeat.json` (the anchoring checks 10× in a cold WebKit: 50/50 pass), `results/wkwebview-repeat-legend.json` (Legend's prepend 5×: 5/5 fail at 3.38 px).

`bun run verify` on this branch: typecheck, Biome, `lint:tw`, `lint:css` pass; 4,256 of 4,257 tests pass. The one failure is the local-stack check `supabase/tests/chat_privacy.test.sql` ("C reads the public channel Q's typing topic"), which reads the shared local database; this branch touches nothing in `src/` or `supabase/`. The harness typechecks on its own (`tsc -p scripts/spikes/chat/s1/tsconfig.json`) with `@legendapp/list` absent.

Run it: `MODUO_TARGET=desktop ./node_modules/.bin/rsbuild dev --config scripts/spikes/chat/s1/rsbuild.config.ts --host 127.0.0.1 --port 8391` and `bun scripts/spikes/chat/s1/collect.ts 8392`, then `bun scripts/spikes/chat/s1/run-chromium.ts 8391 8392 tanstack` (or `swiftc -O scripts/spikes/chat/s1/wkhost.swift -o /tmp/wkhost` and `/tmp/wkhost "http://127.0.0.1:8391/?auto=1&engine=wkwebview&libs=tanstack&collect=http%3A%2F%2F127.0.0.1%3A8392%2F" http://127.0.0.1:8392/status wkwebview tanstack`), then `bun scripts/spikes/chat/s1/summary.ts`. `http://127.0.0.1:8391/` without `auto=1` is the manual page.

## Results (React dev build, React Compiler on, Apple Silicon Mac)

Engines: **Chromium 153** (Playwright, headed, 120 Hz, pixel ratio 1; ratio 2 gives the same numbers) and **WebKit 22625.1.29** (WKWebView, 60 Hz, ratio 2). TanStack is `@tanstack/react-virtual` 3.14.14 over `virtual-core` 3.18.0 (`anchorTo: 'end'` and `followOnAppend` are in it) in the **recommended** configuration; Legend List 3.6.0 with its chat props (`alignItemsAtEnd`, `maintainScrollAtEnd`, `maintainVisibleContentPosition`, `initialScrollAtEnd`, `stickyHeaderIndices`, `recycleItems` off). Drift = the largest distance the reader's row moved in any painted frame.

| Scenario · bar | TanStack · Chromium | TanStack · WebKit | Legend · Chromium | Legend · WebKit |
| --- | --- | --- | --- | --- |
| Open at the bottom (gap to the end, any frame) | 0 px; commit 3 ms, painted next frame | 0 px; commit 6 ms | 0 px; commit 12 ms, painted at 58 ms | 0 px; commit 9 ms |
| Prepend 50 rows × 10 (honest estimates) · ≤ 1 px | **0** every prepend | **0** every prepend (100 of 100 in the repeat run) | 0.63 | **3.38 FAIL** (5 of 5 runs) |
| Fold a 6-reply chain mid-screen (and unfold) · ≤ 1 px | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Fold above the viewport while at the end · ≤ 1 px | 0 | 0 | 0 | 0 |
| Edit grows a row above the viewport while scrolling up · ≤ 1 px | 0 | 0 | 0.25 | 0.25 |
| Same edit at rest · ≤ 1 px | 0 | 0 | 0 | 0 |
| Message arrives while reading history · no pull | 0 px | 0 px | 0 px | 0 px |
| Message arrives at the end / 50 px up · follows | gap 0, new row in view | gap 0, in view | gap 0, in view | gap 0, in view |
| Message arrives 120 px up · doesn't follow | anchor 0, no follow | anchor 0 | anchor 0 | anchor 0 |
| Messages arrive during a fling into the end (synthetic momentum) | follows | follows | follows | follows |
| Jump to row 5,000 (a window around it) · lands ≤ 1 px | 0 px, 11 ms | 0.03 px, 19 ms | 0.13 px | 0.91 px |
| Same jump with all 10,000 rows in the list | 0 px | 0.03 px | 0 px | 0.03 px |
| Back to the present | gap 0, next frame | gap 0 | gap 0 | gap 0 |
| Sticky day header names the day under it (fling frames) | 480–481 of 481 (one frame late at a crossing, some runs) | 241 of 241 | 480 of 481 | 241 of 242 |
| Density switch (three switches) · ≤ 1 px | **0–1 with the re-anchor** (TanStack alone: 0–4 px) | 0 with the re-anchor (alone: 0–4) | 0 | 0 |
| Scroll up through rows measured at the old density · ≤ 1 px | 0 | 0 | 0 | 0 |
| Image rows with reserved boxes (box size changes on decode) | 0 changes, 0 px | 0, 0 px | 0 | 0 |
| 2 s fling up / down · no frame > 50 ms | max 9.4 ms (121 fps), 0 jumps | max 18 ms (60 fps), 0 jumps | max 9.4 ms | max 20 ms |
| Elements in the stream (max over every check) · ≤ 3,000 | 195–200 | 195 | 1,511 | 1,508 |
| Only the stream file opts out of the compiler | `RowView`, `Body`, `Preview`, `App` compiled; `TanstackStream` not | same bundle | `LegendStream` (the wrapper) not compiled: it writes a ref in render | same |

**Why each setting is needed** (TanStack, from the configurations the runner compares):

| Without… | Chromium | WebKit |
| --- | --- | --- |
| `useFlushSync: true` (VirtualStack uses `false`) | one-frame flashes: 221 px on a prepend, up to 262 px while flinging up through unmeasured rows | fling at 26 fps, frames up to 124 ms |
| the compensation predicate (`adjust: "above"`) | an edit above the viewport while scrolling up jumps 176 px | 177 px |
| `contain: layout style` on each row | no change | fling at 19 fps, frames up to 233 ms |
| the density re-anchor | 4 px (40 px with flushSync off too) | 4 px (40 px) |
| edge context (the message before the window) | the reader's row is re-keyed and no longer drawn in 5 of 10 prepends; most others jump 28–668 px (Legend: up to 3,078 px) | same |
| CSS-sized image boxes (attributes only) | one 0.5 px box change per decoded preview | same |
| `overflow-anchor: none` | no difference measured | no difference measured |

One run did not reproduce: the very first WebKit launch of the day showed a 42 px drift and one frame without the anchor row on a prepend. Seven fresh launches since (3 warm, 3 with nothing cached, the full matrix) and the 10× repeat (100 prepends) gave 0 px. Watch for it in CV-7a's perf spec, which repeats each case.

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **TanStack Virtual for `MessageStream`**: agent · passes every bar in both engines with four settings, 7.5× less DOM than Legend, already in the bundle · rejected: Legend List 3.6.0 (fails the prepend bar in WebKit, 3.38 px, deterministic; ~1,510 elements; its own scroller), a custom list (not needed).
- **`useFlushSync: true`**: agent · TanStack then writes the scroll correction and the new row positions in the same frame; with `false` the correction paints a frame before the rows move (the flashes above) · rejected: VirtualStack's `false` (React 19 warns about `flushSync` inside effects; none appeared in these runs).
- **Compensate every size change entirely above the viewport**: agent · `virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, v) => item.start + item.size <= (v.scrollOffset ?? 0) + v.scrollAdjustments`; TanStack's default skips re-measures while scrolling backward, which is when chat edits, reactions and late images land above the reader · rejected: the default; pre-measuring rows off screen before inserting them (7–28 ms per 50 rows, and unneeded once flushSync is on).
- **`"use no memo"` in the stream file only**: confirmed in the dev bundle · the rows stay compiled and take only their row object.
- **`overflow-anchor: none` on the scroller**: agent · no measured effect in either engine, kept so a browser's own anchoring (Safari 27, Chromium) never adjusts the same scroll twice · rejected: leaving it to the browser.
- **`contain: layout style` on each row wrapper**: agent · required for WebKit's frame times · rejected: none (233 ms frames); `paint`/`size` (clips the hover toolbar; heights are dynamic).
- **Edge context**: agent · rows are built with the message just before the window (read, not drawn): it decides the top row's grouping and whether a day separator sits above it, so a prepend never changes a row already drawn · rejected: the top row always starting a group under a separator (re-keys or moves the reader's row).
- **Keys**: message id; day separator `d:YYYY-MM-DD`; a folded chain `c:<root id>` · stable across prepends, which is what TanStack's end anchoring finds again.
- **Density, font loading, width changes: a synchronous re-anchor** (`setDensityAnchored` in `tanstack-stream.tsx`): take the first message row wholly in view and its offset, switch, `measure()`, `measureElement` every drawn row, `getTotalSize()`, set `scrollTop = start − offset` and the virtualizer's `scrollOffset`, `flushSync` a render, all in one task · rejected: TanStack alone (4–40 px), `measure()` alone (rows above fall back to estimates and the view jumps).
- **Measurement cache**: TanStack's own `itemSizeCache`, keyed by row key, honest per-kind estimates (`estimateRow`) · per-conversation restore through `takeSnapshot()` → `initialMeasurementsCache` + `initialOffset` (exists in 3.18; not measured here).
- **Jumps load a window and remount**: agent · `[target − 100, target + 100]`, a new stream keyed by the window, `scrollToIndex(i, { align: 'center' })` in a layout effect on mount: lands in the first painted frame · rejected: keeping all 10,000 rows (also lands, 0–0.03 px, but holds the whole history).
- **Image boxes sized by CSS from the stored size** (`--w`/`--h` on the box, `width`/`height` from them, `object-fit: cover`) · rejected: `width`/`height` attributes alone (Tailwind's preflight sets `img { height: auto }`, so the decoded preview's own ratio takes over: 0.5 px).
- **Sticky day header through `rangeExtractor`** (VirtualStack's pattern) · up to one stale frame at a crossing in Chromium, none in WebKit · rejected for now: `directDomUpdates` (breaks this pattern: it writes a transform onto the stuck header).
- **WebKit measured in `wkhost.swift`**: agent · the Tauri window stayed off screen in this unattended session · the Tauri-window pass is in the manual checklist.

## Gotchas (area: ui)

- **TanStack with `useFlushSync: false` paints its scroll correction a frame before the rows move.** VirtualStack sets `false` (Tasks); a chat stream needs `true` or every prepend and every upward fling through unmeasured rows flashes (221–262 px in Chromium; 124 ms frames in WebKit).
- **TanStack skips compensating rows that change size above the viewport while you scroll up** (`virtual-core` `resizeItem`: re-measures only adjust when `scrollDirection !== 'backward'`, and it stays "scrolling" for 150 ms after the last scroll event). Set `shouldAdjustScrollPositionOnItemSizeChange`.
- **Without `contain: layout style` per row WebKit lays out the whole stream on every frame of a fling** (19 fps, 233 ms frames); Chromium doesn't care.
- **A prepend must not change rows already drawn.** Build rows with the message before the window; otherwise the top row's grouping and day separator change and the reader's row is re-keyed or moves (both libraries).
- **Tailwind's preflight `img { height: auto }` overrides the `height` attribute.** A reserved image box keeps its size only when CSS sets it.
- **Synthetic scrolling in tests:** a `scrollTop` write inside `requestAnimationFrame` fires its `scroll` event only next frame, so a library correcting the scroll in the same frame works from a stale offset and appears to undo the step (50–260 px fake "jumps" here). Dispatch `new Event('scroll')` right after the write, or drive real input (`page.mouse.wheel`).
- **WebKit draws no frames for a window that isn't on screen**: an unattended Tauri run stalls the page completely (timers too). `wkhost.swift` keeps a panel over every Space.
- **The React Compiler skips a component that writes a ref during render** (the Legend wrapper's `rowsRef.current = rows`): it's simply left uncompiled.

## For later blocks

- **CV-7a (the stream):** start from `scripts/spikes/chat/s1/harness/tanstack-stream.tsx`.
  - `useVirtualizer({ count, getScrollElement, estimateSize, getItemKey, rangeExtractor, overscan: 6, anchorTo: 'end', followOnAppend: true, scrollEndThreshold: 80, useFlushSync: true })`, with `estimateSize` and `getItemKey` stable per rows array (`useCallback` on `rows`): the measurement memo is keyed on them.
  - `virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _d, v) => item.start + item.size <= (v.scrollOffset ?? 0) + v.scrollAdjustments`.
  - Scroller: `overflow-y: auto; overflow-anchor: none`. Row wrapper: absolute, `translateY(start)`, `contain: layout style`, `ref={virtualizer.measureElement}`, `data-index`. The total-height box gets `height: getTotalSize()`.
  - Open: `scrollToEnd()` in a layout effect on mount. Jumps: remount on a window and `scrollToIndex(i, { align: 'center' })` in a layout effect.
  - Density (CH27), font load and column-width changes: the same synchronous re-anchor helper.
  - Sticky day header: `rangeExtractor` keeps the active separator drawn, `position: sticky; top: 0`. If the one late frame at a crossing shows, update the label imperatively in the scroll handler.
  - Don't use `directDomUpdates` with the sticky pattern.
  - The perf spec (`tests/perf/chat-10k.spec.ts`) can reuse the runner's paint probe and its input-like scroll; measure every frame, not only after settling.
- **CV-3 (the store):** hand the stream one message past each window edge (load 51, draw 50) for grouping and separators; jumps ask for `[target − 100, target + 100]`.
- **CV-9 (inline files):** size the image box in CSS from `width`/`height` (custom properties), not attributes; capped at 360 × 240 here.
- **CV-12 (Wrap up, chains):** when a chain folds across the viewport's top edge, the library's anchor row is one the fold removes, so nothing is compensated (the row below moved 393 px with TanStack). Scroll the folded chain row to the top edge after the fold (Legend kept the row below the chain in place by itself).

## Manual checklist (step → expect → surface)

Start once (Mac): `MODUO_TARGET=desktop ./node_modules/.bin/rsbuild dev --config scripts/spikes/chat/s1/rsbuild.config.ts --host 127.0.0.1 --port 8391` and `bun scripts/spikes/chat/s1/collect.ts 8392`.

- [ ] **The Tauri window run**, at the Mac with the window visible: `S1_ENGINE=tauri bun scripts/spikes/chat/s1/run-tauri.ts 8391 8392 tanstack` (≈ 6 min; it closes itself) → `bun scripts/spikes/chat/s1/summary.ts tauri` shows the same PASS lines as the `wkwebview` run (fingerprint `tauri: true`) → terminal.
- [ ] **Real trackpad momentum, desktop app:** `node ./node_modules/@tauri-apps/cli/tauri.js dev --no-watch --config '{"identifier":"com.moduo.spike-s1","build":{"devUrl":"http://127.0.0.1:8391/"}}'` → the manual page (recommended settings). Flick up hard with two fingers → older messages load as you near the top; the row under your fingers never jumps and the momentum isn't cut short → stream.
- [ ] Same page: press **Arrivals 1/s**, scroll up a screen and read → nothing moves; flick back down → it sticks to the bottom and new messages slide in, including when you overshoot (rubber-band) at the end → stream.
- [ ] Same page, scrolled into history: **Density** three times → the top row stays where it was; **Edit last**, **Fold chain** at the bottom → the bottom stays pinned → stream.
- [ ] **Safari (web):** open `http://127.0.0.1:8391/?auto=1&engine=safari&libs=tanstack&collect=http%3A%2F%2F127.0.0.1%3A8392%2F`, keep the tab in front ≈ 6 min → `results/safari.json`, `summary.ts safari` all PASS; then `http://127.0.0.1:8391/` and repeat the trackpad steps → browser.
- [ ] **Windows (WebView2):** on a Windows machine, `bun install`, the dev server (`$env:MODUO_TARGET="desktop"` then the same `rsbuild dev` line) and the collector, then `node ./node_modules/@tauri-apps/cli/tauri.js dev --no-watch --config '{"identifier":"com.moduo.spike-s1","build":{"devUrl":"http://127.0.0.1:8391/?auto=1&engine=webview2&libs=tanstack&collect=http%3A%2F%2F127.0.0.1%3A8392%2F"}}'` → `results/webview2.json` all PASS; then the manual page with a precision touchpad and a mouse wheel → stream.

## Verify before release

- The Tauri-window WebKit run and real trackpad momentum (above): TanStack's iOS deferral isn't active on desktop (`maxTouchPoints` 0), so its scroll corrections are written during macOS momentum scrolling; only a real trackpad shows whether WebKit cuts the momentum short.
- WebView2 and Safari web numbers.
- The same checks on a production build (these are dev-build numbers, the slower case).
