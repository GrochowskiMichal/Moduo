# Spec: Dashboard rebuild — "Home"

> Status: **In progress** — DB-1 (engine) + DB-2 (Home shell, old module deleted) landed 2026-07-08; DB-3 (edit mode + drag) next · Owner: maciej · Related briefs: `.design/foundation/DESIGN_BRIEF.md`, `.design/foundation/INFORMATION_ARCHITECTURE.md` (no `.design/dashboard/` brief exists — §Product behavior below is the ratified interaction spec, from the 2026-07-08 planning interview)

## Scope

Delete the current dashboard (`src/features/dashboard/`, ~4k LOC incl. Mike's personal widgets and the free-form 40px canvas) and rebuild it from scratch as **Moduo's home screen**: widgets from every module on an iPadOS-style **bounded grid** that looks composed at any resolution or aspect ratio and survives window resizing *by construction* — the layout never reflows; cells scale. This is the designer-flagged alpha-scope rework awaiting `/plan` in `BUILD_ORDER.md`. Module-contract widgets shipped by Waves 0–2/5 (recently-linked, contacts needs-attention, reconnect, calendar-today, email-inbox, recent-notes) are **ported, not dropped**.

## Product behavior & UX

**The grid.** Always **8 columns × 4 rows**, filling the content area edge-to-edge, **never scrollable**. Cells stretch with the window (fixed token gap, no breakpoints): resizing changes cell scale only, never composition. Widgets come in **fixed size presets only** — S 2×2, M 4×2, L 4×4, XL 8×2 — each widget type declares its supported sizes and has a purpose-designed layout per size.

**No page header.** Home is *pure grid* — no greeting/date chrome competing for vertical space; the grid owns the whole content area (the page-dots strip at the bottom is the only chrome). A greeting/date/clock is available *as a widget* (Clock) for anyone who wants one. Edit and Add are lightweight overlay controls (a floating top-corner affordance in normal mode, plus right-click and long-press), not a persistent header bar.

**Density.** Widget *content* (row heights, text size, padding) follows the app's global density / text-size setting like every other surface — at the densest end a Tasks-M shows more rows. The 8×4 grid geometry and the S/M/L/XL spans are **fixed** and do not change with density; only what's rendered inside a cell responds. [[feedback_density_too_large]]

**Physics.** iOS-style push & auto-compact: dragging pushes neighbors out of the way (live preview, computed against the pre-drag layout so wiggling back restores it); gaps auto-close up-then-left. Nothing can ever be pushed off the 8×4 bounds — a non-fitting drop snaps back, unchanged.

**Pages.** Multiple pages navigated by iOS-style **dots** centered at the bottom: click, horizontal trackpad swipe (over grid background only — widgets own their wheel events), and ←/→ keys; pages slide horizontally. Pages are created/deleted in edit mode; each stores an optional name (dots-only UI in v1). Active page is device-local.

**Edit mode (calm, no jiggle).** Entered via a floating **Edit** control (top-corner overlay), right-click → "Edit dashboard", or long-press a widget. Grid lines fade in, widgets subtly scale down and grow remove (✕) + size controls; drag to rearrange. A floating **Done** control (and Escape) exits. In normal mode there are zero arrange affordances beyond the single quiet Edit control.

**Adding.** "Add widget" (edit mode) opens a **gallery overlay** — widget types with previews and a size picker; tap-to-place (first free slot in reading order) or drag out onto the grid. If nothing fits on the current page, the gallery offers to place on a new page.

**Config.** A **popover anchored to the widget** (edit mode, and `⋯` on hover in normal mode) holds its few settings (project filter, timezones, pinned entity…).

**Widgets are live.** Interactive in normal mode where natural — check off a task, tick a habit, type into quick capture, start a pomodoro. The widget's header deep-links into its module (the FX-1 `moduo:entity:open` / route map machinery).

**First run.** No saved layout → a curated default page: Calendar today M, Tasks L, Quick capture S, Clock S.

**States.** Loading: token-tinted skeleton cells. Widget data error: the frame stays, body shows a quiet retryable error (per-widget error boundary — one bad widget never takes the page down). Offline / cloud write failed: layout keeps working from the local cache, syncs on the next opportunity, no nagging. Empty page: faint grid + centered "Add widgets" affordance (edit-mode entry).

### Widget catalog v1 (16 types)

| Widget | Sizes | Behavior (summary) |
| --- | --- | --- |
| Tasks | S/M/L | today/queue, project filter, inline check-off (`useTasks`) |
| Notes | S/M/L | pinned/recent notes, open-in-module (notesV2 read path) |
| Calendar today | S/M/XL | next-up emphasis + upcoming + strip line (port CAL-7 `calendar/today.ts`) |
| Time tracking | S/M | today summary / focus (`useTimetracking`) |
| Email inbox | M/L | unread/smart inbox rows (port EM-11 widget data path; platform-gated) |
| Recently linked | S/M | spine roll-up (port CT-7 `spine/recent.ts`) |
| Activity feed | S/M/L | grouped cross-module activity + notifications, deep-links per row (port CT-5 `spine/activity.ts` + `spine/notifications.ts`) |
| Needs attention | S/M | contacts nudges (port CO-5 `contacts/needs-attention.ts`) |
| Reconnect | S/M | contacts reconnect list (port `contacts/reconnect.ts`) |
| Clock | S/M | local + extra timezones |
| Weather | S/M | city-configured |
| Pomodoro | S | focus/break timer |
| Countdown | S | target date/time |
| Quick capture | S/M | text box → creates a task (or note) inline; the "connective tissue" widget |
| Habits | S/M/L | daily checkboxes + streaks (new `habits` table) |
| Pinned item | S/M | pin any registry entity (note/task/project/contact/event…) via MentionPicker search; deep-links via `moduo:entity:open` |

Mike's personal set (stocks, crypto, hydration, job tracker, todo-list) is **not ported**. Overlapping types (clock/weather/pomodoro/countdown/notes) are redesigned fresh to the size-preset system.

## Edge cases

- Non-fitting drop / resize (no push chain resolves): snap back / keep old size, gentle shake, layout unchanged.
- Grid full + add from gallery: current-page placement disabled with hint; offer next/new page.
- Deleting the last page: recreate a single empty page (a dashboard always has ≥1 page).
- Corrupt/unknown persisted layout (bad JSONB, unknown widget type, out-of-bounds coords): zod-sanitize → drop unknown types, clamp, overlap-repair + compact. Never a broken grid.
- Module permission "view": widget renders read-only (checkboxes/inputs disabled). "none": muted "No access to <module>" placeholder; type hidden in gallery; **instance stays in the layout** (permission may return).
- Email widget in a synced layout on a platform without the email capability: "Available on desktop" placeholder, never a crash; hidden in gallery there.
- Two devices editing simultaneously: last-write-wins on `updated_at`; accepted for v1 (no realtime subscription).
- Workspace switch mid-edit: pending saves flush under the old workspace key before state swaps.
- Window at min size (1024×700): S cell ≈ 226×128px — every S layout is designed for that floor.
- `prefers-reduced-motion`: FLIP glides, page slides, and edit transitions collapse to instant/opacity via the motion tokens.
- Long-press starts on an interactive child (checkbox, input): the child wins; long-press-to-edit only arms on non-interactive regions.

## Acceptance criteria

- **AC1** — The grid is always 8×4 and never scrolls; resizing the window (1024×700 → ultrawide) changes only cell scale, never widget positions or the set of visible widgets.
- **AC2** — Widgets exist only at S/M/L/XL preset spans; each type offers exactly its declared sizes, each size a purpose-designed layout.
- **AC3** — Dragging pushes neighbors with a live preview and auto-compacts gaps (up, then left); no arrangement can place or push a widget outside the bounds; a non-fitting drop snaps back leaving the layout byte-identical.
- **AC4** — Edit mode enters via the floating Edit control, right-click menu, and long-press; shows grid lines + remove/size controls; Done/Escape exits; normal mode shows zero arrange affordances beyond the single quiet Edit control (no page header).
- **AC5** — Multiple pages: dots + trackpad swipe (background only) + arrow keys switch with a slide; pages are created/deleted in edit mode; the last page can't be deleted away; active page is per-device.
- **AC6** — Layout persists per user+workspace in Supabase with the local store as offline cache: survives reload, appears on a second device, tolerates cloud-write failure silently, and a fresh user gets the curated default page.
- **AC7** — All 16 widget types render real data at each declared size, are interactive where natural (task check-off, habit tick, quick capture submit), and deep-link into their module from the header.
- **AC13** — Widget content honors the global density / text-size setting (a denser setting shows more rows / smaller type inside the same cell); the 8×4 geometry and preset spans are unaffected.
- **AC8** — Permission and platform gating per the edge cases: "view" disables writes, "none" placeholders + hides from gallery, email follows its capability.
- **AC9** — The gallery overlay adds widgets by tap-to-place (first fit) or drag-out; when the page is full it says so and offers a new page.
- **AC10** — Every configurable widget edits its settings in a popover anchored to the widget; changes apply live and persist.
- **AC11** — A corrupted/unknown stored layout degrades to a sanitized, compacted grid — never crashes, never renders overlaps.
- **AC12** — Reduced motion is honored everywhere; page dots, edit-mode controls, and config popovers are keyboard-reachable with visible focus rings.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `src/features/dashboard/engine/grid-engine.test.ts` · fit/bounds suite | AC1, AC3 | A widget can never be placed or pushed outside the 8×4; first-fit scans in reading order. |
| same · push/compact suite | AC3 | Push chains resolve like iOS (away from approach, wall → fallback), compaction closes gaps up-then-left, is idempotent, and never yields overlaps (property-style cases). |
| same · reject suite | AC3 | When nothing fits, resolveDrag returns null and the input layout is untouched (snap-back contract). |
| same · sanitize suite | AC11 | Corrupt layouts (unknown types, out-of-bounds, overlaps) come out clamped, deduped, compacted. |
| `engine/default-layout.test.ts` · seed | AC6 | The curated first-run page is valid (fits, no overlaps, only gallery-available types). |
| `data/layout-repo.test.ts` · cache/cloud merge | AC6 | Cloud-newer wins, cache-only works offline, failed upsert keeps local truth, first run seeds the default. |
| `registry/widget-registry.test.ts` · declarations | AC2, AC8 | Every type declares valid sizes/default config; permission+capability filters hide the right types from the gallery. |
| Storybook stories: `widget-frame`, `page-dots`, `gallery-dialog`, per-widget size variants (density knob) | AC2, AC4, AC7, AC13 | Each widget's S/M/L/XL layouts and the edit-mode frame render correctly in isolation; a story density toggle shows content responding while spans hold (visual layer). |
| `tests/visual` / e2e smoke `e2e/dashboard/home.spec.ts` (env-gated) | AC1, AC5, AC6 | Loads `/`, sees the default page, switches pages by dots/keys, reloads and finds the layout intact. |
| Manual (docs/testing/<branch>.md) | AC3, AC4, AC9, AC10, AC12 | Pointer drags, long-press, trackpad swipe, popovers, reduced-motion — the gesture layer that Playwright can't faithfully simulate in a worktree (recorded FX-9/TL-2 gotcha). |

## Assumptions & technical decisions

1. **Hand-rolled pointer drag, not dnd-kit** — collision is pure math on a fixed matrix (pointer→cell = two divisions from the container rect); dnd-kit's DOM-rect measuring fights framer-motion FLIP and the translated pager, and we need a custom gesture machine (long-press, drag-from-gallery) anyway. dnd-kit stays for other features. *Rejected: dnd-kit, react-grid-layout (scroll/reflow-oriented).*
2. **Pure grid engine** (`engine/grid-engine.ts`, zero React/DOM imports) owns findFirstFit / push (BFS with wall fallback, reject on no-fit — never wrap) / compact (up-then-left fixpoint) / sanitize. Vitest-first; this is the risk core.
3. **CSS Grid rendering** — `grid-cols-8 grid-rows-4` with fr tracks + fixed token gap; widgets placed by inline `gridColumn/gridRow` (runtime geometry, allowed). framer-motion `layout` FLIP for glides; drag preview recomputed against the pre-drag layout; ResizeObserver metrics kept in a ref (no per-frame renders). During page slides, `layout` animations are disabled (FLIP inside a translating container mis-measures).
4. **Persistence: `dashboard_layouts`** (user_id, workspace_id, `pages` JSONB `{version:1, pages:[{id, name?, widgets:[{id,type,size,x,y,config}]}]}`, updated_at; PK (user_id, workspace_id); RLS `auth.uid() = user_id`). **Preference-class data**: direct RLS upserts via a new `runtime.dashboard` namespace (both runtimes already hold a supabase client) — **no intent ops, no activity rows, no registry entries** (precedent: `user_preferences`/appearance). Load cache-first (`runtime.localStore`, ns `dashboard`), cloud-newer replaces; save = immediate local + 1s-debounced cloud upsert, flushed on hide/unload/workspace-switch; LWW. *Rejected: local-only (contradicts cloud-first), per-widget rows (layout is one atomic composition).*
5. **Habits: own `habits` table** (id, user_id, workspace_id, name, emoji, position, `checks` jsonb array of local-date strings, timestamps; same user-scoped RLS, same preference-class rationale) — habits outlive widget instances and multiple habit widgets share data; streaks computed client-side. *Rejected: config-embedded (not shareable), per-check rows (overkill).*
6. **Registry pattern** — one `WidgetDefinition` per type {sizes, defaultSize, defaultConfig, zod configSchema, requiredModule?, isAvailable?(caps), deepLink?, Component (one size-aware component), ConfigForm?, GalleryPreview?}. `dashboard-page.tsx` mounts module hooks once and shares via context (five Tasks widgets = one subscription); `moduo:data-refresh` keeps widgets live for free.
7. **Ports, not rewrites** — the contract widgets reuse their shipped pure shapers/runtime reads: `spine/recent.ts` (CT-7), `spine/activity.ts` + `spine/notifications.ts` (CT-5, the Activity feed widget — grouped/human-readable, already deep-linking), `contacts/needs-attention.ts` + `reconnect.ts` (CO-5/v2), `calendar/today.ts` + gap-finder Move-to-today (CAL-7), the EM-11 email-widget data path, the notesV2 read path (post-NO-2 `use-notes` is gone). Only their frames/layouts are new (size-preset system).
8. **Deep links** ride FX-1's `moduo:entity:open` host listener + `src/lib/entity-open.ts` route map; the Pinned widget picks its entity with the CT-4 `MentionPicker`/`useMentionSearch` (trigger 'ref').
9. **Email gating** on `runtime.capabilities.hasEmail` at both gallery and render (synced layouts cross platforms).
10. **Route/chrome**: nav label **Home** (lucide `House` added to the icon registry — none exists), route stays `/`, internal name stays `dashboard`; the page does **not** use `FeaturePanelsShell` (full-bleed); panel toggles hidden on this route; `app-chrome-grid-menu.tsx` + the `grid` menu slice die with the old module (only `app-chrome-menu-types.ts` + `grid-page.tsx` reference it externally — verified post-merge). Add the **⌘1** module shortcut for Home (matching the ⌘2–7 pattern) and **palette entries** "Go to Home", "Edit dashboard", "Add widget" (the last two ride an in-app action, no route).
11. **Wheel contract**: widgets swallow all wheel events over themselves; deltaX-dominant accumulation + ~350ms lockout pages only over grid background; dots/arrows always work.
12. **`activePageId` is device-local** (localStorage), never synced — avoids cross-device page-flip fights.
13. **Migrations applied to prod in-session** after a rolled-back authed round-trip (standing preference), with a graceful-degrade guard in `layout-repo` for the merge-before-apply window (42P01/42883 → local-only mode).
14. **Density-aware content, fixed geometry** — widget internals read the global density/text-size setting (same mechanism the rest of the app uses); the grid's 8×4 and the S/M/L/XL spans never change. *Rejected: one fixed comfortable density (ignores a ratified customization axis).* [[feedback_density_too_large]]
15. **Header-less pure grid** — no greeting/date chrome; Edit/Add are floating overlay controls; a greeting/date/clock is a widget (Clock) if wanted. Keeps the grid the whole page and dodges the "header vs never-scroll vertical budget" conflict. *Rejected: persistent greeting header (eats grid height, competes with the geometry the whole rebuild is about).*
16. **Old local layouts are abandoned, not migrated** — the pre-rebuild redb dashboard layout (old free-form format, incompatible) is simply ignored; existing users get the curated default on first load. Pre-alpha, no user data of value lost. *Rejected: a format-translating migration (throwaway code for a shape nobody keeps).*
17. **The one great moment** = *resize from laptop to ultrawide (or reshape the window to any aspect) and the composition stays perfectly placed* — the failure that motivated the rebuild, now the signature demo. The build/verify pass leads with it (AC1).

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| DB-1 | Grid engine (pure) | engine/types + grid-engine + sanitize + default-layout, full vitest suite green | AC1–AC3, AC11 (math) | — |
| DB-2 | Shell swap + static render | grid-canvas + widget-frame (placeholders), home-page route (full-bleed, header-less), chrome rewiring (Home/House nav, ⌘1 + palette entries, menu-slice removal), **old module deleted** | AC1, AC2 (visual) | DB-1 |
| DB-3 | Edit mode + drag | use-edit-mode, use-grid-drag (pointer machine, long-press, live-push preview, snap-back), floating Edit/Done + remove/size controls, FLIP animations | AC3, AC4 | DB-2 |
| DB-4 | Persistence + pages | `dashboard_layouts` migration (applied), runtime.dashboard, layout-repo + use-dashboard-layout (cache/debounce/seed, abandon old redb layout), pager + dots + navigation, page CRUD in edit mode | AC5, AC6, AC11 | DB-3 |
| DB-5 | Registry + module widgets | widget-registry + data context (density-aware) + permission-gate + error boundary; Tasks, Notes, Calendar today, Email inbox, Time tracking, Recently linked, Activity feed, Needs attention, Reconnect | AC7, AC8, AC13 (partial) | DB-2 |
| DB-6 | Utility + new widgets | Clock, Weather, Pomodoro, Countdown, Quick capture, Pinned item | AC7 (rest) | DB-5 |
| DB-7 | Habits | `habits` migration (applied), habits-repo, Habits widget | AC7 (habits) | DB-5 |
| DB-8 | Gallery + config + polish (DoD) | gallery-dialog, config-popover + ConfigForms, curated-default verification, reduced-motion + keyboard pass, stories, e2e smoke, live verification, testing doc | AC9, AC10, AC12 + full-pass | DB-3, DB-4, DB-5, DB-6, DB-7 |

Parallelism: DB-5 is file-disjoint from DB-3/DB-4 and may run in a parallel lane after DB-2 lands; DB-6 ∥ DB-7 after DB-5. Contention files to watch: `runtime.types/web/tauri` (DB-4 vs DB-7 — sequence those edits), `supabase/migrations/` timestamps.

## Out of scope

- Mobile/tablet layouts (desktop only, min 1024×700).
- Realtime layout sync between simultaneously-open devices (LWW only).
- Keyboard-driven widget *dragging* (remove/resize/add are keyboard-accessible; pointer-only drag is accepted for v1).
- Named-page UI (name is stored, dots-only in v1).
- New MCP manifest — the dashboard is a surface, not a data module; module widgets ride their modules' manifests. (Habits MCP exposure: post-alpha, if wanted.)
- Stocks/crypto/hydration/job-tracker/todo-list widgets (not ported; new lifestyle widgets beyond Habits/Quick capture/Pinned wait for user demand).

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** filled and unambiguous (ratified in the 2026-07-08 interview: 6 question rounds, 23 decisions — incl. the gap-review round: header-less grid, per-workspace scope, density-aware content, Activity-feed widget).
- [x] **Every AC has at least one test** with a plain-English note.
- [x] **Open questions is empty.**
- [x] **Data model named and Supabase-first**: `dashboard_layouts` + `habits`, both new migrations identified; preference-class exception (no intent ops) recorded as decision 4/5.
- [x] **Module contract**: spine wiring = deep-links via `moduo:entity:open` (FX-1), pinned-entity search via CT-4 MentionPicker, quick-capture writes Tasks ops; MCP = none (recorded, out of scope); dashboard widgets = this feature *is* the widget host, porting all contract widgets.
- [x] **Execution blocks** decomposed (DB-1…DB-8), sequenced, context-sized, recoverable from this spec + decisions.md.
- [x] **Design constraints acknowledged**: tokens-only, shadcn Dialog/Popover primitives, motion tokens + reduced-motion, Storybook stories for new frame primitives.
- [x] **Manual-test surfaces identified**: drag physics, long-press, trackpad swipe, popovers, reduced-motion (→ `docs/testing/<branch>.md` at wrap).

**Ready to execute.**

## Open questions

- [ ] (none)
