> Raw research report from the Calendar re-plan, 2026-10-10 (branch t/maciej/calendar-replan). Nothing here is decided.

# Visual audit of Calendar (north-star check against Tasks v3)

**How this was measured.** The live web app ran from this worktree on its own port, against the local Supabase stack. Playwright with headless Chromium 1228 drove it at 1440×900 and 1024×700 (both at 2× pixels), in dark mode (the shipped default: shade black, accent mono). Density was switched between comfortable, compact and dense through the root attribute. Spot checks used the blue and amber accents and light mode. Clock: Europe/Warsaw, 12-hour locale, "now" around 8:40 PM on Saturday 10 October.

Contrast follows the Tasks audit's method: WCAG 2.x, colours resolved by the browser to sRGB, opacity composited onto the real background. The background-only ratios (wash, drop target, hour lines) come from screenshot pixels. Sizes are measured computed styles in px at comfortable density unless a line says "code". The scripts and screenshots live in the session scratchpad and are not in the repo.

**Data.** The workspace I tried to create through the UI ("Calendar replan research — visual") was blocked by the plan gate: the app sent me to the pricing page and created nothing. I measured in **"Calendar replan research"**, which another research lane had seeded a minute earlier. It holds:
- a weekday recurring standup;
- an overlap cluster of four events;
- an all-day event and one that crosses midnight;
- a teammate's private event (shown as "Busy");
- three events mirrored from an "Outlook-shaped" seed account;
- open, done and elapsed task blocks, due-only tasks and one booking link.

Everything I did there was read-only:
- popovers were opened and dismissed;
- quick-create was discarded with Esc, empty;
- drags were cancelled before the drop;
- I checked afterwards that no event had been added.

**Static only (code, not rendered):**
- the CalDAV and ICS connect dialogs (desktop-only on the web);
- the Google and CalDAV account groups in the rail;
- the focus-running chip (I didn't start focus, so no time was written to the other lane's tasks);
- the public `/book` page beyond its error state (the `booking-public` function returns 503 on the local stack).

## 0. What's strong (keep)

- **The grid follows density.** The hour row is `--cal-hour-h` 56 / 48 / 44 px (`tokens.css:498, 515, 532`). Geometry runs in real minutes, so DST days draw right (`calendar-grid.tsx:1–7`).
- **Account colours go through the tag hue tokens** (`data-label` → `.cal-swatch` / `.cal-chip-external`, `global.css:206–219`), never raw provider hex.
- **The toolbar sits on one control rung.** Previous/next `IconButton`, Today, and the Day/Week `SegmentedControl sm` are all 26 px, inside the `Toolbar` primitive (`calendar-toolbar.tsx:43–73`).
- **The core text is readable.** Chip titles are 12 px at 15–19:1. Hour labels, day names and eyebrows are 11–13 px at 7.99:1.
- **Quiet states.** Elapsed blocks get a dashed outline, done blocks a check and a strikethrough. Nothing is red on the grid, and nothing pulses except the loading shimmer.
- **Two places already follow the ratified grammar** (`src/lib/time-format.ts`), and their titles wrap instead of truncating (`calendar-tasks-panel.tsx:172–194`):
  - the review rows: "Yesterday · 2:00 PM · 30m", "Today · 9:00 AM · 1h";
  - the right-panel rows: "Today", "Tue", "1h".
- **The 48b layout holds.**
  - The right panel switches views in its own title row ("Detail ⌥1 · Notes ⌥2 · Tasks ⌥3").
  - The panel toggles sit in the bottom bar.
  - No rails or extra columns, no rotated text, no blur, no pink, no AI badge.
- **The strip** is one quiet line that only appears when it has something to say (`calendar-strip.tsx:18–43`).
- **Booking is the one Calendar surface on the DS-2 recipes.** The booking dialog and public page use `SELECTED_OPTION` and `hairline`.

## 1. Issues that would spread if copied

