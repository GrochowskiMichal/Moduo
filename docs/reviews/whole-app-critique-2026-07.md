# Moduo — Whole-App UX / Visual / Cohesion Critique

> **Status:** Critique pass, 2026-07-09 — **re-based same evening onto PR #73 (DB-5…DB-8, `ec68e30`)** after the dashboard registry/widgets/gallery landed from a parallel session mid-critique. Dashboard findings below reflect the REAL widgets, live-verified post-merge. A prioritized **punch-list for the designer to review before dogfooding** — not a set of applied fixes. Nothing here has been changed in code. The companion fix plan: [whole-app-critique-2026-07-plan.md](./whole-app-critique-2026-07-plan.md).
> **Method:** Read the intended bar (PRODUCT_BRIEF, ROADMAP, DESIGN_SYSTEM, DESIGN_RULES, module contract) → live-verified every module on the hosted test account in a real browser (session-injected, 1440×900 desktop) → fanned out 10 read-only subagents (one per module + spine-cohesion + app-shell + design-system) → verified the load-bearing Critical/High claims first-hand against source. Every finding cites `file:line`.
> **The ask (verbatim):** "criticize the UX and the visuals on everything" and find the seams before the designer dogfoods.

---

## 0. How to read this

- **Legend:** severity **Critical** (breaks the stated bar/moat, or loses data) · **High** (a daily user hits it constantly) · **Medium** (friction/inconsistency) · **Low** (polish). Effort **S/M/L** (rough).
- **Structure:** §1 the top-line verdict → §2 the curated **must-fix-before-dogfood** shortlist → §3 **cross-cutting** findings (the spine + shell — the most important section) → §4 **per-module** sections → §5 **visual / design-system** → §6 what's genuinely good → §7 live-verification notes & caveats.
- **Read §2 + §3 first.** The per-module sections (§4) are the detail; the cross-cutting section (§3) is where the product's real problem lives.

---

## 1. Top-line verdict

**The modules are good; the connective tissue that is supposed to be the moat is not yet felt — and the two newest surfaces (Home/Dashboard, Mindmap) are the weakest links in the chain.**

Taken one at a time, **Tasks, Calendar, Contacts, and Notes are genuinely strong** — dense, keyboard-first, token-clean, close to their category bar. Token hygiene across those four + the Email live-path + the Dashboard shell is excellent (near-zero raw hex, motion via tokens). If you judged Moduo module-by-module (which is how it was built and verified), you'd call it close to done.

But the product's entire thesis (PRODUCT_BRIEF §4) is **"the only place these connect."** Judged as *one connected product*, three things break the promise:

