# Calendar — Design Brief (the build spec)

> **Status:** Ready for spec — written 2026-07-02 from the `/plan` grilling round with Maciej. Every product decision below was explicitly ratified by him or follows from a decision he made; technical calls are recorded in `specs/calendar.md` §Assumptions.
> **Pairs with:** [BRIEF.md](./BRIEF.md) (product intent — still authoritative on JTBD/ceiling/moat), [COMPETITIVE_RESEARCH.md](./COMPETITIVE_RESEARCH.md) (the Morgen bar + the execution-loop gap), [docs/moduo-module-contract.md](../../docs/moduo-module-contract.md), [DESIGN_RULES.md](../../DESIGN_RULES.md).
> **The bar:** Maciej uses Morgen daily; Moduo Calendar must feel *at least* Morgen-level on the planning surface, and own the execution loop no incumbent ships (research §3).
> **Supersedes:** the legacy localStorage/redb calendar (`use-calendar.ts`, `/calendar` exploratory page). Its **desktop OAuth + Google/Outlook sync engine is preserved and reused** as the v1 external-sync source; its localStorage event store is retired.

---

## 1. v1 scope (locked with Maciej, 2026-07-02)

**In v1 — "the loop + read-only external events":**

| Decision | Locked answer |
| --- | --- |
| Non-negotiable core | The completion loop: complete-in-block · elapsed-block triage · the strip with one-gesture move-to-today. External sync defers before the loop does. |
| Views | **Day + Week** (7-day default; settings: hide weekends, week-start day). Month/agenda are fast-follows. |
| Default view | **Week** (Morgen habit) — then **remember last used** per user/workspace. |
| Home | Top-level **/calendar** route + left-nav item (route *rebuild* of the legacy exploratory page — sign-off given). |
| External calendars | **Google + Outlook, read-only**, visible on **desktop AND web** via the metadata mirror (desktop engine → Supabase). Two-way write-back is v2. |
| Block detail | **Popover first, panel on demand** (single click = quick popover; open = right-panel Detail). |
| Right panel | **Switchable multi-view surface** (a Moduo-wide IA principle — see §5): Calendar v1 variants = **Tasks** (default) + **Detail**. |
| Left rail | Mini-month navigator + calendar list (colors/visibility; Moduo first, then accounts). Collapsible. |
| Elapsed-block triage | Quiet in-grid chip, **no toast/badge/notification**, appears at elapse, ignorable forever. Actions: **Done · Later today · Took longer · Remove**. |
| "Later today" | One click → block jumps to the **next free gap today** that fits (after now, around events, inside working bounds); if none, → the strip. Undo. |
| "Took longer" | **Just records the time** (block's span → task actuals); task stays open; **no remainder object**. |
| The strip | One quiet line above the grid; look-back ≈ **7 days**; TWO actions: **Move to today** (auto-place all, one Undo) + **Review** (right-panel list: untick items, then move / drag / remove). |
| Focus timer | **In v1** — "Start focus" on a task block; actual minutes accrue to the task (reuses the existing focus machinery). |
| Creating | **Draw on grid + quick popover** (inline title, time, calendar, all-day). ⌘K natural-language create is v2. |
| Repeats (native) | Presets (daily / weekdays / weekly / monthly) **+ "Custom" in natural language** ("every tuesday and thursday at 9") with a plain-English echo before saving and a graceful can't-parse fallback. |
| Day-fullness | **Cut from v1** (Maciej: with un-blocked work it would "almost never show the correct stats"). A quiet working-hours *bound* still exists for auto-placement only — not a visible feature. |

**Out of v1 (sequenced):** → §11.

---

## 2. Concept model — two things on the grid, one truth

The grid renders **two kinds of chips** (research §2: Morgen makes this distinction visually explicit; so do we):

1. **Event** — a calendar entry. Two sub-kinds:
   - **Native (Moduo)** — created by drawing on the grid; lives in `calendar_events`; fully editable; may repeat (§7).
   - **External (mirrored)** — from a connected Google/Outlook calendar; **read-only everywhere in v1** (open shows detail + a "managed in Google/Outlook" line + an "Open in Google Calendar" affordance); may carry recurrence, all-day, etc. from the provider.
2. **Task block** — a task placed in time. **It is literally the task row**: the grid renders any open task whose `scheduledAt` falls in view, sized by `durationMinutes` (default 30 when unset). No separate "block" object exists in v1 — the calendar is a *lens* on the task, so Tasks and Calendar **cannot drift apart** (the category-defining Morgen weakness, research §6). It shows a **checkbox**; its color is deliberately quieter than events (Morgen: scheduled tasks are "void of color" — we render them on the `muted`/outline treatment, events on their calendar color).

Consequences (all ratified):
- Scheduling a task from *anywhere* (capture modal "tomorrow 9am", detail panel, calendar drag) makes it appear on the grid — one field, `scheduledAt`.
- The Tasks module's **drift** state ("scheduled time passed, still open") and the calendar's **"unfinished from earlier"** are the *same computed state*, surfaced twice — triaging in either place fixes both.
- One task = one placement at a time in v1 (re-dragging moves it). Multi-session-per-task is the post-alpha upgrade that would introduce a real `time_blocks` table (recorded in the spec).
- A **done** task block stays on the grid for the day it happened — checked, dimmed, serene. Past events dim similarly. **Never red, nothing pulses.**

---

## 3. Page anatomy (three panes)

```
┌─────────────┬──────────────────────────────────────────────┬───────────────────┐
│ LEFT RAIL   │ CENTER — the grid                            │ RIGHT — switchable│
│ (collapsible│                                              │  [Tasks ▾]        │
│  like the   │ ┌──────────────────────────────────────────┐ │                   │
│  bucket     │ │ toolbar: ‹ › · Today · [Day|Week] · date │ │ Tasks to schedule │
│  rail)      │ ├──────────────────────────────────────────┤ │  ── Today (3)     │
│             │ │ strip (only when non-empty):             │ │  ☐ invoice run 45m│
│ ┌─────────┐ │ │ · 3 unfinished from earlier              │ │  ☐ email Jan      │
│ │mini month│ │ │        [Move to today] [Review]         │ │  ── Due soon      │
│ │  · · ·  │ │ ├──────────────────────────────────────────┤ │  ☐ offer draft 1h │
│ └─────────┘ │ │ all-day lane                             │ │  ── Backlog       │
│             │ │ ──────────────────────────────────────── │ │  ☐ …              │
│ CALENDARS   │ │  9 ┌────────────┐                        │ │                   │
│ ● Moduo     │ │    │ ☐ write    │  ← task block (muted,  │ │ (or Detail view   │
│ ● Personal  │ │ 10 │   offer    │     checkbox, quiet)   │ │  when a chip is   │
│   (Google)  │ │    └────────────┘                        │ │  opened)          │
│ ● Work      │ │ 11 ┌────────────┐ ← event (calendar      │ │                   │
│   (Outlook) │ │    │ Jan · Meet │    color, attributed)  │ │                   │
│ + Connect…  │ │    └────────────┘                        │ │                   │
│             │ │ ━━ 11:37 now ━━━━━━━━━━━━━━━━━━━━━━━━   │ │                   │
└─────────────┴──────────────────────────────────────────────┴───────────────────┘
```

Composed on `FeaturePanelsShell` (`feature="calendar"` — the layout key already exists), resizable, widths persisted per feature. Left/right both collapsible; grid-only is a valid working mode.

### 3a. Left rail — *navigate & choose what you see*
- **Mini month** (extends the existing `react-day-picker` wrapper): click a day → grid navigates (Day view jumps to it; Week view moves to its week). Days carrying events/blocks get a subtle density dot (custom `modifiers`). Today ringed, selected filled — existing component behavior.
- **Calendar list** — one row per calendar: color swatch · name · visibility toggle (eye/checkbox). Grouped: **Moduo** (native) first, then each connected account (`display label = "Personal — name@gmail.com"`), its calendars indented under it. Row menu (⋯): change color (token-routed swatch set), hide/show. **"+ Connect calendar…"** at the bottom → opens Settings → Integrations (§8).
- Visibility + colors persist per user (same preference channel as view state, §10).

### 3b. Center — toolbar, strip, grid
- **Toolbar:** `‹ ›` (period nav) · **Today** · view segmented control **Day | Week** · the visible range label ("June 30 – Jul 6") . Right side: a quiet refresh affordance with last-sync time for external calendars (§8).
- **The strip** (only rendered when non-empty): `· 3 unfinished from earlier   [Move to today] [Review]` — muted-foreground text, control-rung buttons, never red, no icon-shouting. Detailed behavior §6c.
- **The grid:** hour gutter (respect density tokens); horizontal hour lines `border-border`; **now line** = a 1px `primary` rule with a small dot in today's column only; working-hours span rendered at full background, off-hours slightly dimmed (`muted` wash); weekend columns hideable (setting); all-day lane pinned above the hours, collapsed to one row until it has content.
- **Week view:** 7 columns (start-of-week setting), day headers = weekday + date, today's header emphasized (not colored — weight). **Day view:** one wide column; more generous chip content (title + time + calendar attribution inline).
- Scroll position on open: centers around `now` (or 9:00 when viewing another day).

### 3c. Right panel — the switchable surface (see §5)
Default **Tasks** view; **Detail** view takes over when a chip is opened, with a back affordance to Tasks. The switcher control is the seed of the app-wide pattern.

---

## 4. Grid interactions (the planning surface — Morgen-parity tier A)

| Gesture | Behavior |
| --- | --- |
| **Draw on empty grid** | Click-drag vertically → a ghost block follows the drag, snapping to the grid step; release → inline title input focused inside the new chip + the quick-create popover (§7a). Esc cancels. Plain click (no drag) on empty grid = 30-min ghost. |
| **Drag a chip** | Moves it (snap; live time readout while dragging). Task block → writes `scheduledAt`; native event → updates times; **external event → not draggable** (subtle resistance + "read-only" tooltip). |
| **Resize top/bottom edge** | Changes duration (task block: writes `durationMinutes`; the block-duration↔task-estimate equivalence is deliberate — research §2). External: not resizable. |
| **Drag task in from right panel** | The universal drag contract (CT-3): the task-row drag payload is accepted by the grid as a drop target; drop → task scheduled at the drop slot (`scheduledAt` + default/estimated duration), sub-200ms optimistic. The task row in the panel gains a quiet "scheduled ✓ 14:00" affordance and leaves the unscheduled group. |
| **Click a chip** | Quick popover (§7b). **Double-click / "Open"** → right-panel Detail. |
| **Checkbox on a task block** | Completes the task (`tasks.set_status` — recurrence pointer advances via the existing engine). Block flips to done state in place. Uncheck reopens. |
| **Keyboard** | `T` today · `←/→` prev/next period · `D`/`W` views · `Esc` close popover · `Delete` on selected native chip (confirm for events with repeats) · arrow keys nudge selection between chips. (⌘K create is v2; the palette exists but calendar verbs come later.) |
| **Snapping** | 15-min step (drag/resize/draw), 5-min with `⌥` held. |
| **Overlaps** | Side-by-side columns within the slot (standard cluster layout), max 3 visible then a "+N" overflow chip that opens a popover list. Task blocks and events overlap freely — no forced exclusivity. |

Every mutation is optimistic (apply → reconcile → roll back on error with a quiet toast). Sub-200ms perceived is the P0 bar.

---

## 5. The right-panel switcher (Moduo-wide IA principle, seeded here)

**Principle (Maciej, stated repeatedly, now recorded):** the right panel is a **user-switchable surface** with per-module hand-picked variants — never a hardcoded single purpose. Someone may want a note open next to their day. Every module will declare its variant list; the switcher control must look/work the same app-wide.

**v1 realization (Calendar is the first adopter):**
- A compact switcher at the panel top (shadcn `Select` or segmented control at panel-header rung) listing the module's variants. Calendar v1: **Tasks · Detail**. The set is a typed, per-module registry (`rightPanelVariants: [{ id, label, icon, render }]`) designed so Tasks/Notes/Contacts pages can adopt it without rework, and future variants (a note, a contact hub) slot in as entries.
- **Detail** enters automatically when a chip is opened (switcher shows "Detail"); switching back to Tasks keeps the selection but closes nothing — reopening via the chip returns. When nothing is open, Detail shows a quiet empty state ("Select something on the calendar").
- Panel state (which variant last chosen) persists per feature (§10).

**Variant 1 — Tasks (default; the drag source):**
- Groups, in order: **Today** (committed-for-today, in commit order) · **Due soon** (next 7 days, not done) · **Backlog** (open, unscheduled, uncommitted — capped list + search). A small search field filters all groups.
- Row = checkbox (completes, same op as everywhere) · title · duration chip if set · due hint. Rows are drag sources (existing task drag payload). Already-scheduled tasks show their time and sort to the bottom of their group rather than vanishing (visibility beats purity; they're already on the grid — the row is how you *find* them).
- Empty state: "Nothing to schedule — capture a task or enjoy the calm." with a Capture button (opens the existing capture modal).

**Variant 2 — Detail (popover's big sibling):**
- **Task block:** the existing Task detail panel component, reused as-is (title, status, schedule, duration, time spent, recurrence, tags, links/activity) — zero new task UI.
- **Native event:** title (inline-edit) · time range + all-day · repeat control (§7c) · calendar (Moduo) · notes field · **Links** section (spine `EntityHub`, variant=rail: attach contacts/notes/tasks) · **Activity** trail (quiet, newest-first) · Delete.
- **External event:** same layout, read-only fields · source attribution row ("Work — Outlook · synced 12 min ago") · Links + Activity fully live (linking external events into the spine is the point of the mirror) · "Open in Google/Outlook" link-out. No delete (a "hide" is v2 if wanted).

---

## 6. The completion loop (the moat — every detail deliberate)

Design constraint inherited from the research (§3/§5.1): Morgen's philosophy is "scheduled ≠ due; a missed block is not failure" — we *diverge* by rolling forward, so every loop surface must stay guilt-free: **legible, local, consented, reversible. Never red. Never a modal. Never a notification.**

### 6a. Complete from the block
The checkbox lives on the task block at every size (min-height chips render it left of the title). Tick → done in place: checkbox fills, title gets a strikethrough at `muted-foreground`, block background drops to the done treatment. The Tasks module sees it instantly (same row). This is the floor Morgen also has — table stakes, but ours needs no sync-back.

### 6b. The elapsed chip (the category first)
- **Trigger:** a task block whose end passed while the task is still open (client clock tick, 30s cadence; catches up on tab wake). Events never triage. **Presentation:** a one-line action row *inside the block's footer* (block grows a rung if too small): `Done · Later today · Took longer · Remove` — text buttons at `muted-foreground`, hover to `foreground`. The block itself shifts to a slightly desaturated "elapsed" treatment. **No toast. No badge. No sound. Nothing follows you.**
- **Done** — completes (identical to the checkbox).
- **Later today** — finds the **next free gap today** that fits the block's duration: after `now`, skipping events + task blocks + off-hours (the invisible working-hours bound). Found → move + quiet inline confirmation ("→ 15:30") with **Undo** (toast with undo action, 8s). No gap → the block unschedules into the strip, copy says "No room today — moved to the strip."
- **Took longer** — the block's planned span is recorded onto the task's actual time (`+90m logged`), the block closes as a "worked" state (dimmed, small clock glyph, no checkbox strike — the task is *not* done), and the task remains open (visible in the right panel's groups again). One undo.
- **Remove** — unschedules (clears `scheduledAt`); the task survives untouched in Tasks. The chip disappears from the grid. Undo.
- Multiple elapsed blocks each carry their own row; the strip counts them (§6c) so bulk handling never requires per-block clicks.

### 6c. The strip (roll-forward)
- **Content:** open tasks whose scheduled time passed — earlier **today** + the previous **7 days** (same drift computation as Tasks; older ones quietly drop off the strip; the task always survives in Tasks). Copy: `· 3 unfinished from earlier`.
- **[Move to today]** — one gesture: place *all* into today's remaining gaps, in original order, each getting the next fitting slot (same gap-finder as Later-today). Result toast: "Moved 3 to today · Undo" — **one Undo reverses all**. Items that don't fit remain in the strip ("2 moved · 1 didn't fit").
- **[Review]** — opens the right panel (a Review sub-state of Tasks view): each item = checkbox (include/exclude) · title · origin ("yesterday 10:00 · 45m"), then a `Move N to today` button; rows are also directly draggable onto the grid, and each row has a Remove (unschedule) action. The 90% case stays one click; the control case is one click deeper. No settings, no modal.
- The strip appears in both Day and Week views, only when non-empty, first render animated with the standard motion tokens (no attention-seeking).

### 6d. Focus timer (execute inside the block)
- **Start focus** appears on a task block's popover + Detail (and on the block's hover actions at comfortable sizes) for *current-ish* blocks (starting within the hour or elapsed).
- Running: the block gets a subtle live treatment (thin progress edge along the block's leading border + elapsed readout `23:14`) — the calendar itself is the timer surface; no separate overlay window. Controls on the block/popover: pause · stop.
- Time accrues to the task's actuals via the **existing** accumulation path (periodic flush, same as the Tasks execute view — one write mechanism, two surfaces). Stop → "47m logged to *write offer*".
- One session at a time; starting elsewhere stops the previous quietly. Focus prefs (sound etc.) come from the existing focus settings.

---

## 7. Creating & editing

### 7a. Draw-to-create (quick create)
Release the drawn ghost → the chip materializes with an **inline title input** + a small popover beneath: time range (editable, prefilled) · **all-day** toggle · calendar picker (v1: Moduo only — shown anyway, seeding the §8 wrong-target guard) · **Repeat** (§7c) · `Enter` saves, `Esc` discards. Typing nothing and clicking away discards (no untitled litter). "More options →" opens Detail after save.

### 7b. The chip popover (single click)
- **Task block:** title · time · checkbox · duration · **Start focus** · Open. Elapsed → the four triage actions appear here too (same actions as the in-grid row).
- **Native event:** title · time · calendar · repeat summary ("weekly on Tue, Thu") · Open · Delete.
- **External event:** title · time · **source attribution** ("Personal — Google") · Open ("Open in Google" beside it). Read-only fields are visibly static, not disabled-looking form controls.

### 7c. Repeats (native events)
- **Presets:** Daily · Weekdays · Weekly · Monthly (the Tasks vocabulary, same underlying rule builder).
- **Custom (natural language):** a text input — *"every tuesday and thursday at 9"*, *"every other friday"*, *"first monday of the month"* (the promised phrase set is pinned by unit tests). Beneath it, a **live plain-English echo** of the parse: `→ weekly on Tue & Thu · 9:00–9:30` — the echo is the consent gesture; nothing saves until it reads right. Un-parseable → a polite inline "Couldn't read that — try 'every tuesday at 9' or pick a preset" (mirrors the capture parser's existing `unparsedRecurrence` posture; **never** a silent wrong guess).
- Rendering: recurring native events expand client-side into the visible range. Editing a recurring event v1 = **edit the series** (single-occurrence exceptions are v2; the edit dialog says so plainly). Deleting asks "Delete this repeating event? All occurrences go with it."
- External recurring events render wherever the provider's expansion puts them (the mirror stores occurrences/rrule as synced).

---

## 8. Connectivity (accounts, mirror, attribution)

**v1 posture:** connect Google + Outlook; their events **appear everywhere and are read-only**; Moduo-native events are the only writable kind → the "wrong-calendar invite" instant-uninstall bug is *structurally impossible in v1* (nothing writes outward). The default-target picker becomes meaningful in v2 (write-back) and its UI seat is already reserved in the create popover's calendar picker.

- **Connect flow:** Settings → **Integrations** → Calendar (the existing OAuth section, kept): Connect Google / Connect Outlook (desktop-only actions — the OAuth engine is the desktop Rust one; on web the buttons explain "Connect from the desktop app"). Account rows list their calendars with per-calendar visibility + color.
- **The mirror (how web sees your meetings):** the desktop engine syncs providers (existing code), then upserts **lightweight event metadata** to Supabase — the email-refs pattern (data-layers §6) applied to calendar: title, times, all-day, status, recurrence expansion window, source account + calendar, external ids. Web and desktop both *render from Supabase*; desktop is additionally the sync writer. Bodies/attendee lists beyond names stay provider-side in v1.
- **Freshness:** sync on desktop-app foreground + every ~15 min while running; the toolbar shows "synced 12 min ago" with a manual refresh. Morgen's hourly-and-manual cadence is the complaint benchmark to beat (research §6) — but honesty about staleness (the timestamp) matters more than the number.
- **Attribution (non-negotiable):** every external chip carries its calendar color; popover + Detail always name the source ("Work — Outlook"). The left-rail grouping *is* the account map.
- **Removing an account** clears its mirrored events (registry tombstones cascade the spine links safely).
- **Spine:** mirrored events register into `entities` like everything else — an external meeting is linkable to a contact/note/task on every client. That's the *point* of mirroring metadata.

---

## 9. States (every surface)

| State | Treatment |
| --- | --- |
| **Empty (no events, no tasks scheduled)** | The grid itself, calm — plus one quiet line in today's column: "Drag a task in from the right, or draw a block." Right panel Tasks view carries the real onboarding weight. No illustration walls. |
| **Loading** | Grid skeleton = hour lines + 2–3 shimmer chips; right panel rows shimmer. Never blocks interaction with the toolbar. |
| **Error (reads)** | Per-surface quiet inline error + retry ("Couldn't load your calendars — Retry"). The grid still renders whatever loaded (tasks may render while events fail, and vice versa). |
| **Error (writes)** | Optimistic apply → on failure, rollback + toast with Retry. Never silently lost (the CT-3 posture). |
| **View-only member** | Grid fully visible; create/drag/resize/triage/checkbox disabled (standard disabled affordances + tooltip "View-only in this workspace"); popovers read-only; right panel Tasks list read-only. Mirrors the Tasks permission lane. |
| **Offline / flaky** | Web is cloud-only (existing posture): reads fail to the error states above; the page stays navigable. No offline queue in v1. |
| **Deploy gap** | All new-RPC reads wrapped + degrade to empty (the notification-bell lesson, gotchas): a missing migration must never blank the whole page — tasks-on-grid work even with zero calendar tables because they ride shipped Tasks reads. |
| **External sync stale/broken** | Chips stay (last mirror) + toolbar timestamp ages honestly; account row in settings shows the error state with a Reconnect action. |

---

## 10. Persistence, settings, preferences

- **Per user+workspace (localStorage, the Tasks pattern):** last view mode (day/week) · last visible date · panel widths/collapse (shell-managed) · right-panel variant.
- **Cloud (`user_preferences.calendar` domain, the appearance/focus pattern):** working-hours bound (default 08:00–18:00; used **only** for auto-placement gap-finding in v1 — no visible fullness UI) · week-start day · show-weekends · calendar visibility/colors (per-calendar map). Cloud so a second device matches; last-write-wins like the other domains.
- **Settings surfaces:** Integrations (accounts, §8) + a small **Calendar** group under Preferences: working hours, week start, weekends. No settings page bloat — six controls total.

---

## 11. Explicitly deferred (sequence, with their triggers)

| Deferred | Lands | Notes |
| --- | --- | --- |
| **Reflow my remaining day** (preview + reasons + one undo) | v2 | The strip's Move-to-today is its little sibling; reflow adds the *proposal* UI. Trust rules pinned in research §5.1. |
| **Morning plan + evening shutdown ritual** (pre-assembled, skippable) | v2 | Steal Sunsama's loved loop, kill its 15-min tax (research §4). Rides the strip + committed-queue machinery. |
| **Two-way external write-back + default-target picker** | v2 | The edge-function relay decision is pre-made (BRIEF §8). The create-popover's calendar picker is the seat. |
| **⌘K natural-language create** ("call Tom tomorrow 3pm") | v2 | Parser (chrono) + palette both exist; wiring is cheap after the grid ships. |
| **Month view (read-only) · agenda view** | fast-follow | Ceiling per BRIEF §2 is day/week; month adds glanceability later. |
| **Multi-session blocks / split** (`time_blocks` table) | post-alpha | The v1 lens model deliberately avoids the second table until sessions demand it. |
| **Day-fullness signal** | reconsider post-alpha | Cut by Maciej: dishonest stats while much work is un-blocked. Revisit only with a credible capacity story. |
| **Single-occurrence exceptions on native repeats** | v2 | v1 edits the series, says so plainly. |
| **Booking links / Open-invites** | fast-follow after v2 | Research §1; the old `slot_bookings` plumbing stays untouched until then. |
| **Apple/iCloud (CalDAV), ICS feeds** | with v2 sync round | Engine slot exists; Apple flow was never implemented. |

Anti-goals (permanent, from BRIEF §2 + research §5): no opaque auto-scheduling, no meeting-scheduling NLP assistant, no rebuilt provider meeting stack (RSVP/timezone matrices), no red walls, no guilt.

---

## 12. Module contract (DoD) — spine, MCP, widget

- **Intent ops:** task-side loop actions ride the shipped Tasks ops (`set_status`, `reschedule`, `unschedule` + the time-accrual path). New `calendar_op_*` ops cover native events (create/update/set_times/delete) + the account/mirror writes — each: guard → invariants → write → `entities` upsert → `module_activity` (module `calendar`, entity types `event`) → return row. Exact op list in `specs/calendar.md`.
- **Activity:** event Detail renders the trail (quiet, newest-first). Task blocks show the task's own trail (existing panel). Loop actions attribute honestly: a roll-forward writes per-task `tasks.reschedule` activity (payload notes `origin: 'calendar-roll-forward'`).
- **Links/@mentions/tags:** events register in `entities` (label/icon), so `@`-mention, `/ref`, tag chips, and the EntityHub work on events for free; drag-to-link accepts events per the CT-3 matrix.
- **MCP tools:** reads `calendar_list_events` (range query, both kinds), `calendar_day` (the composed day: events + scheduled tasks + strip). Writes `calendar_create_event`, `calendar_update_event`, `calendar_delete_event`, `calendar_schedule_task`, `calendar_move_block`, `calendar_complete_block`, `calendar_roll_forward`. Registered app-side (`ops-manifest.ts` → `module-registry.ts`) + connector-side (`moduo-mcp/modules/calendar.ts`).
- **Dashboard "Today" widget:** a vertical mini-timeline of today (next 3–4 chips with now-line), the strip count with an inline **Move to today**, and next-up emphasis; rows deep-link via `moduo:entity:open`; add to the widget type/valid-set/grid/palette per the established pattern. Quiet by construction.

## 13. Design-system notes

Tokens only (R1–R3): event colors come from a token-routed calendar-color swatch set (stored raw hex only in `calendar_accounts.color`/prefs, mapped to a bounded palette rendered via CSS vars — same posture as tag colors); all chrome uses semantic tokens. Controls sit on the standard rungs; the grid's hour rhythm derives from density tokens so the density axis keeps working. Motion through motion tokens only (`prefers-reduced-motion` holds: the now-line doesn't animate, drag ghosts snap). Chips: `rounded-md`; popovers `bg-popover`; the strip is `text-muted-foreground` on `bg-background` — no card, no border shout. Icon-only buttons all get tooltips. New primitives (if any) get Storybook stories. The pink AI disc appears nowhere here.