| # | Issue | Evidence | Measurement | Kind |
| --- | --- | --- | --- | --- |
| 1 | **None of the shared interaction layer is used; hover has 8 recipes.** | `state-hover` 0 uses, `state-active` 0, `SELECTED_ROW` 0, `DROP_TARGET` 0, `DRAG_SOURCE` 0, `DragOverlaySurface` 0; `border-border` 25 vs `hairline` 1. Hovers: task chip opaque `bg-muted` (`task-block-chip.tsx:91`) · Moduo event tint /10→/15 (`event-chip.tsx:47`) · external `filter: brightness(1.12)` (`global.css:217`) · panel and rail rows `bg-accent/60` (`calendar-tasks-panel.tsx:259`, `calendar-rail.tsx:100`) · widget `bg-accent` (`calendar-today-widget.tsx:142`) · booking chips and day cards by **border** (`sentence-ui.tsx:215, 292`, `book-page.tsx:610`) · sentence blanks `bg-accent` (`sentence-ui.tsx:117`) · triage buttons by text colour | Task-chip hover goes from a translucent rest to an opaque fill; Tasks rows use a 5 % fill | Rule (39) |
| 2 | **The drop target is invisible, and there are three drag previews.** | Day column drop = `bg-accent/20` (`calendar-grid.tsx:861`). Previews: the dnd overlay (`calendar-page-view.tsx:1101`, `w-44 bg-muted`, title cut to "Shared: unscheduled backl…"); the grid ghost `bg-primary/15 border-primary/50` (`calendar-grid.tsx:998`); the quick-create ghost, same recipe (`event-quick-create.tsx:141`). The source chip isn't dimmed during a grid drag. | Drop column vs its neighbour: **1.01:1** (pixels 14 vs 12) | Rule (39) |
| 3 | **Selection looks like focus, and the grid can't be reached by keyboard.** | An event's selection is the full-strength 2 px focus ring (`event-chip.tsx:49`). Task blocks have no selected state at all. The mini-month marks its selection with a filled accent. The all-day chip is a bare `<button>` (`calendar-grid.tsx:637`) that shows the **browser's default blue outline**. | **0 of 13** timed event chips can take focus (no tabindex or role); the only focusable event is the all-day chip | Rule (39) + fix |
| 4 | **Two date formatters and about nine formats for one instant.** | Module-local `ui/time-format.ts` (`formatTimeOfDay` 19 uses, `formatDayLabel` 6) vs the ratified `lib/time-format.ts` (used only in the panel) | The same Sunday 10:00 block reads "Sun, Oct 11 · 10:00 AM – 10:45 AM · 45m" in the popover, "Tomorrow, 10:00 AM" in Detail and "Tomorrow · 10:00 AM" in review rows. More: "60m" (`task-popover.tsx:81`) · "10/11/2026, 3:00:00 PM" (`event-detail-panel.tsx:184, 201`, `toLocaleString`) · a native "10/10/2026, 13:00" · native "15:00" beside its own hint "3:00 PM" (`event-quick-create.tsx:197–265`) · Home "8:45 PM" beside the Clock widget's "20:52" · booking "15 min / 60 min", "09:00 to 17:00" · "synced 3 min ago" · activity "8 minutes ago" · "every weekday" (lowercase rrule text) next to "Doesn't repeat" · Day toolbar "Saturday, October 10" | Rule (41) |
| 5 | **Times and titles truncate on every chip.** | `truncate` on the title and time (`event-chip.tsx:54, 60`, `task-block-chip.tsx:113, 127`) | At 1440 the week columns are **106 px**, so every timed chip's time range is cut ("10:00 AM – 10:45 AM" needs about 105 px and gets 87.7). Visible title width: 3-up overlap chips **17.9 px** ("R…"); a 2-up elapsed block **13.3 px**. The triage row clips **"Remove"** (the button ends at x 944, the chip at x 898). At 1024 visible titles are **8–34 px** (1–4 letters). | Rule (41, 42) |
| 6 | **Overlaps cap at three columns, and "+N" is a dead end.** | `MAX_VISIBLE_COLUMNS = 3` whatever the width (`grid-layout.ts:103`). "+N" is a `div` with a native `title` tooltip only (`calendar-grid.tsx:983–991`); the code comment promises a list that never arrived. | The Day view (a 740 px column) still hides the 4th event behind "+1". The pill is 20.5 × 18.5 px and can't be clicked. In "My workspace" ten tasks at one time show as 3 slivers with only checkboxes and "+7". | Rule (42) + fix |
| 7 | **Faded steps below readable contrast.** | `opacity-60` on past events (`event-chip.tsx:48`); `opacity-60` plus muted text plus strike on done blocks (`task-block-chip.tsx:92, 114`); `/70` day numbers (`calendar-grid.tsx:615`); `/50` outside-month days. Steps in use: `/70` ×3, `/60`, `/50` ×2, `/40`, `/30`, `/20`, plus opacity 30/40/50/60/70. | Past-event time **3.2:1**, done title **3.46:1**, day number **4.37:1**, outside-month day **2.73:1** | Rule (38) |
| 8 | **The background marks are invisible, and "today" has two languages.** | Off-hours wash `bg-muted/40` (`calendar-grid.tsx:868`). Weekends get no treatment at all. Today's header changes only weight (500 white vs 400 muted), while the Tasks Timeline uses a Today pill. | Wash **1.02:1** dark, 1.04:1 light. Hour lines 1.16:1 dark, 1.3:1 light. | Rule (46) + fix |
| 9 | **The accent budget breaks.** Every Moduo event is accent-coloured. | `border-primary/35 bg-primary/10` on every Moduo event (`event-chip.tsx:47`) | On the blue accent one week screen carries **about 17 accent marks**: 9 events, 3 checkboxes, the Moduo dot, the mini-month day, the done check, the now-line. The seeded external account was auto-given the "blue" label hue, so its events look the same as Moduo's. | Rule (46) |
| 10 | **Native inputs inside token UI (11 sites).** | `datetime-local` ×2 (`event-detail-panel.tsx:173, 191`) · `time` ×4 (`event-quick-create.tsx:197, 206`, `booking-link-dialog.tsx:514, 528`) · `number` (`booking-link-dialog.tsx:287`) · a raw checkbox rendered as a browser-white box (`calendar-tasks-panel.tsx:183`) · a bare `<input>` in the ghost (`event-quick-create.tsx:143`) | The native time and date fields draw 24-hour clocks and the browser's own icons in a 12-hour app | Fix list |
| 11 | **Two property-panel languages.** | Event Detail stacks 11 px uppercase `Field` labels over the values ("STARTS / ENDS / ALL DAY / REPEATS / NOTES", `event-detail-panel.tsx:170–227`). Task Detail uses `PropertyRow` (96 px sentence-case label). Read-only external events show a disabled-looking Switch and Repeat button, against the file's own comment (`event-popover.tsx:4–5`). | Three headers stack above one event ("Detail ▾", "EVENT", ×) | Rule (kit) |
| 12 | **Caps on grouping headers; a third count language.** | "QUEUE (46)", "DUE SOON (2)", "BACKLOG (1)", "UNFINISHED FROM EARLIER (5)" (`calendar-tasks-panel.tsx:113, 218`). CalDAV group headers would put a username or server through the uppercase `Eyebrow` (`calendar-rail.tsx:225`, `accounts.ts:127`). | Tasks uses sentence case and a plain tabular count | Rule (40, 45) |
| 13 | **About nine chip languages** and no shared Chip. | Event chip · task block · all-day button · "+N" pill · grid ghost · dnd overlay · booking Length buttons as outline/secondary `Button`s (`booking-link-dialog.tsx:261–283`) · the public page's `Chip` (rounded-full, 40 px, `sentence-ui.tsx:203`) · day-strip cards | — | Rule (45) |
| 14 | **Density only changes the hour height.** | Chip text is a fixed 12/11 px, the toggle 16 px, the chip floor `1.375rem` (`calendar-grid.tsx:906`). Popovers are a fixed `w-64` / `w-72`. Mini-month cells are a fixed 32 px. Rail inputs are 32 px (`--ctrl-h`) next to 26 px buttons. | 30-minute chip 28 / 24 / **22** px, 15-minute chip 22 / 22 / 22 px: in dense a 15-minute and a 30-minute block look identical | Rule (44) |
| 15 | **Hand-rolled controls, no primitives.** | 12 raw `<button>`s: `booking-links.tsx:467`, `task-block-chip.tsx:146`, `booking-link-dialog.tsx:205`, `calendar-grid.tsx:637`, `calendar-rail.tsx:120`, `sentence-ui.tsx:105, 206, 283`, `book-page.tsx:599, 666`, `calendar-today-widget.tsx:116, 139`. Rail account rows are hand-rolled (28 px) instead of `NavRow`; panel rows are hand-rolled instead of the Row. `EmptyState` 0, `Kbd` 0, `PropertyRow` 0, `MetaCount` 0, three hand-rolled empty lines. | Hit targets: CompleteToggle **16 px** (chip, panel, popover); triage buttons **16.5 px** tall; chip resize band 6 px top and bottom, so a 22 px chip has 10 px left to grab for a move | Fix list |
| 16 | **Red and four ways to delete.** | 12 `text-destructive` or destructive sites in Calendar: popover Delete (`event-popover.tsx:75`), "Delete event" (`event-detail-panel.tsx:290`), the delete dialog (`calendar-page-view.tsx:1196`), booking delete and error (`booking-link-dialog.tsx:694, 718, 726`), connect errors ×3 (`calendar-connect-dialog.tsx:246, 272, 397`), the rail Remove item (`calendar-rail.tsx:174`), the public page error, the cancel page. Settings shows red "Disconnect"/"Remove" ×4. Delete styles: an event asks in a modal; a booking link asks in an inline row; **"Remove account" in the rail runs at once with no confirmation and no Undo** (`calendar-page-view.tsx:242–272`); Tasks deletes at once with an Undo toast. | — | Rule + fix |

