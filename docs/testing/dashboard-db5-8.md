# Manual test checklist — Dashboard rebuild DB-5…DB-8 (registry, widgets, gallery, config)

> Generated 2026-07-09 · branch `t/maciej/db-5-registry-widgets` · **Live-verified:** partial (most flows confirmed on the hosted account; the drag gesture, desktop-only widgets, and reduced-motion are the human pass).
> Run top-to-bottom on **Home (`/`)**. Each item is a step → what you should see → where.

## Widgets render real data (DB-5)
- [ ] **Do:** Open Home → **Expect:** the default 4 widgets render — **Tasks** (today/queue with check circles), **Today** (calendar strip + "Move to today"), **Quick capture**, **Clock** (live time). _(both — live-verified web)_
- [ ] **Do:** Add each module widget (see Gallery below) → **Expect:** **Recently linked** shows real spine edges, **Activity / Needs attention / Reconnect / Notes** show data or a calm empty state. Nothing walls. _(both — live-verified web)_
- [ ] **Do:** Click a widget **header title** (e.g. Tasks, Today, Needs attention) → **Expect:** navigates to that module (`/tasks`, `/calendar`, `/contacts`). Click a **row** → opens that specific entity. _(both — live-verified)_
- [ ] **Do:** Tasks widget → click a task's check circle → **Expect:** it completes + disappears; a "view"-permission member sees the checkbox disabled. _(both)_
- [ ] **Do:** Settings → density → **Dense** → **Expect:** widgets show more rows in the same cells; the 8×4 geometry never changes. _(both — live-verified: Tasks 3→5, Recently-linked 3→6)_
- [ ] **Do:** On **web**, add an Email or Time-tracking widget → **Expect:** "Available on the desktop app." placeholder; on desktop they render real data. _(both — web live-verified)_

## DB-6 utility widgets
- [ ] **Do:** Add **Clock** → **Expect:** live local time + date (S), or local + extra timezones (M). _(both — live-verified)_
- [ ] **Do:** Add **Pomodoro** → Start → **Expect:** counts down (25:00→…), Start becomes Pause; Reset/Skip work. _(both — live-verified ticked to 24:58)_
- [ ] **Do:** Add **Countdown** → set a title + a future date → **Expect:** a live countdown; reload → it persists. _(both — persists via config; date flow is the human pass)_
- [ ] **Do:** Add **Weather** → search a city → pick → **Expect:** current temp + conditions + city; reload → persists. _(both — live-verified: "34° London", config persisted)_
- [ ] **Do:** **Quick capture** → type a task + Enter → **Expect:** a toast "Added to Inbox" + it appears in Tasks; a rapid double-Enter creates **exactly one** task. _(both — live-verified single-task)_
- [ ] **Do:** Add **Pinned** → "Pin something" → pick any entity → **Expect:** it shows with its icon + label; clicking opens its module. _(both — human pass; MentionPicker path)_

## DB-7 Habits (migration applied to prod 2026-07-09)
- [ ] **Do:** Add **Habits** → "New habit" → name it → **Expect:** the habit row appears with a check circle. _(both)_
- [ ] **Do:** Tick a habit's circle → **Expect:** it fills (accent), a streak count appears; reload → the tick persists. _(both)_
- [ ] **Do:** Rapidly double-tap the same habit's circle → **Expect:** it ends checked-or-unchecked matching the last tap (no flicker-to-wrong-state); no console errors. _(both — the serialized-flush fix)_
- [ ] **Do:** Resize a Habits widget to **L** → **Expect:** each habit shows a 7-day dot grid. _(both)_
- [ ] **Do:** Remove a habit (hover ✕) → **Expect:** "Removed …" toast with **Undo**; Undo restores it with its checks. _(both)_
- [ ] **Do:** Add two Habits widgets → tick in one → **Expect:** the other reflects it (shared `habits` table). _(both)_

## DB-8 Add-widget gallery (AC9)
- [ ] **Do:** Enter edit mode (Pencil / right-click / long-press) → **Expect:** an **"Add widget" (+)** control appears in the bottom bar next to Done. _(both — live-verified)_
- [ ] **Do:** Click Add → **Expect:** a gallery dialog of the available widget types (email/time-tracking hidden on web), each with a size picker + Add. _(both — live-verified: 14 types on web)_
- [ ] **Do:** Pick a size + Add on a page with free space → **Expect:** the widget drops into the first free slot; the dialog closes. _(both)_
- [ ] **Do:** Add on a **full** page (the default 4 widgets fill the whole 8×4) → **Expect:** the card says "This page is full" + offers "Add to a new page"; clicking it creates a new page with the widget and jumps there. _(both — live-verified)_

## DB-8 Widget config popover (AC10)
- [ ] **Do:** Hover a **Clock / Pomodoro / Tasks** widget (or enter edit mode) → click the **⋯** → **Expect:** a config popover anchored to the widget. _(both — live-verified Clock)_
- [ ] **Do:** Clock config → toggle a timezone → **Expect:** it persists (`config.timezones`); at M size the Clock shows the extra zone. _(both — live-verified persist)_
- [ ] **Do:** Pomodoro config → change Focus/Break minutes → **Expect:** the timer uses the new durations. _(both)_
- [ ] **Do:** Tasks config → select a project → **Expect:** the Tasks widget shows only that project's tasks (empty selection = all). _(both)_

## Accessibility / motion (AC12)
- [ ] **Do:** Tab through Home → **Expect:** page dots, Edit/Add/Done, the ⋯ config, and gallery controls are all keyboard-reachable with a visible focus ring; Escape closes the gallery + config popover. _(both — human pass)_
- [ ] **Do:** Enable **Reduce motion** (OS) → **Expect:** page slides, FLIP glides, edit transitions, and the config/hover fades collapse to instant/opacity. _(both — human pass)_

## Migrations / data
- [ ] **Do:** Confirm the `habits` table is live (Supabase) → **Expect:** applied 2026-07-09 (9 cols, RLS `user_id = auth.uid()`, owner-only). A pre-deploy client degrades to an empty Habits widget. _(applied to prod)_

## Known gaps / not-yet-testable
- **The drag gesture** (rearrange, drag-out-of-gallery) is a human pass — dnd/pointer drags are unsimulable in a worktree (recorded gotcha). The engine half (resize/remove/add/compact) is verified.
- **Desktop-only widgets** (Email inbox, Time tracking real data) verify on the desktop build only; on web they show the capability placeholder.
- **Storybook** render is blocked in worktrees, so the `widgets` / `gallery-dialog` / `widget-frame` stories are compile-verified but their visual baselines are a deliberate human capture.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