1. **The moat's felt payoff — click a linked thing → go to it — dead-ends for 4 of 7 entity types** (task/event/email/mindmap). The graph exists in the database and renders in hubs, but the click-through drops you on a module page with nothing selected. A dead link poisons trust in the whole graph, which is the exact failure the brief warns about.
2. **The Dashboard landed mid-critique (PR #73, DB-5…DB-8) and is now real** — 14 web widgets render live data, the gallery/config/quick-capture work, and quick-capture writes through the true module path. Re-verified live post-merge. What remains: the default page reads as 4 sparse cards with large dead space, the first-ever "Add widget" always hits "This page is full" (the default layout fills the entire 8×4 grid), and — critically — **widget rows deep-link into the same dead-end as everything else** (point 1): clicking a task in the Tasks widget lands on /tasks with a *different task* selected. Live-confirmed.
3. **The spine's ambient layers are hollow:** notifications fire for essentially one event type, global cross-module search doesn't exist (the palette says it does), `@`-mention/inline-ref works in exactly one editor, and drag-to-link works within a module but never across panes.

Even *visually*, the modules don't yet cohere: the design system itself is disciplined and mostly hex-free, but adoption is uneven — the **current-selection highlight is rendered four different ways across five modules** (in Notes and Email, "selected" is indistinguishable from "hover"), and two live routes (Mindmap, legacy-Email) render in a private off-token palette. It reads as *a very good design system with ~4 modules following it and ~3 that predate it*, not one product built by one team.

Add a **broken paid-conversion path** (the trial CTA points at a Settings→Billing screen that doesn't exist) and a **Mindmap module that is non-functional at first run and the worst design-system offender in the app**, and the picture is: *a strong set of modules that has not yet been assembled into the connected, pre-populated product the brief describes.* The seams cluster exactly where a new dogfooder lands (Home, first-run) and where the moat must be felt (cross-module click-through). Those are the right things to fix first.

---

## 2. Must-fix before dogfood (the shortlist)

Ranked by dogfood impact. Each expands in §3/§4.

| # | Finding | Sev | Effort | Where |
|---|---|---|---|---|
| 1 | **Cross-module click-through dead-ends** — `moduo:entity:open` drops the id for task/event/email; opening a linked task/event/email lands on the module page, nothing selected. Now **live-confirmed from the shipped dashboard**: clicking a task row in the Tasks widget lands on /tasks showing a different task. The moat's payoff. | Critical | M | §3 CC-1 |
| 2 | **Paid-conversion path is doubly broken** — (a) trial "add a card" CTA → `section:"billing"` which isn't a valid section → dumps user on Appearance; **no billing UI exists anywhere**; onboarding points at the same dead screen. (b) The trial banner's entitlements fetch is a raw `fetch` with an empty-string apikey fallback (`trial-banner.tsx:42-49`) → **silent 401, banner never renders** when `PUBLIC_SUPABASE_ANON_KEY` is unset. | Critical | M | §3 CC-7 |
| 3 | **Boot fetch storm (real, not StrictMode)** — one cold load fires `auth/v1/user` ×8, profiles ×4, workspaces ×3, dashboard_layouts ×4 (+a write during load), notifications ×3; `main.tsx` has **no StrictMode**, so every duplicate is production behavior. No request-dedupe layer exists. Perf is a P0 bar. | High | M | §3 CC-13 |
| 4 | **Mindmap is broken + off-brand at the front door** — first-run empty state instructs a map-selector that has no emitter (unreachable create flow); 238 raw hex; perpetual glowing/pulsing edges (anti-slop, ignores reduced-motion); redb-only (won't sync). **Recommend: hide from alpha nav.** | Critical | S (hide) | §4 Mindmap |
| 5 | **Global cross-module search doesn't exist** — palette placeholder promises "Search workspaces, pages, or actions…"; live-confirmed returns "No results" for a real task. `searchEntities` exists but only powers `@`-pickers. | High | M | §3 CC-3 |
| 6 | **Notifications fire for ~1 event type** — only note/comment `@`-mentions target a user; tasks/calendar/email/contacts write activity but notify nobody. The bell is near-silent; "quiet notifications" = "almost none." | High | M | §3 CC-4 |
| 7 | **Email daily-use blockers** — deep-link to a thread dead-ends on the firehose inbox; remote images load by default (tracking pixels); reader is a fixed 60vh iframe; convert-to-task is non-atomic (can strand an orphan task); no sync-state/refresh; errored accounts invisible on "All inboxes." | High | M–L | §4 Email |
| 8 | **Contacts "great moment" is thin** — linked-work rollup has **no inline snippets** (the flat backlink pile the brief forbids); last-touch doesn't reflect linked-entity edits (breaks "always current"); soft-delete has **no undo**. | High | M | §4 Contacts |
| 9 | **Notes editor gaps** — no inline markdown shortcuts / no `⌘B`·`⌘I` / no format toolbar (fails a baseline Notion expectation); checkbox shape jumps square→circle on the flagship "checkbox is a task" moment. | High | M | §4 Notes |
| 10 | **First-run is bare** — onboarding collects a name → drops you on the empty dashboard; the workspace switcher hides at ≤1 workspace (new user's top-left is empty); no shortcuts-help surface anywhere; gate renders a blank screen on slow load. | High | M | §3 CC-10, §4 Shell |
| 11 | **Dead controls in primary chrome** — "Feature settings" bottom-bar button is a no-op on every page; `⌘N`/"+" fire an event only Notes & Tasks listen for (dead on 5/7 modules); Settings left-panel toggle is a no-op. | Medium | S | §3 CC-9 |

---

## 3. Cross-cutting findings (the spine, the shell, the system)

*This is the section that matters most — these are the problems that make a set of good modules fail to add up to the connected product.*

### CC-1 — [Critical · M] Deep-linking drops the id for task/event/email → the moat's click-through dead-ends
`src/lib/entity-open.ts:32-38` (verified first-hand): `task`/`project` → `{to:"/tasks"}`, `event` → `{to:"/calendar"}`, `email`/`email_thread` → `{to:"/email"}` — **all with no `search`/id**. Only `contact`/`company`/`note` carry URL selection. The host listener (`app-chrome.tsx:218-244`) works correctly and the `moduo:entity:open` "dispatched-but-inert" gotcha is *resolved* — so the plumbing's receiving end is done. The gap is **granularity**: click a linked task from a contact hub, a note's `/task` chip, an email→task link, or (eventually) any dashboard tile, and you land on the module page at whatever state it last held, the entity **unselected** — on Email, that's a 500-row firehose. The brief calls "data no one trusts" the category-killer; a link that resolves to a location, not the entity, is exactly that. **Root fix:** hold selection in the URL for Tasks/Calendar/Email (as Notes/Contacts already do) and have each page honor an inbound target id. Every per-module agent independently hit this.

### CC-2 — [RESOLVED mid-critique, residual High · M] The Dashboard is now real (PR #73, DB-5…DB-8) — with a first-run layout problem and a broken click-through
> *The original finding ("empty chassis, no registry, no gallery, dead `addWidget`") was TRUE against this session's base and is now OBSOLETE — DB-5…DB-8 merged from a parallel session mid-critique. Everything below is re-verified live against the merged code.*

**What now works (live-verified):** 14 widgets on web (Email + Time-tracking correctly desktop-gated out of the gallery), real data in all default widgets (Tasks queue, Today with drift-strip + "Move to today", working Quick-capture input, live Clock); the Add-widget gallery (descriptions + per-size chips + tap-to-place); page-full → "Add to a new page" with a toast; per-widget ⋯ config popovers (Clock timezones, Pomodoro, Tasks filter); quick-capture writes through the real module path (`runtime.tasks.seedInbox` + `upsertTask`, `quick-capture-widget.tsx:35-49`) and the Tasks widget live-updates; **Recently-linked renders real spine links on Home** — the moat's first ambient surface.

**Residual findings (live):**
- **[High·S] Widget rows deep-link into the CC-1 dead-end.** Rows dispatch `openEntity(type,id)` (`widget-nav.ts:8-12`) → clicking "Critique probe task…" in the Tasks widget landed on /tasks with **"Water plants" still selected**. The dashboard makes CC-1 a first-screen daily wound.
- **[Medium·M] The default layout fills the entire 8×4 grid** — so a user's **first-ever "Add widget" always hits "This page is full → Add to a new page."** The primary gallery path ("drops into the first free slot") is unreachable on page 1 without first removing/shrinking something. Leave a free slot in the default, or offer "make room."
- **[Medium·M] The default page reads as 4 sparse cards** — 5 task rows atop a full-height card (~70% dead space below), Quick-capture's input floats ~2/3 down its card with dead space above, Clock's numerals sit low. Content doesn't fill or anchor to its frame; the first screen reads emptier than it is.
- **[Medium·S] "Queue" means opposite things** — the Tasks widget's fallback heading "Queue" = *open, uncommitted* tasks (`tasks-widget.tsx:45-48`), while the Tasks module's "Queue"/"Commit to Queue" = the *committed* list. Live: a capture toasts "Added to Inbox" then appears under "QUEUE." Same word, two meanings, one product.
- **[Low·S] ⋯ config appears only on configurable widgets** (Tasks, Clock…) — fine, but Today/Quick-capture show nothing in its place, so the edit-mode control cluster is inconsistent per card. **[Low·S] Toasts stack over the bottom-right edit controls** (Done/pencil), blocking clicks mid-edit.

### CC-3 — [High · M] Global cross-module search does not exist (the palette lies)
`global-command-palette.tsx` placeholder reads *"Search workspaces, pages, or actions…"* but the palette is a fixed list of nav + two create actions; `CommandInput` has no `onValueChange`. **Live-confirmed:** typing "Water plants" (a real task) → **"No results."** `runtime.spine.searchEntities` exists (`runtime.web.ts:1714`) and is used *only* by `@`-mention pickers. There is no `/search` route. For a product whose value is unifying fragmented info, "find anything across tasks/notes/contacts/emails/events from one box" is table stakes and is absent; the copy actively over-promises.

### CC-4 — [High · M] Notifications fire for essentially one event type
A notification is a `module_activity` row carrying `mentioned_user_ids` (predicate `spine_activity_targets_me`), populated **only** by `comments_op_add` and `notes_op_mention`. Tasks/Contacts/Calendar/Email ops all write activity but **never target a user** — so the bell is blind to task drift, calendar invites, follow-ups owed, email arrivals, link-mentions. PRODUCT_BRIEF §7 makes cross-module, entity-grouped notifications "central to the moat." Today "quiet, grouped-by-entity, digest" is, in practice, "almost nothing ever lights the bell." (Also: `notificationDeepLink` doesn't route `email_thread`.) *Credit: the rendering side is already right — `notification-center.tsx:62` groups via `groupNotifications` with per-group unread counts + deep-links. The gap is **generation**, not the UI.*

### CC-5 — [High · L] `@`-mention / inline-ref works in exactly one surface, and `@` is people-only
The only text surface wired for link-from-text is the **Notes editor** (`note-editor.tsx:460` slash, `:466` mention) — and it's `peopleOnly` (`:481`), so `@` mentions **people only**; entity insertion is `/`-only. Net: the contract's "`@`-mention an *entity* in prose" gesture is realized in **zero** surfaces. Everywhere else is a plain control that structurally cannot link: task title/description `<Input>`/`<Textarea>`, calendar event notes, contact fields, mindmap node inputs, task capture, and **Email compose is Lexical but has no mention/ref plugin**. The "type to link" muscle memory works in one editor and silently fails in the other six.

### CC-6 — [High · M] Drag-to-link is within-module only — no cross-pane drag
Each module hosts its **own** `DndContext` (tasks ×3 views, calendar ×2, contacts ×2, notes ×1); there's no app-level context spanning panes, and dnd-kit drags don't cross context boundaries. So "drag anything onto anything" works only *inside* the contacts and notes pages. The headline cross-module gesture — drag a task onto a person — is impossible. Calendar's drop is worse than absent: it *looks* like a link gesture but only reschedules the task (`calendar-grid.tsx:806`), never calls `createLink`. Email is neither drag source nor target.

### CC-7 — [Critical · M] The paid-conversion path is broken end-to-end (twice)
Verified first-hand: valid Settings sections are appearance/account/workspace/integrations/preferences/focus/advanced/about — **there is no "billing"**, and zero billing/subscription/stripe refs exist in `src/features/settings/`. Yet `trial-banner.tsx:70` navigates to `{section:"billing"}`, which fails `isSettingsSectionId` → falls back to the **default Appearance section** (`settings-modal.tsx:70`). So a trialing user clicks *"Add a card to extend to 30 days →"* and lands on **theme pickers**. `onboarding-page.tsx:105` reinforces the dead reference ("Add a card in Settings → Billing").

**And the banner often can't even render:** its entitlements read is a raw `fetch` (`trial-banner.tsx:44-51`) whose apikey falls back to an **empty string** when `PUBLIC_SUPABASE_ANON_KEY` is unset (`:42`) — unlike the shared client, which falls back to the real publishable key (`runtime.web.ts:57-58`). Empty apikey → **401** on every call (observed ×3 per load, live), swallowed by `.catch(() => {})` → no banner, no trial-days signal, silently. Fix shape: query through `supabaseClient` (also gains token refresh) + add the billing section.

Compounding: the gate **fails open** on an entitlements fetch error (`app-gate.tsx:92`, treats "unknown" as pass) and papers over Stripe-sync lag with two layers of client polling (`paywall-page.tsx:82`, `app-gate.tsx:57`). For a gated web alpha, the one flow that must not break has the most seams.

### CC-8 — [High · M] One concept, many implementations → it doesn't read as one product
The spine's shared primitives (`entity-links.ts`, `drag-payload.ts`, `rollup.ts`, `mention.ts`) are clean and genuinely reused — but the *surfaces* diverge:
- **Activity trail** has **three** implementations: Tasks' bespoke `ActivitySection` (`task-detail-panel.tsx:580`), a shared `ActivityTrail` that oddly lives *inside the contacts feature* and is imported cross-feature by Notes, and Calendar's own inline section (`event-detail-panel.tsx:261`).
- **Entity hub** diverges: Calendar/Notes/Email render the shared `<EntityHub>`; **Contacts forks a parallel `LinkedSections`**; **Tasks renders no hub at all**.
- **Tags** split three ways: Tasks (custom `toggleTaskTag` API), Contacts/Notes/Email (shared `useEntityTags`), Mindmap (its own local string array).
- **Selection styling** diverges *within Tasks alone* four ways (bar / border / `ring-2` / `ring-1` across List/Board/Timeline/tray).
A user moving between modules relearns "what selected/linked/logged looks like" each time.

### CC-9 — [Medium · S] Dead controls in primary chrome fire into the void
Event-bus indirection (`moduo:create:new`, feature-settings, `⌘N`) with no type-checked dispatch↔listen contract leaves several always-present controls inert:
- **"Feature settings"** bottom-bar button (`global-bottom-bar.tsx:51`) — `onClick` is a placeholder no-op on *every* route.
- **`⌘N` / bottom-bar "+"** → `dispatchCreateNew()`, but **only Notes & Tasks listen** — dead on Calendar/Mindmap/Contacts/Email (5 of 7). Meanwhile `⌘⇧N` always makes a note, so `⌘N` is unpredictable per page.
- **Settings left-panel toggle** renders and is clickable on `/settings` but `toggleLeftPanel` early-returns there (`app-chrome.tsx:505`).
- **`IntegrationsModal`** is mounted in AppChrome but `setIntegrationsOpen(true)` is never called (dead wiring).

### CC-10 — [High · M] First-run is bare, and the workspace identity is invisible for the common case
Onboarding (`onboarding-page.tsx`) is a 2-step trial+name gate, not the "progressive single-module onboarding" the brief describes — after naming a workspace the user is dropped straight onto the **empty dashboard** with no module guidance, no seeded content, no tour. Compounding: **`WorkspaceSwitcher` returns `null` at ≤1 workspace** (`workspace-switcher.tsx:126`), so a brand-new single-workspace user has **no workspace name/avatar/switcher in the top bar at all** — and `⌘⇧W` is a no-op for them. There is **no shortcuts-help surface** anywhere (13 global shortcuts exist only as scattered tooltip hints; the only keyboard legend in the app is inside the Mindmap toolbar). The seams cluster exactly where a first-time dogfooder lands.

### CC-11 — [Medium · L] Universal Inbox and a *global* quick-capture bar are unbuilt
No `/inbox` route and no cross-module aggregation surface exist; the only inbox-shaped thing is Email's own inbox. Global quick-capture is module-scoped (`⌘N` → whichever module's form), not a unified "type a line, it routes to the right entity" command bar. *(The dashboard quick-capture widget is now real (PR #73) and writes through the true task path — a good first anchor, but it's Home-only and tasks-only.)*

### CC-12 — [High · L] Tasks is a spine *target*, not a spine *participant*
Despite being rated "5/5, built" and called the reference implementation, the Tasks detail panel shows only task↔task relations (blocked-by/blocks) — **no cross-entity link hub**, no drag-to-link, no `@`-mention/`/ref`, no notifications *(the Tasks dashboard widget does ship now — PR #73)*. `grep entity-links src/features/tasks` is empty except the task→task `blocks-bridge`. The asymmetry is concrete: a *contact* shows its linked tasks (`contacts/ui/linked-sections.tsx:20`), but the *task* shows nothing about the contact/note/email it came from. The most-linked-to entity in the product can't show what it's connected to.

### CC-13 — [High · M] Boot fetch storm — real production behavior, no dedupe layer
One cold authed load of `/` (observed live): `GET /auth/v1/user` **×8+**, `profiles` **×4**, `workspaces?select=*,workspace_members(*)` **×3**, `workspace_notifications` **×3** + `rpc/notifications_list` ×2, `dashboard_layouts` **×4** plus a **write** (`POST … on_conflict=…` 201) during a pure read path, `user_preferences` ×2. `src/main.tsx` has **no React StrictMode**, so none of this is dev double-mounting — every duplicate is real. There is no request-dedupe/cache layer (no react-query/swr); providers and gates each re-fetch independently (the WorkspaceGate remount cascade is the prime suspect). Perf is a P0 launch bar ("instant, native, never lags") and this is the opposite posture; it also multiplies Supabase costs. *(Fix shape: a boot-time shared fetch layer or query cache; make the dashboard-layout load stop re-pushing during read.)*

### CC-14 — [High · M] A running focus session dies on navigation, invisibly
The Execute/Focus timer state lives entirely in component-local `useState`/`useRef` inside `execute-view.tsx` — there is no app-level focus-session context and **no chrome indicator** (nothing in the top bar). Navigate to Calendar mid-session (exactly what the schedule-to-completion loop encourages) and the session is silently gone; time-spent may not flush. For the module whose "one great moment" is Focus, session state must survive navigation and show ambient chrome presence (a quiet timer chip).

### Spine coverage matrix (from the cohesion audit)
✅ full · ◐ partial · ✗ absent

| Spine system | Tasks | Contacts | Calendar | Notes | Email | Dashboard | Mindmap |
|---|---|---|---|---|---|---|---|
| Entity links (create from UI) | ◐ drag-source only | ✅ | ◐ drop=reschedule | ✅ | ◐ convert only | ✗ | ✗ |
| Entity hub / roll-up | ✗ | ◐ forks LinkedSections | ✅ | ✅ | ✅ | ✗ | ✗ |
| Drag-to-link | ◐ source only | ✅ | ◐ source only | ✅ | ✗ | ✗ | ✗ |
| `@`-mention | ✗ | ✗ | ✗ | ◐ people-only | ✗ | ✗ | ✗ |
| `/ref` inline | ✗ | ✗ | ✗ | ✅ | ✗ | ✗ | ✗ |
| Auto-suggested links | ✗ | ✅ | ✗ | ✅ | ✗ | ✗ | ✗ |
| Notifications (bell) | ✗ | ✗ | ✗ | ◐ mention only | ✗ | ✗ | ✗ |
| Activity trail | ✅ | ✅ | ✅ | ✅ | ◐ writes, never renders | ✗ | ✗ |
| Tags | ◐ custom path | ✅ | ✗ | ✅ | ◐ tissue-only | ✗ | ✗ local |
| Deep-link (open entity) | ◐ page, no select | ✅ | ◐ page, no select | ✅ | ◐ page, no select | ✗ | ✗ toast |
| Global search | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ (exists nowhere) |
| Dashboard widget *(post-PR #73)* | ✅ | ✅ needs-attention + reconnect | ✅ Today | ✅ | ✅ (desktop-gated on web) | — | ✗ |

**The through-line:** Notes and Contacts are the reference-quality adopters; Tasks, Calendar, and Email are spine *targets* more than *participants*; Mindmap is off the spine entirely. *(The Dashboard column improved materially with PR #73: every module now ships a widget, widget rows dispatch the deep-link event, and Recently-linked puts the spine on Home — but the deep-links inherit CC-1's dead-end for task/event/email.)*

---

## 4. Per-module findings

### 4.1 Home / Dashboard — *verdict (re-based on PR #73): real and largely working; fix the click-through, the first-run layout, and the naming*
The shell (grid engine, drag physics, pager, persistence) was already excellent; DB-5…DB-8 filled it with 14 working web widgets, a good gallery, config popovers, and a true-path quick capture. Full re-verified detail in **CC-2**; the standing items:
- **[High·S]** Widget-row deep-links land unselected for task/event/email (CC-1, live-confirmed from the Tasks widget).
- **[Medium·M]** Default layout fills the whole grid → first-ever add always detours through "page is full"; default page reads as 4 sparse cards (dead vertical space; input/numerals float low in their frames).
- **[Medium·S]** Widget "Queue" vs module "Queue" naming collision (`tasks-widget.tsx:45-48`).
- **[High·S]** Edit-mode discoverability rests on a single unlabelled Pencil in the bottom-right — the *same slot* that's a panel toggle on every other route (`app-chrome.tsx`). Long-press-to-edit (450ms, `use-grid-drag.ts`) has no arming feedback and races Radix's context menu on touch (self-noted latent).
- **[Medium·S]** R3 concentric-radius unconsidered at the grid's window corners; **[Low·S]** active page-dot uses `bg-foreground` where R5 reserves selection styling (defensible for iOS-style dots, but log the call — `page-dots.tsx:48`); **[Low·S]** toasts stack over the bottom-right edit controls.
- Habits introduces a brand-new data model (`dashboard_habits` migration, applied to prod) that lives only in the widget — not in the entities registry/spine/MCP surface. Fine as a utility; log the decision so it doesn't read as an accidental island later.

### 4.2 Tasks — *verdict: reference-quality within the module; a non-participant in the spine*
Live: excellent — Plan/Focus tabs, Inbox list, a dense detail panel (Status/Bucket/Scheduled/Priority/Energy/tags/Blocked-by/Commit-to-Queue/activity), and a gentle "Drifted — its scheduled time has passed" note (graceful slippage, done right). Token hygiene is spotless.
- **[High·L]** The flagship **schedule-to-completion loop isn't actually in the module** — Focus/Execute is a self-contained Pomodoro over the commit queue; it references no calendar time-block, no "block elapsed → done/push/shrink." The loop's completion half lives only as buckets-mapped-to-time-of-day. (The *calendar* side has the block-elapsed triage; the two aren't joined into the one loop the brief sells.)
- **[High·M]** Focus **dead-ends when the queue empties** — `EndSummary` offers only "Back to Plan"; no capture/"add one more" from inside Execute.
- **[High·M]** A running Focus session is **component-local and dies silently on navigation** with no chrome indicator (CC-14) — navigating to Calendar mid-session (which the loop encourages) loses the session.
- **[Medium·S]** Two different "Skip" verbs (skip-occurrence = no penalty vs reschedule-from-today = penalty) surface under the same word. Blocked state is hover-tooltip-only and its muted title is indistinguishable from a done subtask. The rich `s`/`d`/`b`/`q` inline-command shortcuts have **no legend** (no `?` sheet).
- **[Low·S]** No loading skeleton (populated workspace briefly shows "add your first task"). Blur-commit-on-edit can drop an edit on mode-switch.
- **Visual:** R8 "Commit to **Q**ueue" (should be "Commit to queue"); R5 accent overload (committed-marker `text-primary` on *every* committed row); R4 task titles render `font-display` in Focus/Board/Queue but `font-sans` in List/detail — pick one; four different selection treatments; four different empty-state styles.
- **Cohesion:** no cross-entity hub, no drag-to-link, no `@`/`/ref`, no notifications, deep-link lands unselected (CC-12). *(The Tasks dashboard widget DOES ship now — PR #73.)*

### 4.3 Calendar — *verdict: the loop is real and mostly smooth; cohesion is where it misses*
Live: solid — week grid with a live "now" line, scheduled task-blocks, drift affordance ("· 2 unfinished from earlier · Move to today · Review"), switchable right panel (Tasks/Detail/Notes), and a graceful empty state ("Nothing to schedule — capture a task or enjoy the calm"). Token-clean.
- ~~The "Today" dashboard widget is dead code~~ **RESOLVED by PR #73** — `calendar-today-widget.tsx` now renders it live (drift strip + "Move to today" + empty state verified on Home).
- **[High·S]** Event deep-linking silently no-ops (CC-1) — `entity-open.ts:37` drops the id and the page never listens inbound.
- **[High·M]** Booking links (the other half of the §6 "Morgen-lite + Calendly" bar) are entirely absent — *scoped-out per spec*, but the brief should record it as a real hole, not an oversight.
- **[Medium·S]** "No room left today" is a **dead-end** — the day-full path toasts a bare message with no "push to tomorrow"/"make room" next step; this is the over-committer's most common path and the emotional core of §7. The one-click elapsed-triage row only appears on blocks ≥55 min (invisible on the common 30-min block). Tags render nowhere on chips. No keyboard create/complete; task blocks aren't focusable.
- **Visual:** the "now" line (1px `bg-primary` + tiny dot) is nearly lost among hour rules — the single most-glanced element should be unmistakable. Event chips vs the draw-ghost differ by ~5% opacity (hard to tell "making" from "exists"). External/read-only chips signal only via a hue (color-only → a11y gap; add a lock glyph). Grid metadata is `text-2xs` (11px, the *eyebrow* size) app-wide — the calendar reads smaller/denser than the rest of the app. Disabled single-option "Moduo" calendar `Select` reads as broken chrome.
- **Cohesion:** the **event** is a decent spine citizen; the **task-block** (the loop's central object) exposes *less* connective tissue on the grid than a read-only Google event.

### 4.4 Notes — *verdict: the most-built spine module, the least-advertised; one baseline editor gap*
Live: clean empty states ("Write something down"), sidebar with INBOX/TRASH, a note Detail panel with a nice "Nothing linked yet · Drag, @mention, or /ref to connect" empty state. All four spine pillars present; task-line↔task two-way sync, publish/import/export/comments/presence all ship.
- **[High·M]** **No live markdown shortcuts, no `⌘B`/`⌘I`, no format toolbar.** `NOTES_TRANSFORMERS` runs only on paste/import; there's no `MarkdownShortcutPlugin` and no selection UI. Typing `**bold**` or `# heading` doesn't auto-format, and inline emphasis is unreachable except by pasting pre-formatted markdown. This fails the most basic expectation a Notion/Obsidian refugee brings.
- **[High·S]** The right panel — Detail/Comments/Outline, i.e. the entire spine payoff — is **conditional-only** (`notes-page.tsx:740`): invisible until a note is selected, with no button to summon it.
- **[High·S · Visual]** The "great moment" **visibly breaks shape**: a plain `/todo` checkbox is a **square** (`global.css:448`), a converted task-line checkbox is a **circle** (`CompleteToggle`, `rounded-full`). Same action, two shapes, inline in the same list — "the checkbox *is* the task" says one thing; the pixels say "a different control replaced your checkbox."
- **[High·S · Visual]** `EmbeddedMindmap.tsx` is a wall of raw hex + arbitrary Tailwind (`#333`, `bg-[#1a1a1a]/50`, `text-[12px]`, inline `background:"#111"`) — a black box in light mode, the module's worst DS violation, and *not* editor-legacy-exempt.
- **Live UX quirk:** creating a note via "+" then typing immediately did **not** land the title (note stayed "Untitled") — new-note focus timing looks fragile (low-confidence via synthetic input; worth a real-hands check).
- **[Medium]** No keyboard nav of the note tree; slash-menu vs mention-menu use two different keyboard regimes (30ms focus hack, self-noted "validator BLOCKER"); trash has no bulk/"empty trash"; loading/empty copy is inconsistent (3 loading strings); degraded+error banners stack with a floating pill (up to 3 sync signals).
- **Cohesion:** strongest in the app, but **entirely hidden one panel-switch deep** — a note row betrays none of its links/mentions/comments; comment attribution is "You"/"Teammate" (no names, though presence resolves them); the welcome seed teaches `@`=people but never teaches `/task`/`/contact` (the actual entity-linking verb).

### 4.5 Contacts — *verdict: exemplary bones; the "great moment" leaks exactly where the moat must be felt*
Live: 11 people / 3 companies, status dots, favorites, and a strong empty state that *promises* the rollup ("every linked email, task, note, or payment rolls up onto them"). Token hygiene exemplary.
- **[Critical·L]** **The rollup has no inline snippets** — `projectors.ts` registers only `contact`/`company` and both return `snippet:null`; **no task/note/email/event/payment projector exists.** So every linked row is a bare title — the exact "flat backlink pile" PRODUCT_BRIEF §4 forbids ("grouped by relationship *with inline snippets*"). The great moment is currently a list of names.
- **[Critical·M]** Clicking a linked task/event dead-ends (CC-1) — three of five linked-work types are one-way doors on the module whose whole value is *traversing* the graph.
- **[High·M]** The "auto-rollup, always current" promise leaks: last-touch reads only the contact's *own* activity + link-creation stamps, so editing a linked task / sending the linked email **doesn't refresh** it (`use-contact-hub.ts:55`). "Current by construction" is true for links, stale for linked-entity activity — which is most of what happens.
- **[High·S]** **Soft-delete has no undo** and no confirm — a two-click `⋯`→Delete removes a contact + every rolled-up link, toast is a dead end (backend delete is soft/recoverable → an Undo action is cheap). Company delete has thinner handling (orphans members' FKs silently; no "3 people are here" warning; no unset-company path in the inline editor).
- **[High·S]** **CompanyHub has no last-touch line at all** — the most CRM-valuable line, present on people, is missing on companies.
- ~~No Contacts dashboard widget~~ **RESOLVED by PR #73** — `needs-attention-widget.tsx` + `reconnect-widget.tsx` now ship in the gallery.
- **Visual:** last-touch is one flat grey run — "2 open tasks · 1 unpaid" (an actionable signal) looks identical to "linked 3 days ago"; avatar fallbacks are initials-only → a wall of near-identical grey discs (no deterministic hue); R3 concentric radius skipped in the details card; three different section-count treatments; hub spacing is hand-picked literals, not wired to the density axis.
- **`mailto:`/`tel:`** are the entire "act on a contact" story — fine pre-Email, but the moment Email ships, a contact's "Email" button opening the OS mail client is the "opens in a new tab" anti-pattern §9 warns against.

### 4.6 Email — *verdict: clean live surface + graceful web gate; several daily-use blockers + a dead legacy tree*
Live (web): a **graceful desktop-gate** — clear banner ("Open Moduo on desktop to use email") over a calm "Nothing linked yet" empty state. Good degradation. The live components (rail, thread-list, reader, compose, connect dialog, snooze picker) are token-clean and model-quality.
- **[Critical·M]** Deep-link to a specific thread dead-ends on the unfiltered inbox (CC-1) — worse than tasks because the inbox is a firehose. Breaks the headline convert→task→back-to-email loop.
- **[High·M]** **Remote images load by default** (`email-reader.tsx` / `buildEmailSrcDoc`) — every tracking pixel fires on open, no gate, no per-sender allow. Spark/Apple/Gmail all block by default; for a smart-inbox product this is a real trust regression (the designer will be tracked by their own inbox).
- **[High·S]** Reader is a **fixed 60vh iframe** — a two-line email gets a huge white void; a newsletter scroll-traps inside nested scrollbars. It's the most-used surface.
- **[High·M]** **Convert-to-task is non-atomic** — 5 sequential RPCs; a mid-sequence failure strands an orphan task in Tasks with no compensating undo (self-noted "acceptable at alpha"). The defining feature pollutes another module on failure.
- **[High·M]** **No sync-state or manual refresh** in the live UI (`EmailPageView` never reads `syncing`), and **errored/reauth accounts are invisible on "All inboxes"** — half your mail can silently stop arriving with no signal.
- **[High·M · Visual]** The **entire legacy `email-workspace.tsx` tree is dead code** (imported only by its own stories) and carries ~120 hex/arbitrary-value violations — will trip the lint gate the moment anyone touches the folder, and misleads readers. Delete/quarantine.
- **[Medium]** Convert toast overloads "Undo" and hides "Also mark done" in the cancel slot; keyboard map undiscoverable (no `?`, `r`/reply unbound); snooze/move popovers anchor to invisible fixed-fraction spans (float away from the selected row).
- **Cohesion:** MCP surface is genuinely done + correctly metadata-only; convert creates real typed links. But activity trail + tags render **only for tissue threads** (`refId != null`) — a normal unread thread shows "No links yet"; snooze/follow-up reminders are **desktop-open-dependent** (no relay) — surface this as a known reliability limitation.

### 4.7 Mindmap — *verdict: legacy/pre-rethink stub — HIDE FROM ALPHA NAV*
Live: a coming-soon shell — "No mindmaps yet", empty node tree, a raw **pink 🧠 emoji** hero (off-system; pink is reserved for the AI disc), and the right panel literally shows the **leaked dev placeholder "Graph relations tree, feature coming soon."** The ROADMAP puts the "mindmap rethink" *after* Email + Dashboard — this code is the thing to be replaced.
- **[Critical·S]** **The create/switch/manage-map flow doesn't exist** — both empty states instruct "use the selector next to Mindmap in the top nav," but `dispatchMindmapSelectMap` has **zero emitters**; a first-run user cannot create a map. The front door is non-functional.
- **[High·M]** No visible "add node" affordance (creation is keyboard-only `N`); pan/zoom is inverted (drag box-selects; pan needs Cmd — backwards from every canvas tool); the whole 277-line auto-layout engine is dead code.
- **[Critical·L · Cohesion]** **100% off the spine** — nodes aren't entities (0 refs to `entity_links`/`tag_links`/drag-payload); can't link/tag(workspace)/search/mention/deep-link a node ("Nothing to open yet" toast); forks its own "Relations/Connections" panel (the exact overloaded-"Relations" Anytype trap the brief forbids) and its own local string-array tags; **no MCP tools, no dashboard widget.**
- **[High·L · Visual]** **The worst DS offender in the app**: 238 raw hex, 217 arbitrary Tailwind values, 13 `duration-*` bypasses, 12 inline color styles. Worse, **banned motion**: selected edges get a **perpetual white glow-pulse** (`global.css:717`, 0.75s infinite, ignores reduced-motion) and all edges pulse opacity by default — precisely the AI-slop the DS was written to prevent. Node color editing hands users **raw hex text inputs**.
- **[Medium·S]** Persistence is redb/localStorage-only — a mindmap made on desktop won't sync (contradicts cloud-first).
**Recommendation:** hide it from the nav (or flag-gate) until the rethink; shipping a broken, off-brand, Anytype-shaped surface in a scarce nav slot is worse than shipping nothing. Do the token migration *inside* the rebuild, not as lipstick on code slated for replacement.

### 4.8 App shell / global surfaces
- **[Critical·M]** Missing Billing section breaks the trial-conversion path (CC-7).
- **[High·S]** Gate renders **`null` (blank screen)** during load/error (`app-gate.tsx:11,83`) — no spinner/skeleton/timeout; a slow Supabase = indefinite blank.
- **[High·S]** Three of eight settings sections are **empty stubs** (`PreferencesSection`, `AdvancedSection` = placeholder text; Account thins for cloud users) — permanent-looking nav entries that open "coming with a future brief."
- **[High·M]** No shortcuts-help surface anywhere (CC-10).
- **[Medium·S]** About/paywall copy still says **"local-first workspace" / "Local Redb vault" / "BIP-39 recovery key"** — contradicts the cloud-first pivot; the app tells two stories about where data lives.
- **[Medium·S]** Command palette lists create actions unfiltered by permission; no "switch workspace"/settings-subsection/"new task" actions despite the placeholder promising more.
- **[Medium·S]** `⌘1–⌘7` collide with browser tab-switching on web and ship anyway (silently broken for every web user).
- **[Medium·S]** Workspace switcher invisible at ≤1 workspace; no presence/member UI anywhere in the shell despite Yjs + "ambient multiplayer" positioning (CC-10).
- **[Low·S]** Orphan `feature-empty-page.tsx` (imported nowhere); `/settings` is a route that renders null + bounces; `FeaturePanelsShell` default placeholder text ("Feature tools panel", "Graph relations tree, feature coming soon") **leaks to users** — live-confirmed on Mindmap's right panel.
- **Onboarding/paywall** are built on the deprecated RN-shim + raw hex (44 + 14 hits) — the first authenticated screens are off-system (amber `#f59e0b`, hand-rolled palette). Auth page, by contrast, is token-clean — good baseline the others diverge from.

---

## 5. Visual / design-system

**Verdict:** the *system* is strong — `tokens.css` is disciplined, the shadcn primitives are token-driven, `lint:tw` passes clean, and outside the quarantined legacy files there are **zero** raw-hex/named-color bypasses. The problem is **inconsistent adoption of the system at the feature layer**: modules were built against different maturity levels of the design language. Net — *it does not yet look like one product built by one team; it looks like a very good design system with ~4 modules faithfully following it and ~3 that predate it.* The single most damaging fact: **the current-selection highlight — the cue your eye tracks constantly — is rendered four different ways across five modules.**

### The five fixes that would most make it feel like one product
1. **Unify the selection recipe** on the R5 `--selected-bg` tint (+ a consistently *dimmed* `hover:bg-accent/60`) across contacts/notes/email/calendar — highest cohesion-per-effort. Copy `task-row.tsx`.
2. **De-tint the five appearance pickers** (they violate R5 in the surface that *configures* the design system — see C1). Trivial, high-visibility.
3. **Standardize one eyebrow class and one detail-panel header scale**, extracted as shared components so they can't drift again.
4. **Migrate the calendar/contacts/notes toolbars onto the `Toolbar` primitive** (only Tasks uses it today).
5. **Schedule the mindmap + email token migrations** — the two live routes that render in a private palette and cap the "one team" ceiling no matter how clean tasks/calendar/contacts get.

### A — Cross-module inconsistencies (the "many products" problem, ranked)
- **[A1 · Critical·M] Selection highlight is a different visual language in every module.** R5 says selection carries the accent via `--selected-bg`; **only Tasks does this** (`task-row.tsx:155-164`, left accent bar + tint). Contacts uses plain `bg-accent` (`contact-directory.tsx:96`); **Notes and Email make *selected* indistinguishable from *hover*** (both `bg-accent`, no hover dim — `note-tree-sidebar.tsx:525`, `email-thread-list.tsx:115`); legacy Email message rows use hardcoded `bg-[#161616]` + hex border. This is the highest-leverage cohesion fix in the app and it directly undermines the spine — cross-module navigation feels stitched-together when "what's selected" is a different cue in each pane.
- **[A2 · High·M] Detail-panel header — same object, three type scales.** Task title `font-sans text-md` (15px body, `task-detail-panel.tsx:232`); Event title `font-display text-base` (14px display, `event-detail-panel.tsx:149`); Contact/Company title `font-display text-2xl` (24px display, `contact-hub.tsx:473`). And the panel *genre* differs: Contacts are centered `max-w-2xl` card experiences, Task detail is a tight rail inspector, Email detail is an `EmptyState` stub.
- **[A3 · High·M] The section eyebrow is specified ~4 different ways.** Feature majority (41 hits) is `text-2xs font-medium uppercase tracking-wide`, but Notes + Settings deviate to `text-xs` (12px), and the shadcn primitives' group labels are `text-xs uppercase` — so a Select's group header and a Contacts section label don't match. Face is split too (13 `font-sans`, 7 `font-display`) — invisible today (one font) but a **latent R4/R9 fork** the instant a display face returns.
- **[A4 · High·M] Only one feature uses the `Toolbar` primitive.** The primitive exists so control rows "read as one toolbar"; only `plan-view-header.tsx` imports it. Calendar, Contacts, Notes, Mindmap hand-roll flex rows with different gaps/grouping (controls mostly land on the right *rung*, so alignment is largely OK — the divergence is structural and will drift).
- **[A5 · Medium·M] List-row metrics drift per module** — five "a row you click" patterns, five different height/padding/gap combos (Tasks `--row-h`/`px-2`/`gap-2`; Contacts `py-1.5`/`gap-2.5` no height token; Notes `gap-1` + inline px nesting math; Email `p-[10px]`).
- **[A6 · Medium·S] "Chip" is three silhouettes** — pill (`rounded-full` Badge), medium-radius (calendar hand-rolls its own), borderless-inline (TagChip); Email hand-rolls its count pill instead of Badge.
- **[A7 · Medium·S] Empty states — partial primitive adoption** — `EmptyState` is used by tasks/contacts/email/mindmap, but Task-detail ships `DetailEmptyState` and Contacts/Notes inline bespoke "No … yet" prose. Three treatments.

### B — Hard violations (worst offenders — mostly quarantined debt, but two are *live routes*)
1. **Mindmap** (`/mindmap`, live) — ~160 raw hex literals across 9 files + its own 5-theme palette (`types.ts` alone has 64 hex defining indigo/forest/ocean/ember themes that don't exist in the token surface), ~200 arbitrary Tailwind values, sub-scale micro-type (`text-[9px]`), `hover:scale-105`+`duration-200` motion idiom, and the **banned perpetual white glow-pulse on edges** (`global.css:717`, ignores reduced-motion). Reads as an embedded third-party widget. Do it in the rethink (§4.7).
2. **Dead `email-workspace.tsx` tree** (imported only by its own stories) — ~108 hex across 9 files, **inline `fontFamily:"Inter"` (violates R9 one-font)**, named red error colors. Delete (§4.6).
3. **Onboarding + Paywall** — RN-shim + 44/14 hex hits on first-impression surfaces (§4.8).
4. **Notes `EmbeddedMindmap.tsx`** — hex wall, black box in light mode (§4.4).
- **[B4 · Medium·S] Lint blind spot:** `check-arbitrary-tw.ts` catches `bg-[#…]` but **not named Tailwind palette utilities** (`text-red-400`, `border-t-emerald-500`, `bg-red-500/10`) — these bypass the token layer just as much and already slipped through (`mindmap-empty-state.tsx:23`, email error states). Extend the lint regex.

### C — Relational-rule regressions (judgment calls)
- **[C1 · High·S] All five appearance pickers tint selected chrome** with `border border-primary bg-accent` (`density-picker.tsx:38`, `theme-picker.tsx:63`, `font-picker.tsx:43`, `tabs-picker.tsx:45`, `radius-picker.tsx:39`) — an R5 accent-budget violation in the surface that *configures* the design system, and a **third** competing "selected" language. Easy fix (accent-picker is the legitimate exception). *Everything else the accent audit checked was R5-compliant — done-check, tab underline, drag rings, today-line, unread dot are all sanctioned; segmented controls correctly stay neutral.*
- **[C2 · Medium·M] Eyebrow face-role split** (A3) as a latent R4/R9 fork — pick one spec (recommend `font-sans text-2xs font-medium uppercase tracking-wide text-muted-foreground`, the 41-hit majority) and extract it.
- **[C3 · Medium·M] Control-rung structural bypasses** (A4) — plus Notes sidebar header buttons (`p-1`, no rung) and the mindmap toolbar won't respond to the density axis (R7).
- **[C4 · Low·S] `Badge` (`font-sans`) vs `Button` (`font-display`)** — baked-in role-face mismatch, latent under one font.
- **[C5 · pass] R8 casing is broadly clean** — the pervasive `uppercase` is a CSS transform on eyebrows, not Title-Cased strings; proper nouns stay capitalized. (The one specific nit: Tasks' "Commit to **Q**ueue" vs its sibling "Remove from queue" — `task-detail-panel.tsx:524`.)

---

## 6. What's genuinely good (so it's protected, not "simplified" away)

- **The pure spine layer** (`entity-links.ts`, `drag-payload.ts`, `rollup.ts`, `mention.ts`, `notifications.ts`) is clean, unit-tested, runtime-free, and correctly reused where adopted. The foundation is sound; the gap is *surface adoption*, not architecture.
- **Tasks** Plan/detail surface is close to Linear-light — dense, keyboard-first, graceful-slippage messaging ("Drifted…"), spotless tokens.
- **Calendar** schedule-to-completion mechanics (elapsed triage, roll-forward with unified Undo, drag-to-schedule) genuinely work and are token-clean; the "enjoy the calm" empty state nails the brand voice.
- **Contacts** architecture, token hygiene, and directory are exemplary; the empty state *sells* the rollup.
- **Notes** is the most complete spine adopter (links, activity, mentions, MCP, task-line sync, publish) — the plumbing is there.
- **Email** live components + the graceful web desktop-gate + a correctly-scoped metadata-only MCP surface are model-quality.
- **Dashboard shell** (grid engine, drag physics, pager, persistence) is high-quality, well-tested, DS-clean engineering — it just needs its engine (DB-5).
- **The `moduo:entity:open` host listener** is built and correct — the deep-link *destination* is ready; only per-entity id-granularity is missing (CC-1).
- **Deep-link "dispatched-but-inert" and "api-key writes dead" gotchas are resolved** — the historical footguns didn't regress.

---

## 7. Live-verification notes & caveats

- **Verified live** on the hosted test account (`grzywaczmj+moduo-s2-test`, workspace "Claude Test S2") in a real local Chrome at 1440×900 desktop, session-injected. Walked Home, Tasks, Calendar, Notes, Contacts, Email, Mindmap + the command palette. No paywall blocked access (trial appears comped/extended). Account appearance is currently `accent:mono, shade:black` (colorless), so **accent-usage (R5) was assessed from code, not the live render.**
- **First-hand source-verified** the three load-bearing Critical/High claims: `entity-open.ts:32-38` (deep-link id-drop), `widget-frame.tsx:50` (empty widget body / DB-5 unbuilt), and the missing Settings "billing" section vs `trial-banner.tsx:70`.
- **Not live-verified** (couldn't, or out of scope): the desktop-only Email engine (IMAP sync/triage/reauth — assessed from Rust + hook code); external calendar sync (desktop); the Settings modal sections and notification bell live (Chrome extension dropped mid-pass — assessed from code with file refs); light mode, mobile/tablet (out of scope per CLAUDE.md).
- **Re-base note:** mid-critique, PR #73 (DB-5…DB-8) merged into `maciej` from a parallel session. This worktree was merged up and every dashboard-related finding was re-verified live against the new code (gallery, quick-capture round-trip, page-full flow, widget deep-link CC-1 confirmation). Findings marked ~~struck~~/**RESOLVED by PR #73** were true against the pre-merge base and are kept for the record.
- **Second-wave caveat:** four deeper-dive agents were killed by an unrelated interrupt mid-run and partially recovered via first-hand checks (the 401 root cause, focus-session loss, notification grouping, BUILD_ORDER status are verified). The three surfaces they left un-audited (workspace-settings modal, published-note page, toast/undo inventory) were **audited 2026-07-10 — see §8 Appendix**.
- **Housekeeping:** I created one empty scratch note ("Untitled") in the test account's Notes inbox; a probe task created via quick-capture was deleted; a second dashboard page with a Recently-linked widget was added while testing the gallery and **left in place** (remove via edit mode → page dots → trash if unwanted).
- **10 read-only subagents** produced the underlying detail (spine-cohesion, app-shell, per-module ×7, design-system). This BRIEF is the synthesis; the agents cite exhaustive `file:line` refs for every item above.

---

## 8. Appendix — gap audit (2026-07-10): workspace settings · public note page · undo grammar

*Completes the three surfaces the killed second-wave agents left uncovered. Same severity/effort legend.*

### 8.1 Workspace settings modal — *verdict: a clean, token-compliant shell around a functionally broken collaboration loop*

- **[Critical·M] Invitees have no accept surface.** `joinWorkspace` is consumed only by `WorkspaceSwitcher` (`workspace-switcher.tsx:36,114`) — which **returns `null` at ≤1 workspace** (`:126`). A fresh user with just their default workspace — i.e. **every real invitee** — has nowhere to paste the invite code. No `/join/:token` route exists outside the gate (`route-tree.tsx:52,141`), no notification-driven accept. The invite loop is only completable by users who already have 2+ workspaces. For a product positioning "light async multiplayer," the add-a-teammate loop doesn't close.
- **[High·M] "Invite" sends nothing.** `issueInvite` is a bare row insert (`runtime.web.ts:398-410`); no invite-email edge function exists. The UI shows a `Send` icon, "Sending…", and an email input (`workspace-settings-modal.tsx:510-527`) — the email is dead metadata; the only real delivery is a silent clipboard copy of the token.
- **[High·S] Members render as truncated UUIDs** with a hex-char avatar (`workspace-settings-modal.tsx:352-358,582-587`). Nearly free fix: `listMembers` already joins `profiles(*)` (`runtime.web.ts:428`) but `mapMember` throws the profile away (`workspace-mappers.ts:29-38`).
- **[High·M] No remove-member or leave-workspace UI.** No `removeMember` op exists (`runtime.types.ts:226-240`); `leaveWorkspace` is fully plumbed (`workspace-provider.tsx:183-190`) with **zero UI consumers**. Owners can demote, never eject; members can never exit.
- **[Medium]** Per-module permissions ride every write but the modal always derives them from the role (`workspace-settings-modal.tsx:64-68,396-404`) — `updateInvite` is plumbed, consumed nowhere. Invite/role errors vanish silently (`handleSendInvite` has no catch, `:394-414`). Non-admins get a one-sentence wall instead of a read-only roster + Leave (`:463-466`). `joinInvite` trusts the bare token — no email match, no expiry enforcement (`runtime.web.ts:411-426`).
- **[Low]** API keys are the best part (secret-shown-once + copy + scopes) but revoke is instant with no confirm (`:180-188`). The workspace-delete flow animates with raw `ms` easings (R6 violation, `workspace-switcher.tsx:355-363`) and uses text glyphs `✓`/`×`/`+` as icon buttons; `h-6 w-6` controls sit off the R1 rungs.

### 8.2 Published-note public page — *verdict: the app's only public surface is genuinely good; gaps are reach, not craft*

- **[High·S] Child pages unreachable on mobile** — the subtree nav is `hidden … md:block` with no toggle (`published-note-page.tsx:194`). Public links are the one surface guaranteed phone traffic; below 768px a multi-page doc silently amputates to its root.
- **[Medium·M] Nav order is alphabetical, not authored** — children sort by `localeCompare(title)` (`:117`); the edge fn returns no position field (`notes-public/index.ts:109-115`).
- **[Medium·S] Anonymous visitors always get dark** — appearance boots from localStorage, tokens default dark, no toggle on the page. A light-OS stranger lands on a black page with no recourse.
- **[Low]** Bare "Loading…" state; `noindex` is client-injected only; no per-note OG meta (shared links unfurl as the generic shell). Edge fn reads the whole workspace per hit with a 30s cache — fine at alpha, a cost cliff later.
- **Verified good:** revoked/trashed/archived tokens 404 correctly; URL scheme allow-list is solid; prose CSS 100% token-routed; sentence-case, blame-free copy.

### 8.3 Toast/undo grammar — *verdict: email/calendar/notes share a mature 8s-undo grammar; the worst offenders are the highest-traffic paths*

| Destructive action | Undo? | Window | Ref |
|---|---|---|---|
| **Task delete (Tasks module, ⌘⌫/menu)** | **None — no toast, no confirm** | — | `use-tasks-module.ts:631-648`, `task-list-view.tsx:286-289` |
| Task delete (from a note) | ✅ | 8s | `use-notes-task-bridge.ts:242-249` |
| Note → trash (subtree) | ✅ | 8s | `use-notes-module.ts:368-385` |
| Email triage / convert / send | ✅ | 8s / 8s / 10s | `email-page-view.tsx:278-324`, `use-email-compose.ts:86-89` |
| Calendar unschedule / move / extend | ✅ | 8s | `calendar-page-view.tsx:594-665` |
| **Calendar event delete** | **None** | — | `use-calendar-module.ts:194` |
| **Tag delete (strips tag everywhere)** | **None, silent success** | — | `use-entity-tags.ts:170-180` |
| Habit remove | ✅ but 4s (sonner default) | 4s | `habits-widget.tsx:249-276` |
| **API key revoke** | **None, no confirm** | — | `workspace-settings-modal.tsx:180-188` |
| Workspace delete (soft) | type-to-confirm, **no restore surface** | — | `workspace-switcher.tsx:365-417` |

- **[High·S] Same verb, different guarantees:** deleting a task from a note = 8s undo; deleting the identical task in the Tasks list = silent, permanent, one keystroke chord away. Against §7's anti-guilt posture this is the sharpest edge in the app.
- **[Medium·S]** The trash toast puts the destructive "Delete task(s)" escalation in sonner's neutral `cancel` slot (`use-notes-module.ts:378-384`) — a destructive verb in the dismiss position. Undo-window drift: the de-facto standard is 8s; habits quietly get 4s. Success-toast grammar splits between neutral `toast()` (notes/email/calendar) and `toast.success` (tasks/contacts).