Checked and ruled out: rotated text (none), `backdrop-filter`/blur (none), pink or an AI colour (none), raw hex (none).

## 2. Per-surface notes

**Week / Day grid** (`calendar-grid.tsx`)
- **Gutter.** `GUTTER_W = 3.25rem` (52 px) is set inline (`calendar-grid.tsx:46`). Labels are 11 px muted at 7.99:1 and read "9 AM", "12 PM".
- **Hour lines.** `border-border`, 1.16:1.
- **Day headers.** 13 px: name 7.99:1, number `/70` at 4.37:1. Today is white 500 only, with no today mark.
- **All-day lane.**
  - Labelled "all-day" in lowercase, while chips and popovers say "All day".
  - Chips are 26 px `<button>`s around `EventChipView`.
  - At 1440 a chip shows "Research: offs…".
- **Now line.** `h-px bg-primary` with a 6 px dot, only on today's column. Fine. On mono it is white, so it competes with the white selection ring.
- **Raw values.**
  - Z-indices `z-[1]` to `z-[5]`, 7 sites (`calendar-grid.tsx:903–1063`), instead of `--z-*`.
  - The minimum chip height `1.375rem` and ghost height `1.125rem` are set inline.
  - The scroller uses the `scrollbar-thin` alias, not `pane-scroll` (`calendar-grid.tsx:671`).
- **Loading and empty.** The shimmer is `animate-pulse` (`calendar-grid.tsx:1037, 1042`). The empty hint is a hand-rolled 12 px line, "Nothing scheduled — draw a block or schedule a task." (`calendar-grid.tsx:1063`).
- **Day view.** The column is 740 px, but the cluster cap still allows only 3 events side by side. The compact threshold is in minutes (`COMPACT_BELOW_MINUTES = 40`), so a wide 30-minute chip still crams into one line.
- **Weekend columns.** Identical to weekdays. The `showWeekends` pref exists (`prefs.ts:129`), but the rail has no switch for it.

**Event chips** (`event-chip.tsx`)
- Recipe: `rounded-md border px-1.5 py-0.5`, title 12/400, time 11 px muted.
- Moduo events: accent tint plus accent border.
- External events: the account hue at 18 % plus a hue border (`.cal-chip-external`).
- Recurring events: a 12 px Repeat glyph, but only when the chip is tall enough to show it.
- The tooltip is the native `title` attribute (`event-chip.tsx:43`), not the Tooltip primitive. The same holds at 9 sites in Calendar.
- A teammate's private event renders "Busy" in grey `lab(65 / 0.16)`, but its popover calls it "External calendar · read-only". It isn't external: it is the teammate's Moduo calendar.

**Task-block chips** (`task-block-chip.tsx`)
- **Open:** `bg-muted/60 border-border`, with a 16 px CompleteToggle.
- **Done:** 60 % opacity, strikethrough, title at 3.46:1.
- **Worked** (took longer): 70 % opacity plus a clock glyph and "Worked · 9:00 AM – 10:00 AM".
- **Elapsed:** dashed border with `bg-muted/30`; the inline triage row (Later · Longer · Remove, 11 px) appears only when the block is at least 55 minutes tall.
- **Focusing:** a 2 px accent bar at the left edge plus an accent readout (code only).
- **Two vocabularies for one action:** the chip says "Later · Longer · Remove", the popover says "Later today · Took longer · Remove".

**The strip.**
- "· 5 unfinished from earlier", 13 px muted at 7.99:1, has a leading middot.
- Its actions, "Move to today" and "Review", are ghost 26 px buttons at 14/500 in white (19:1): louder than the sentence they belong to.
- Home's version of the strip has no middot and a 12 px underline link instead of buttons.

**Popovers** (`chip-popover.tsx`, `event-popover.tsx`, `task-popover.tsx`, `event-quick-create.tsx`, `repeat-picker.tsx`)
- **Event and task popovers.**
  - `w-64 p-3`, title 13/500 in the display face (R4 files titles under body).
  - The title truncates even though the popover has room to wrap it.
  - "Open" uses the `ExternalLink` icon but opens the right panel.
  - Delete is red.
- **Quick-create** (`w-72 p-3`).
  - The time fields are native `<input type="time">` at an inline 26 px, drawing "15:00 ⏱".
  - The Calendar Select is a full-height 32 px default control that is disabled whenever only Moduo is available, so it renders as a dead grey field.
  - Repeat is an outline 26 px button.
  - Hint line: "3:00 PM – 3:30 PM · Enter saves · Esc discards".
- **Repeat picker.**
  - Presets plus "Custom…" with a natural-language echo. The helper copy reads "Plain English — the echo below is what saves."
  - Summaries come from `RRule.toText()` in lowercase ("every weekday").

**Right panel** (`calendar-tasks-panel.tsx`, `event-detail-panel.tsx`, the reused `TaskDetailPanel`)
- **Width.** Fixed 280 px at both window sizes.
- **Tasks view.**
  - The search is hand-rolled (icon plus `Input` at an inline 26 px).
  - Group eyebrows carry "(N)" counts.
  - Rows are about 41 px (titles wrap), 13 px titles (Tasks rows are 15 px), `hover:bg-accent/60`.
  - A grip appears on hover at `/60` (Tasks removed grips from rows and cards).
  - Empty line: "Nothing to schedule — capture a task or enjoy the calm." with an outline Capture button.
- **Review.**
  - A card `rounded-lg border-border bg-card/40` (another surface recipe).
  - Native checkboxes, "Move 5 to today" as a secondary button, × per row.
- **Task Detail at 280 px.**
  - The title is clipped ("Research: plan next", "week" missing).
  - Property values wrap onto two lines ("Tomorrow, / 10:00 AM", "0m of / ~45m").
  - The assignee shows a "?" avatar for "Me", and the activity avatar reads "ME" (rule 43).
- **Event Detail.**
  - The `Field` stack described in issue 11.
  - Activity renders the raw op key **"You calendar.event_create"** (`spineActivityLine` has no wording for calendar ops) with "8 minutes ago".
  - The external source line reads "Research seed (Outlook-shaped) — microsoft · synced 8 minutes ago · managed in its source calendar": a raw lowercase provider, then three clauses.
  - An empty note shows "—".
- **The × "Close details"** switches the panel back to Tasks, so it duplicates the switcher.

**Left rail** (`calendar-rail.tsx`, `calendars-panel.tsx`, `booking-links.tsx`)
- **The mini-month's month arrows fly to the window edges.**
  - At 1440, "Go to the previous month" sits at x = 4 and "Go to the next month" at **x = 1408, over the right panel**. At 1024 the next arrow sits at x = 992.
  - Cause: the `Calendar` primitive's nav bug that the Tasks audit found (react-day-picker's `absolute left-1/right-1` resolves against the page).
  - Both arrows sit beside the panel area and read like panel toggles.
- **Mini-month details.**
  - Cells are 32 px.
  - The selected day is a filled accent square; on mono that is white with a 17.8:1 number.
  - The busy marker is a 4 px `/50` dot built from 9 arbitrary `[&>button]:after:*` utilities (`calendar-rail.tsx:51–55`).
- **Two "CALENDARS" eyebrows stack in one rail** (`calendar-rail.tsx:204` and `calendars-panel.tsx:151`):
  - the first is the account visibility list (dot, name, eye, ⋯ in 28 px rows);
  - the second is the "Calendars" share and sets list. It has 16 px checkboxes, Share ghost buttons, and two **permanent text inputs** ("New calendar" + Add, "Save this set" + Save) at 32 px.
  - Every member calendar's checkbox has the same aria-label, "Include Moduo in a set".
- **Moduo's own dot** is `bg-primary`, an accent mark used just to identify a calendar.
- **Sync errors.**
  - The error label is `text-warning`, 11 px.
  - "Reconnect" is a hand-rolled underline-link button.
- **Booking links.**
  - Each link's name is a raw `<button>`, with a "Copy" ghost button beside it.
  - Copy stays disabled with no reason given when Google isn't connected.

**Toolbar** (`calendar-toolbar.tsx`)
- Previous/next, Today (**outline**; the Tasks toolbar grammar uses ghost buttons except for one primary), then the range label in 13/500 display (Tasks h1: 18 px).
- On the right: "synced N min ago" (11 px), refresh (spins with `animate-spin`), and Day | Week.
- No title, no count, no Search, Filter or Display, no primary New.

**Bottom bar.**
- Only the global Search, Quick capture and New, plus the two panel toggles (32 px).
- It carries no Calendar tools: Day/Week, Today and the range stay in the centre toolbar.

**Settings → Integrations** (`integrations-section.tsx`)
- **Three nested card levels:**
  - the section card `rounded-lg bg-card p-6` (`:322`);
  - the provider card `rounded-md bg-muted/40 p-4` (`:336`);
  - the account card `rounded-md bg-card px-3 py-2` (`:379`).
- Hand-sized icon tiles: `h-8 w-8`, `size-4`.
- Buttons: "Connect account" is outline, "Desktop only" is a disabled outline, "Disconnect" is red.
- The account card carries an eyebrow ("OUTLOOK CALENDAR") above the account name.
- **Connect dialogs** (code only: desktop-only on the web):
  - CalDAV presets, username and password fields, and a calendar picker list using `hover:bg-accent`;
  - errors in 12 px red;
  - a `scrollbar-thin` list.

**Booking-link dialog** (`booking-link-dialog.tsx`)
- **Frame.** `w-[min(52rem,…)] max-h-[85vh]`, two columns, the right one `bg-muted/30`.
- **Event section.** Eyebrow sections, then:
  - Length: "15 min / 30 min / 45 min / 60 min / Other" as outline/secondary Buttons;
  - Video: radio cards using `SELECTED_OPTION`.
- **Weekly hours.**
  - Listed **Sunday first**, while the mini-month and prefs start on Monday (`weekStartsOn: 1`, `slots.ts:5`).
  - Each day has a Switch and native `09:00`–`17:00` time fields at `w-[7.25rem]`.
- **Limits.** Selects reading "2 weeks", "4 hours", "None".
- **Footer.** A red "Delete" opens an inline confirm. The error line is red.

**Public `/book` page** (`book-page.tsx`, `booking/sentence-ui.tsx`)
- **Rendered: only the error state.**
  - 48 px light (300) heading at 20:1.
  - 15 px muted body at 8.4:1.
  - A 40 px "Try again" button.
  - Footer: "Scheduled with Moduo".
- **From code:**
  - The sentence voice (48/300, tracking-tight) is a typographic register used nowhere else in the app.
  - The public page has its own `Chip` (40 px pill, border hover).
  - The day strip uses cards with an eyebrow weekday and a 2 px bar sized inline.
  - Blanks hover with `bg-accent` and focus with a full-strength ring.
  - The motion is tw-animate (`animate-in fade-in-0 duration-[var(--motion-slow)]`, `book-page.tsx:309, 839`).
  - The guest form puts its label column at an arbitrary width (`sm:grid-cols-[6rem_…]`).
  - Errors are red.
  - Responsive breakpoints exist here, which is right for a public page.

**Home Today widget** (`calendar-today-widget.tsx`)
- **Rows.** `min-h-[var(--row-h)]` (an arbitrary-value wrapper), 11 px time in a `w-14` column plus a 13 px title, `hover:bg-accent`, and a full-strength focus ring.
- **First row.** Medium weight plus an arrow.
- **Strip.** "5 unfinished from earlier" with a 12 px underline link "Move to today".
- **Loading.** A 24 px `animate-pulse` icon.
- **Clock clash.** On the same Home screen the Clock widget reads "20:52 · Sat, Oct 10": 24-hour time next to the Today widget's 12-hour "8:45 PM".

**Found along the way, not visual** (for the current-state lane):
- **Quick-create can't be used by mouse.** A pointer-down on any control in its popover bubbles through the React portal to the day column (`calendar-grid.tsx:863`; the check at `:427` looks for `[data-chip]` in the DOM, which the portal isn't in), which restarts draw-to-create.
  - Clicking "All day" moved the ghost from 11:15 AM to 1:00 PM, and the switch stayed off.
  - Clicking "Doesn't repeat" re-anchored the ghost at 3:00 PM, and no menu opened.
- **Quick-create can't be used by keyboard either.** Tab from the title goes to the grid's triage buttons rather than into the popover, and the popover closes.
- So **repeat, all-day and times can't be set from quick-create at all.**

**Contrast and size reference** (dark, comfortable, measured)

| Text | Size / weight | Ratio |
| --- | --- | --- |
| Chip title | 12 / 400 | 15.4–19.1 (6.3–6.4 on past events) |
| Chip time | 11 / 400 muted | 6.5–7.7 (**3.2** on past events) |
| Done block title | 12, muted, strikethrough, 60 % | **3.46** |
| Day name / day number / today | 13 | 7.99 / **4.37** / 19.1 |
| Hour label, sync label, eyebrows | 11 | 7.97–7.99 |
| Mini-month outside-month day | 13 at `/50` | **2.73** |
| Strip sentence / strip buttons | 13 / 14·500 | 7.99 / 19.1 |
| Triage buttons, "+N" | 11 | 7.88, 7.52 |
| Disabled Add / Save in the rail | 14 · 500 | 5.15 |
| Off-hours wash, drop target, hour line | non-text | **1.02, 1.01, 1.16** |

## 3. The 1024×700 verdict

**Measured.**
- **Pane widths.** At 1024 the rail is 240 px, the centre **440 px** and the right panel 280 px. At 1440 they are 270 / 826 / 280. The right panel never shrinks: at 1024 it takes 28 % of the width.
- **Week view columns: 51 px each.**
  - Titles show 8–34 px of text: "R.", "S.", "Mirr…".
  - The overlap cluster turns into blank slivers.
  - Times are gone entirely.
- **Day view.** Its column is 354 px, which is usable.
- **Visible hours.** The grid shows **7.3 hours** at comfortable density, 9.0 at compact and 10.0 at dense; at 1440 it shows 11.3.
- **Toolbar.**
  - "Oct 5 – Oct 11" wraps onto 2 lines (37 px tall).
  - "synced 3 min ago" wraps onto **3 lines** (50 px).
  - The strip's two buttons crowd its sentence.
- **Mini-month.** The next-month arrow sits at x = 992, over the right panel's edge.

**Verdict.**
- **What breaks:** the Week view, not the layout. Even at 1440 a week column is 106 px and truncates every time label, so 1024 only makes a standing problem total.
- **What should give way first: the right panel.** It is context, not the surface (48b), and its toggle already lives in the bottom bar. Starting it closed below about 1200 px gives the centre about 720 px.
- **That alone isn't enough.** Seven columns at about 94 px are still below the 1440 width that already truncates. So at this size the Week view also needs fewer columns: five weekdays when the weekend is empty or hidden, or a 3-day range. Or the module should open in Day view.
- **The rail gives way second.** Keep the mini-month and the calendar list, and move the two forms ("New calendar", "Save this set") and the booking links out of the always-open rail.
- **In the toolbar,** the sync label should drop first (into the refresh tooltip), before the range label wraps.
- Which of these to choose is a product call for the re-plan.

## 4. The fix list

**Quick wins (hours each, no API change)**
1. Use the shared recipes:
   - `DROP_TARGET` on day columns;
   - `DragOverlaySurface` for the panel-row drag;
   - `DRAG_SOURCE` on the chip being moved;
   - `state-hover` for every hover;
   - delete `filter: brightness` and `bg-accent/*`.
2. One selection recipe for chips (`SELECTED_OPTION`), with focus as `ring-ring/50` only on keyboard focus. Give the all-day chip and the timed chips a focusable role.
3. Retire `ui/time-format.ts` in favour of `lib/time-format.ts`:
   - popovers say "Today · 10:00 AM – 10:45 AM · 45m";
   - durations go through `formatDuration` ("1h", not "60m");
   - read-only Detail times use the same grammar;
   - the sync label becomes "Synced 3m ago";
   - activity uses the feed's time format;
   - rrule summaries start with a capital ("Every weekday").
4. Cap the faded steps: past events and done blocks use a row-level state that keeps the time and title readable (at least 4.5:1); day numbers go from `/70` to the tertiary step.
5. Panel and review group headers in sentence case with a plain count; the "Event" eyebrow comes off Event Detail.
6. Replace the raw checkbox with `Checkbox`; the native time and number fields with `Input`-based controls (and DateField for dates); the hand-rolled buttons with `Button`/`IconButton`; the empty lines with `EmptyState`.
7. `--z-*` in the grid; `pane-scroll` instead of `scrollbar-thin`; drop the inline `style` heights in favour of the control-height classes.
8. Fix the `Calendar` nav positioning (shared with Tasks).
9. Remove the second "CALENDARS" header; fix the "Include Moduo in a set" labels.
10. Activity wording for calendar ops; provider names spelled properly ("Outlook", not "microsoft").

**Structural (a block each)**
1. **Chip anatomy that survives narrow columns:**
   - title first, time second;
   - the time drops whole when it doesn't fit (never "10:00 AM –…");
   - a two-line title when tall enough;
   - the triage row as an overflow menu below 120 px;
   - overlap columns that scale with width instead of a fixed 3;
   - "+N" as a button that opens a list popover.
2. **An accent plan for events:**
   - Moduo events on a neutral surface, plus a hue only when the user picks one;
   - the accent kept for selection, today/now and the done check;
   - account hues chosen to avoid the current accent.
3. **One Detail anatomy:** Event Detail on `PropertyRow` + DateField, the same as Task Detail. Read-only rows as plain text, not disabled controls.
4. **The narrow-window rules from §3:** right panel closed by default, a 5- or 3-day week, the rail slimmed.
5. **Visible structure in the grid:**
   - an off-hours wash and a weekend treatment that read at least 1.15:1;
   - one today mark, shared with the Tasks Timeline.
6. **Density for the grid:** chip text, toggle, popover width and mini-month cells on the density tokens; a chip floor that keeps a 30-minute block taller than a 15-minute one at every density.
7. **One delete language:**
   - immediate with Undo where the data comes back;
   - one confirm style where it can't;
   - none of it red;
   - "Remove account" gets a confirm or an Undo.
8. **Quick-create rebuilt** so its controls work (stop the portal's pointer events reaching the column; trap focus), on the shared Chip and DateField.
9. **The booking surfaces:**
   - weekly hours in the user's week order with the app's clock format;
   - the Length choices on the shared Chip;
   - the public page's sentence voice decided as a deliberate exception or brought onto the scale.
