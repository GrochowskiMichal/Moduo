# Tasks — dogfood review & working list

> **2026-10-07 — now planned.** The build specs are [`specs/tasks-v2.md`](../../specs/tasks-v2.md), [`specs/design-state-layer.md`](../../specs/design-state-layer.md) and [`specs/attachments.md`](../../specs/attachments.md), with blocks in [`specs/BUILD_ORDER.md`](../../specs/BUILD_ORDER.md). If this review and a spec disagree, the spec wins.

_2026-10-06 · reviewed on `develop` @ `7716e31` (code-level read of `src/features/tasks/**`, the
Tasks spec, `.design/tasks-polish/DECISIONS.md`, the 2026-07 critique) + competitor research ·
not a live click-through · **status: thinking — nothing decided yet.**_

## TL;DR

1. **Tasks was designed as a solo ADHD planner and is now being used as a two-person team
   tracker.** Most of the friction comes from that gap. The biggest hidden case: **the Queue is
   shared by the whole workspace.** "Committed for today" is stored on the task, not per person,
   so anything Mike queues shows up in your Queue, your Focus card and your counts (T12).
2. **Focus stops counting in the background because it counts ticks, not time.** Each timer tick
   adds one second. macOS/WebKit slows or pauses timers when the window isn't in front, so those
   seconds are never added. Calendar's block timer already does this correctly with wall-clock
   time. The app has two separate focus timers that don't know about each other (T2, T16).
3. **"Multi-tasking" is probably three different requests, and one of them is a real bug.** The
   timer is tied to a single task. Finishing a task mid-pomodoro resets the session for the next
   one and turns the pomodoro off. Separating the *session* (the sitting) from the *task that gets
   the time* fixes this. It also makes switching between tasks, and an honest "something's
   running in the background", possible (T3).
4. **Focus is a destination, not a mode.** In Focus, nothing below the switch (All, Queue, Inbox,
   buckets) does anything. Recommendation: remove the switch. Start Focus from the Queue
   ("Start focus") and from any task ("Focus on this", `f`) (T6).
5. **Drag-and-drop feels broken because of what dragging does in a bucket list.** Dragging a task
   onto another one makes it a subtask. The list has no reorder and buckets can't be drop targets.
   The Board can reorder; the List can't (T1).

---

## Decisions & direction — 2026-10-07 (Maciej + Mike)

_This section overrides the item text below where they differ._

### Decided

- **Focus = running a lined-up queue in isolation, one task after another.** It is not
  single-task focus. Per-task `f` entries are **out**. The entry point lives with the Queue itself.
  The exact placement is still open (see T6 below).
- **T12 — per-person Queue: yes.**
- **T3 — the real case is agentic work.** An agent is working on task A while you start B, and
  you want to *see details of both* without switching by hand.
  - **Direction: a "Now + In flight" layout.**
    - **Now** = the task you're on: big card, clock, Done/Skip.
    - **In flight** = handed-off tasks (`w` / "Hand off"). Compact cards beside Now showing:
      - title;
      - an optional one-line "where I left off";
      - expandable details;
      - "in flight 12m".
    - **Pick up** swaps a card into Now. Focus time goes to Now; in-flight time is logged as
      waiting time.
  - **Later:** an agent could mark its task "ready for review" through the Moduo MCP connector and
    light up the in-flight card.
  - **Skip = move to the end of the queue** ("Do last"). "Not today" lives in the menu, and it's
    the only action that counts as a reschedule.
- **T10 — multiple assignees with one owner** (`task_assignees` + `is_owner`).
  - **Creator** shows in the detail panel metadata and is filterable, not on rows.
  - Completion is per task (done for everyone).
  - The Queue and tracked time are per person.
- **T1 — drag-to-nest stays.** One gesture with two drop modes:
  - pointer **left** of the subtask indent (~40 px into the row) = reorder, shown as an insertion
    line;
  - pointer **right** of it = make a subtask, shown as an indented preview.
- **T13 — completed tasks are hidden by default**, with a view option: Display → Completed: Hidden
  / Last 7 days / All, plus a quiet "N completed" link.
  - Checked tasks stay struck-through in place until you leave the view (undo + the check-off
    moment).
  - Archive = "won't do", separate from done.
- **DS:** `MetaCount` indicators, `AvatarStack` and a shared DnD vocabulary are approved in
  principle.

### Open

- **T6 — Focus placement.** Maciej wants to think the use case through first. The concept on the
  table:
  - start the run from the Queue (header button / shortcut / ▶ on the rail's Queue row);
  - while running, the rail and right panel are replaced by the run (Now · In flight · Up next ·
    Done);
  - Esc pauses back to Plan ("paused · 3/7");
  - the chrome chip follows you around the app.

  **Questions:**
  - Are buckets needed mid-run, or only capture?
  - Do you add tasks to a running queue, and from where?
  - When the queue empties: end summary, or the run stays open?
  - Do you leave Tasks mid-run?
  - Pomodoro per run or per task?
  - Should you see each other's runs?
- **T19 — midnight.** Recommendation: same rule as drift. Each day starts with a fresh Queue, plus
  one quiet line "N left from yesterday · Re-queue" that is gone by end of day and never
  accumulates. Alternative: the Queue is a *run* that persists until cleared.
- **T7 — count behaviour.** Swap (nothing moves; the count hides on hover) vs shift (count stays,
  the row reflows and long names re-truncate under the cursor). Build both in Storybook and decide
  by feel.
- **T28 — the app-wide reference grammar.** See below.

### T28 — One reference grammar for the whole app · High · M (cross-module)

**Today `#` means three things:**
- tag chips render as `#design`;
- channels render as `#general`;
- in the **chat composer**, `#` opens a picker that links a *task/note/contact*, not a channel
  (`chat/markup.ts:249`, `composer.tsx:165-200`).

Descriptions and notes use yet another grammar: `@` = people *or* things, and `/task` `/note`
`/contact` insert refs (`spine/mention.ts`). The proposed `#tag` in capture would add a fourth
meaning.

**Proposal: one glyph per kind of thing,** valid in every text field (composer, description, note,
capture, search):

| Glyph | Means | In capture | In search |
| --- | --- | --- | --- |
| `@` | anything mentionable: **people first**, then tasks, notes, contacts, events, **channels** | assign (`@mike`; first = owner) | filter by person |
| `#` | **tags** | apply tag | filter by tag |
| `/` | commands (insert, create, convert) | — | — |
| `:` | emoji | — | — |

Channels drop the `#` prefix and get a channel icon. Notion and Linear work this way (`@` mentions
people, pages and issues).

**Alternative (keeps Slack habits):** `#` = channels, and tags move to `%` (Todoist moved labels to
`%`), displayed with a tag icon rather than a glyph.

**`$` for tags** works mechanically: only trigger before a letter, so `$40` stays text. But it
reads as money, a code variable or a stock ticker.

**Recommendation:** `#` = tags, `@` = everything else. The reasons:
- it's the more universal convention;
- it's already on the chips;
- tags cut across every module, while channels belong to one;
- small teams have few channels to reference.

❓ Maciej's call. Decide once, because it changes chat, notes, tasks and capture together.

---

## Decisions & direction — round 2 (2026-10-07, later)

### Decided

- **T28 reference grammar: approved.** `@` = anything mentionable (people first, then things,
  including channels), `#` = tags, `/` = commands, `:` = emoji. Channels drop the `#` prefix and
  get an icon. This is cross-module work: chat composer, notes, task descriptions, capture,
  search.
- **Finance is not planned** (not soon, possibly never). Docs updated accordingly.
- **T19: the Queue is not tied to a date.**
  - It is a personal, persistent line-up (`task_queue(user, task, position, queued_at)`).
    `committed_for` retires.
  - Nothing resets at midnight, because work runs past midnight. Done tasks leave the queue when
    the run ends.
  - Staleness is handled quietly: when starting a run on a line-up untouched for days, one line
    asks "Still want these? Keep all · Review".
  - Drift (scheduled times) stays date-based; it's a separate concept.
  - Consumers to migrate: the dashboard Tasks widget ("Today" heading) and Calendar's queue use.
- **T6: Focus lives in the Queue, and the sidebar never changes.** The sidebar is every module's
  base.
  - **Mid-run:**
    - no buckets needed;
    - **add tasks in place** (inline capture in the run, `c`), without changing view;
    - you can **leave Tasks mid-run** (tasks relate to email etc.). The chrome chip follows you,
      and the Now card links straight to linked emails and notes.
  - **End of run:** a summary that invites more: "Add more", "Start another run", plus a few
    suggestions (drifted / due soon / small tasks).
  - **Runs are personal** (no visibility into each other's runs). *But* show **claims**: a task in
    someone else's queue gets a quiet "In Mike's queue" marker (ringed avatar). If it's their
    active Now, it reads "Mike is on this". Queuing it anyway is allowed and gets a quiet note
    (mirror, not wall).
- **Pomodoro runs per queue run**, not per task. Recommended details:
  - A work block ending mid-task = a soft "break" state (+5 min to finish the thought), never a
    hard stop.
  - Nothing accrues during breaks, but in-flight waiting time keeps counting.
  - Long-break counting is per run. A new run started within ~15 min continues the rhythm.
  - Pausing the run pauses the rhythm; leaving Tasks doesn't.
  - Breaks double as check-back moments for in-flight tasks.
- **T1 (drag-to-nest)** and **T13 (completed)** confirmed.

### Reopened

- **T10 assignees — Maciej is rethinking and wants a best bet for users.**
  - **Recommendation now: a single, nullable assignee**, plus creator (auto-follows: notified when
    it's done), plus **claims from the per-person Queue**, plus per-person subtasks for split
    work. Revisit "participants" only if real use shows repeated "both of us" tasks.
  - Scenarios checked:
    - solo: invisible;
    - duo split work: single owner;
    - delegation: assignee + creator follows;
    - pairing/review: subtasks or blocked-by;
    - up-for-grabs: unassigned;
    - household duo: unassigned + claims;
    - small client team: single owner, which Linear/Asana users expect.
  - **Data:** add `assignee_id` (nullable), restore `owner_id` to "creator", and repoint the DF-9
    trigger. A `task_participants` table can be added later without breaking anything.

### T3 — in-flight improvements that don't need MCP

1. **Check-back at hand-off:** "Hand off · check in 15m" (5 / 15 / 30 / custom / none). When due,
   the card gets quiet emphasis plus an optional native notification (same plumbing as pomodoro
   alerts).
2. **Natural check-back points:** on Done/Skip and at each break, the run offers in-flight items
   first ("Pick up X — in flight 18m — or continue with Y?").
3. **See both without switching:** clicking an in-flight card opens its full detail in the
   **right panel**, while the center keeps Now. This fits the "right panel = switchable view"
   convention.
4. **"Where I left off"** is saved as a task comment, so it survives the run and teammates see it.
5. **Waiting on something linked:**
   - paste a URL (PR, agent session, deploy) and get an **Open** button on the card;
   - spine-linked waits light up on their own: a linked **email thread gets a reply**, a
     **blocker task is done**, or **someone comments**.
6. **Keys:** `w` hand off, `1–3` pick up, `Tab` cycles between Now and in-flight.
7. **Quiet "3 in flight" mirror** past three (not a cap). At the end of a run, in-flight tasks stay
   queued.

---

## Decisions & direction — round 3 (2026-10-07, night)

### Decided

- **T3 in-flight ideas 2–5 accepted:**
  - natural check-back points;
  - in-flight details in the right panel;
  - "where I left off" saved as a comment;
  - linked waits that light up on their own.
- **Idea 1 (check-back time) waits** until Maciej has seen the revised Focus mode: the comp's
  §4 puts In flight in the right panel, so the centre stays calm.
- **T7: swap**, not shift. R6 stays as is.
- **Bucket dots in the sidebar:** OK (neutral by default, colour optional).
- **Detail panel keeps its label column.**
- **T11 images:**
  - dropping a file from Finder onto a task row attaches it;
  - no board cover images;
  - **the attachment mark appears on every task display form**: list row, board card,
    timeline bar (tooltip when the bar is narrow), Queue / Up next / In flight, calendar task
    block, Home widget row, task line in a note, ⌘K result, and the capture chip. One mark:
    12 px paperclip + count, muted, hidden at zero, always in the same slot.

### Recommended, awaiting Maciej + Mike

- **Images inline or attachments only? → attachments only for Tasks.**
  - Anything pasted or dropped anywhere on a task (description, panel, capture, row) becomes an
    attachment.
  - Attachments render as a thumbnail strip directly under the description, i.e. in the content
    position, not buried under the properties.
  - **Why:**
    - one place to look;
    - descriptions stay short and scannable;
    - one model, so the mark works the same on every surface;
    - no image layout problems in a 360 px panel;
    - the task editor needs no image block.
  - Inline images belong in Notes (documents), which can reuse the same upload/storage pipeline.
  - Escape hatch if dogfooding asks for it: an inline *reference* chip ("see screenshot.png")
    that opens the attachment, never a full inline image.
- **Limits (starting point for the pricing talk)**, shared across modules per workspace:

  | Plan | Per file | Storage |
  | --- | --- | --- |
  | Free | 10 MB | 1 GB |
  | Pro | 100 MB | 25 GB |
  | Duo | 100 MB | 50 GB |
  | Team | 250 MB | 25 GB per seat |

  - **Cost check** (Supabase docs, Oct 2026): storage $0.0213/GB-month past the plan's 100 GB;
    egress $0.09/GB uncached ($0.03 cached) past 250 GB.
    - A Pro seat that fills all 25 GB costs about $0.53/month in storage, against a $12 price.
    - Egress (people viewing files) is the real cost driver, which is why previews matter.
  - **Comparison:** Todoist 5 MB per file (free) / 100 MB (Pro); Notion 5 MB per file (free);
    ClickUp ~60 MB per *workspace* (free).
  - **The per-file cap is the actual abuse guard.** 10 MB on Free also blocks most screen
    recordings, which makes it a natural upgrade lever.
- **Compression:**
  - **Keep originals** (bug screenshots need pixel-exact text; lossy re-encoding smears UI text;
    storage is cheap).
  - Only downscale images past **4096 px** on the long edge.
  - **Strip EXIF/GPS**, and convert **HEIC → JPEG (q90)** so it opens everywhere.
  - At upload, **generate a preview in the app**: WebP, 1280 px long edge, quality ~80, usually
    50–200 KB. It serves thumbnails, cards and the panel; the original loads only in the
    full-size viewer.
  - Don't use Supabase's on-the-fly image transformations ($5 per 1,000 images past 100/month).
    Pre-generating variants is Supabase's own advice.
  - Long cache headers. The desktop app can keep previews on disk.
- **T22 empty properties → comp §5 shows A / B / C. Recommend C:**
  - Status, Assignee, Priority, Due and Tags are always shown, empty or not.
  - Energy, Scheduled, Time and Repeat appear once set; until then they sit in one quiet line
    that names them ("+ Energy · Scheduled · Time · Repeat").

### Decided (round 3b, same night)

- **Check-back time on hand-off: yes** (after seeing comp §4).
- **Images: attachments only** for Tasks.
- **Limits: double the proposal**, shared across modules per workspace:

  | Plan | Per file | Storage |
  | --- | --- | --- |
  | Free | 20 MB | 2 GB |
  | Pro | 200 MB | 50 GB |
  | Duo | 200 MB | 100 GB |
  | Team | 500 MB | 50 GB per seat |

  - At full use that's about $1.07 per paid seat per month in storage; Free maxes out around
    $0.04.
- **Empty properties: C** (core always, the rest when set).

### Upload limits — error handling (proposal)

Tone: mirrors, not walls. Facts with numbers and one way forward. Never red (red stays for
destructive actions). Never a blocking modal.

1. **File too big for the plan.**
   - Checked in the app before the upload starts, so it's instant and nothing is wasted.
   - The file shows as a *not attached* tile where it was dropped: "recording.mov is 340 MB — your
     plan allows 200 MB per file."
   - Images over the limit are scaled down automatically instead of being rejected. (Rare anyway,
     with the 4096 px cap.)
   - Multi-file drops: the files that fit attach; one line lists the ones that didn't.
   - The workspace owner also gets an **Upgrade** link when a higher plan would allow the file.
2. **Approaching the workspace limit.**
   - **At 80%:** one quiet notification to the workspace owner, and the storage meter in Settings
     gets emphasis. Members aren't bothered.
   - **At 95%:** whoever uploads sees "Storage almost full — 47.6 of 50 GB" as a caption on their
     upload tile (no popup). The owner gets one more notification.
3. **Limit reached.**
   - New uploads stop. **Everything else keeps working:** existing files open and download, tasks
     stay editable, and nothing is deleted.
   - The tile says "Not attached — workspace storage is full (50 / 50 GB)", with **Free up space**
     (opens the largest-files list) and, for the owner, **Upgrade**.
4. **Capture never loses the dump.**
   - If a pasted image can't be attached (full, too big, offline), the task is created anyway.
   - The image waits locally as *not attached · Retry*, and attaches by itself once it can. The
     desktop app keeps it on disk across restarts.
5. **Downgrade while over the limit.** Nothing is deleted; uploads pause until usage is back under
   the limit. The owner sees a banner in Settings with the largest files.
6. **Network failures.** Automatic retry with backoff; a failed tile offers Retry; pending
   uploads survive restarts on desktop.

**Mechanics:**
- **Enforcement:** the app checks first; the server enforces when it issues the upload URL (plan
  limit + remaining quota). Tiny races between simultaneous uploads are allowed as a soft overage
  rather than locked.
- **Deleting** an attachment frees the space immediately; the file is purged after 30 days.
- **Visibility:** a **Settings → Plan & usage** storage meter plus a "largest files" list with
  delete.
- **Reuse:** one shared upload component with five states — *uploading · done · failed (retry) ·
  too large · storage full*. Notes and Chat reuse it.

### Build order (proposal: lanes, not waves)

Small blocks, each merged as soon as it's verified. Lanes run in parallel where they don't share
files; blocks within a lane are sequential.

1. **Focus timer fix** (T2: wall-clock, persistence, the away prompt, background throttling,
   native notification). Independent; start now.
2. **Design foundation:**
   - state-layer tokens, hairline, raised control, global scrollbars, selection recipe (U1–U4);
   - then the primitives (NavRow, MetaCount, FilterBar/Chip, DisplayMenu, DnD visuals);
   - then Tasks surfaces: rows + board (U6–U9, T9, T13), toolbar + Filter/Display/search (T5,
     T21), detail panel (U11, T22-C, T20 comments), capture (U13, T8, T25), sidebar (T7, T15).
3. **Team data:**
   - assignee model (T10: nullable `assignee_id`, `owner_id` = creator, "Mine", filters);
   - then the per-person Queue (T12/T19, claims, consumers migrated);
   - then time entries (T17).
4. **Focus run** (after lane 3's Queue + time entries):
   - line-up / run / break / summary / empty (T6, T18, pomodoro per run);
   - then In flight + check-backs + linked waits (T3).
5. **Attachments:**
   - storage + quotas + error handling;
   - then upload / viewer / paste-drop UI;
   - then the mark on every surface (T11).
6. **Reference grammar** (T28) across chat, notes, descriptions, capture and search. Starts after
   tag plumbing is unified.

Then **DnD + multi-select + bulk** (T1, T14) once lane 2's rows land. Lanes 1, 2, 3 and 5 can start
in parallel today. Realistic concurrency is 2–3 sessions: the limit is review/dogfooding and merge
conflicts in the shared Tasks files, not build speed.

---

## UI review — 2026-10-07 (from the running desktop app)

Live screenshots of the desktop build: list, board, Focus, capture modal, hover states.
**Proposal comp: [ui-proposal.html](./ui-proposal.html)** — interactive, built on the real tokens,
with switches for density, shade, accent and radius, rail-count *swap vs shift*, and selection
style.

### Systemic (token / DS level — these flow to every module)

- **U1 — Roles collapse onto one value in dark mode.**
  - `--accent` (hover fill) = `--secondary` (buttons, badges) = `--border` (hairlines) =
    neutral-800.
  - `--muted` = `--popover` = `--input` = neutral-850.
  - Result: hovered rows swallow their own badges and borders, hover ≈ selected, and pills merge
    into rows.
  - **Proposal:** a **state layer**, i.e. overlays derived from the surface:
    - `--state-hover` (fg 5%)
    - `--state-active` (fg 9%)
    - `--state-selected` (primary 13%)
    - `--state-selected-ring`

    Plus a `--hairline` (fg 10%) for borders. It works on all 6 shades, any accent, and light
    mode later.
- **U2 — The segmented control's active plate renders *sunken* on dark.** The plate is `bg-card`
  (0.14) on a `bg-muted` (0.18) track. In the icon-only view switcher the active state is
  practically invisible. **Proposal:** a `--control-raised` token (lighter than the track on
  dark, white + shadow on light).
- **U3 — Scrollbars are the native thick ones** almost everywhere: `.scrollbar-thin` is opt-in and
  only Calendar uses it. **Proposal:** thin, token-coloured scrollbars as the *global* default
  (`*` + `::-webkit-scrollbar`), thumb fg 16% / hover 32%, transparent track.
- **U4 — Selection recipe (R5) = tint + left bar.** The bar is detached from the row shape and
  breaks with `round` radius. **Proposal: selection = tint only** (optionally + a 1 px inset
  hairline; try both in the comp). Update R5; it flows to rail items, board cards and the notes
  tree.
- **U5 — Rail count on hover.** R6 already says reveal-on-hover *reserves space and fades, never
  reflows*. That's why "swap" was proposed. "Shift" breaks R6: the label re-truncates under the
  cursor. Both are in the comp; if shift wins, amend R6.

### Rows (list)

- **U6 — No column alignment.** The meta cluster is variable-width per row (tags, dots, bars,
  avatar, bucket pill), so nothing lines up. **Proposal:**
  - title + quiet counts (`# 3` · 📎 2 · 💬 1 · ↳ 0/1 · blocked) right after the title;
  - **fixed right-hand columns:** priority · date · assignee · queue;
  - columns empty across the whole view collapse.
- **U7 — The priority/energy glyphs are unreadable.** Variable-footprint dots and bars render as
  "•••", "≡", "_". **Proposal:**
  - priority = a fixed 3-bar glyph with ghost bars (read by fill);
  - energy is off on rows by default (Display toggle), and shown in the panel with a bolt icon.
- **U8 — The bucket pill repeats on every row** (even under a bucket group header), and pills are
  the loudest element on the row. **Proposal:**
  - buckets get an **icon slot**: a dot, optionally coloured; the default stays quiet;
  - show "dot + name" as plain muted text only in views where the bucket isn't implied.
- **U9 — Done rows dim only the title.** Tags, glyphs, avatar and pill stay at full strength.
  **Proposal:** the whole row at ~45% except the checkbox. Moot by default once completed tasks
  are hidden.

### Toolbar

- **U10 — Four control languages in one bar:**
  - naked "Group: Bucket" select text;
  - outlined Filter;
  - sunken segmented control;
  - white filled New.

  **Proposal:**
  - one ghost-button language on one rung: Search · Filter · Display | view switch (raised
    plate) | **New** (the single primary);
  - Group moves into **Display**;
  - an active filter = filled + count badge, with chips below that read as sentences.

### Detail panel

- **U11 — "Not thought-through":**
  - no header: no checkbox next to the title, no breadcrumb, no ⋯ / link;
  - an empty reserved description box;
  - a jagged value column: icons on some rows, chevrons on others, native number steppers,
    "240 ⇕ min est";
  - two label systems (inline labels vs uppercase eyebrows) and four separators;
  - the loudest element is a full-width white "Commit to Queue".

  **Proposal (in the comp):**
  - **Header:** breadcrumb · queue toggle · link · ⋯; checkbox + title; auto-height description.
  - **Properties:** every value starts at the same x behind a 14 px icon slot. No chevrons; hover
    reveals the field. Muted placeholders.
  - **Time:** one row, "0m of ~4h" with a hairline bar, replacing the two number inputs.
  - **Tags** become a property.
  - **Collections** (Subtasks / Blocked by / Attachments / Linked) share one header style
    (label · count · +).
  - **Bottom:** activity + comments + composer.
  - **Creator** goes in the last metadata line.

### Board, capture, Focus

- **U12 — Board:**
  - fixed 288 px columns leave most of the canvas empty;
  - per-column thick scrollbars;
  - card meta order differs from rows (queue icon first);
  - a separate tags line;
  - the selected card has a bright white ring;
  - done cards stay loud.

  **Proposal:** one meta line (priority · date · counts · avatar), tint selection, and done cards
  faded. Columns flex or a wider fixed width, as in Linear.
- **U13 — Capture modal:**
  - 8 pills wrap to two rows;
  - the assignee pill is taller (a 20 px avatar inside a pill);
  - the "set" state is inconsistent (Inbox filled vs Me outlined).

  **Proposal:**
  - 4–5 pills + **More**;
  - avatar at icon size;
  - one set/unset rule;
  - the title highlights parsed tokens (`#tag`, dates);
  - an **"Add to my queue"** switch next to Create;
  - pasting a screenshot attaches it.
- **U14 — Focus empty state** says "0 / 0 Done ✓" (a celebration with nothing done), and the
  right panel keeps showing an unrelated task. Superseded by the Queue-run redesign, but note both
  for it.

---

## How Tasks works today (shared vocabulary)

- **Buckets** (exclusive, like projects) in the left rail, plus fixed rows **All**, **Queue**,
  **Inbox**. Optional **sections** group buckets.
- **Views:** List · Board · Timeline. List groups by none/status/bucket/priority/energy.
- **Queue** = tasks with `committed_for = today`, ordered. Rail row "Queue", mode "Focus", button
  "Commit to Queue". These are three names for one set.
- **Focus** ("execute" in code) = the center shows the **first unfinished queued task** as a Now
  card, with an opt-in stopwatch/pomodoro. The time is added to the task's
  `timeSpentSeconds`. A chrome chip mirrors a running session app-wide.
- **Assignee** (shipped today, #208) = the task's `owner_id` (the creator column, reused).
- **Tags**: workspace-level, added only in the detail panel. The filter is tags-only.

---

## The list

Format per item: **what's actually going on → what others do → options → recommendation → ❓**.
Your items keep their numbers (T1–T11); new findings continue from T12. Size: S / M / L.

### T1 — Drag & drop: reorder within a bucket, move between buckets · M

**What's going on.** Dragging does something different on every surface:

| Surface | Drag does |
| --- | --- |
| Bucket list | Drop **onto** a task = make it a subtask. No reorder, no drop line. |
| Queue list | Reorder only. |
| Board | Reorder within a column + move across columns (status; bucket in "All"). |
| "All" (grouped list) | Nothing. |
| Rail buckets / Queue row | Not drop targets. |

There's no multi-select, so moving 10 tasks takes 10 menus. The groundwork is good: positions are
already stored (`position`, Lexorank) and the DnD layer was built to take new drop targets
(`ui/dnd/task-dnd.tsx` — "a new variant + one branch").

**Others (A1).** They share one rule:

- **Reordering inside a group needs "Manual" order** (Linear, ClickUp, Asana, Notion).
- **Dragging *across* groups always works** and rewrites the property: status column → status,
  priority group → priority (Linear, ClickUp).
- **TickTick lets you drop on the sidebar:** onto a list = move, a smart list = set date, a tag =
  add tag. Multi-select works the same way.
- **TickTick nests by position:** drop "below and slightly to the right" = subtask.
- **Asana removed drag-to-sidebar in 2023,** and users are still asking for it back.
- **Things' ⇧⌘M "Move" dialog:** type a destination with fuzzy match, or create a new one.

**Options**

- **a. Drag = reorder; drag right = make subtask** (indent by horizontal offset, TickTick-style).
  One gesture, two outcomes.
- **b. Drag = reorder; nesting moves elsewhere** (⌥-drag, or "Make subtask of…" in the menu).
- **c. Keep drop-onto, add reorder zones** (top/bottom = reorder, middle = nest). Notion-style,
  and fiddly with dense rows.

**These apply whichever option you pick:**

- **Drop targets:** rail buckets (move) and the Queue row (commit).
- **Cross-group drops** in grouped lists rewrite the field: dropping into "High" sets priority,
  into another bucket's group moves the task.
- **When reordering is blocked by a sort,** say so inline: "Sorted by due date — switch to Manual
  to reorder." Never refuse silently.
- **Multi-select** (⇧/⌘-click, ⌘A), dragging the whole set (T14).
- **Keyboard:**
  - ⌘↑/↓ move
  - ⌥⌘↑/↓ top/bottom
  - ⇧⌘M type-to-move dialog (can create a bucket)

**Recommendation:** **a**, plus rail drop targets and multi-select.
❓ How often do you nest by dragging today? If rarely, **b** is simpler and more predictable.

### T2 — Focus doesn't count time when the window isn't focused · S

**What's going on.** `focus-session-store.ts` runs `setInterval(tick, 1000)` (:211) and each tick
adds `+1` (`tick()` :164). When Moduo isn't in front, WebKit throttles or suspends timers (macOS
App Nap too), so fewer ticks fire and seconds are lost. Tauri's own config docs (tauri-utils
2.9.2, `BackgroundThrottlingPolicy`) say the default is a **suspend** policy that pauses all
tasks until the view is visible again, and can unload the view after about 5 minutes hidden.
Moduo's `tauri.conf.json` doesn't set a policy, so it gets that default. Calendar's block timer
(`calendar/hooks/use-block-focus.ts` :7-13) documents and fixes exactly this with wall-clock
accrual. The Tasks timer was ported "verbatim" from the older tick-based hook (DF-11). Related:

- The session lives only in memory. A reload or crash loses the running session and up to 60 s.
- Pomodoro phase ends can't fire on time in the background. The chime is Web Audio inside a
  backgrounded webview, so it may never play.

**Fix:**

- Store `runningSince` timestamps and compute elapsed = banked + (now − runningSince).
- Store pomodoro phases as `phaseEndsAt`, with catch-up when the app wakes.
- Recompute on `visibilitychange`/focus, and flush on `pagehide`.
- Persist the session to localStorage so it survives a reload.
- Send a **native notification** at phase end. This needs `tauri-plugin-notification`, which
  isn't installed.
- Set `"backgroundThrottling": "disabled"` on the main window (supported on macOS 14+; no effect on
  Windows, Linux or the web build). This is belt-and-braces, not the fix: wall-clock accrual is
  still needed for the web build, older macOS and laptop sleep.

Once time is wall-clock, the opposite risk appears: **runaway time** (Sunsama users report 52-hour
timers after a weekend). Ship a quiet **"while you were away"** state alongside the fix:

- **Detect the gap:** more than ~90 s between ticks means the app was suspended or the machine
  slept.
- **Offer:** Keep · Discard · Count as break · Split.
- **Pomodoro:** never auto-start a new work phase while the user is away.

**Recommendation:** do this first. It's a correctness bug and cheap. Then merge the two timers
into one engine (T16).

### T3 — Focus should allow multi-tasking (Mike's take) · M

**What's going on.** The timer is tied to one task:

- The session binds to "the first unfinished queued task" (`execute-view.tsx:70`).
- Changing task resets the whole session (`bindFocusTask` → `{...REST}`, store :242), and that
  also turns the pomodoro off. Finish a 5-minute task ten minutes into a pomodoro and the next task
  starts from zero with no pomodoro.
- You can't choose which task to focus on except by reordering the Queue.
- A second, separate timer exists in Calendar. Both can run at once on different tasks, so
  multitasking already happens by accident: time gets double-counted and the chrome chip shows
  only one of them (T16).

**"Multi-tasking" can mean three things.** Mike needs to say which:

1. **Batch:** one sitting or pomodoro across several small tasks, like ticking off five emails in
   one 25-minute block. *This is broken today by the reset.*
2. **Switching:** jumping between 2–3 tasks within a sitting without losing the clock, with time
   split correctly.
3. **Parallel:** two things genuinely running at once, like a render, build, upload or call while
   you work on something else.


**Proposed model.** Split the **Session** from the **Active task**:

- **Session** = the sitting: stopwatch or pomodoro rhythm, breaks, total. It keeps running when
  you complete or switch tasks.
- **Active task** = whatever gets the attention time right now. Completing it advances to the next
  one and the session carries on.
- Click a row in "Up next" to make it active. Time splits automatically, which needs time entries
  (T17).
- **Switching** is one key ("switch to…"), with an optional one-line "where I left off" note. That
  note is the evidence-backed fix for attention residue.
- **Waiting items** cover genuinely parallel work: mark a task *Waiting on…* (the render, the
  build, someone's reply), optionally with a check-back time. A notification brings it back. Wait
  time is logged separately and never counts as focus.

This covers meanings 1 and 2 fully, and meaning 3 honestly, without pretending anyone can focus on
two things at once.

**Research verdict:** no serious tracker runs two timers at once (Toggl, Clockify, Harvest and
Everhour all refuse; only Tiimo allows it). The evidence supports "one attention thread", with the
real cost being switching and remembering to check back.

**Recommendation:** session/active split + one-key switching first (Option C), then Waiting items
(Option A). Never true concurrent timers (Option B).
❓ **Ask Mike for three real examples** and sort each into *switching*, *waiting* or *genuinely
overlapping*.

### T4 — Group / filter / search by assignee · S (after T10)

**What's going on.** Assignee = `owner_id`, the creator column (`assignees.ts:1-3`). As a result:

- A task can't be unassigned. Every new task defaults to you.
- "Created by" is overwritten when you reassign.
- There's no filter or group by assignee, and no "My tasks".
- Everything that should be personal is workspace-wide: the Queue (T12), rail counts and drift
  counts.

**Recommendation:** fold this into the filter/display system (T5):

- An **Assignee** group-by, with an "Unassigned" group.
- Filter "Assignee is Me / Mike / Unassigned".
- A **"Mine"** scope in the rail, or a pinned filter preset.

Settle the data model (T10) first so the filters aren't built twice.

### T5 — Filters beyond tags · M

**What's going on.** The filter is tags-only and OR-only. It isn't remembered, and the Filter
button **disappears when the workspace has no tags**. There's no in-module search: ⌘K finds tasks
but can't narrow the list.

**Others (A2–A4).**

- **Linear:** `F` opens filters; type a value to jump to it; `is / is not / any of`; nested AND/OR
  only under "Advanced"; filters in the URL; save as view.
- **Todoist:** a query language for power users, *plus* light filters in each view's Display menu
  with a badge counting active filters, and a "Me and Unassigned" preset.
- **Things:** a tag bar that only appears when the list has tags.
- **ClickUp:**
  - *new tasks inherit the active filter's values*;
  - click a chip on a row to filter by it.

  Nobody leads with boolean logic.

**Proposal:** a **Filter** and **Display** pair in the toolbar.

- **Filter dimensions (v1):**
  - Assignee (incl. Me, Unassigned)
  - Tag
  - Status
  - Priority
  - Energy
  - Due (today / this week / no date / past)
  - Scheduled (today / this week / none / drifted)
  - In Queue
  - Blocked
  - Recurring
  - Has subtasks

  AND across dimensions, "any of" within one, with "is / is not". The active filter shows as
  chips, e.g. `Assignee is Me ×`.
- **Search:** `/` focuses a field that filters the current scope live by title and description.
  It understands the same tokens as capture (`#tag`, `@person`), so capture, search and filters
  share one grammar.
- **Display popover** (one control, Linear-style):
  - Group by: add Assignee, Due, Scheduled and Tag.
  - Sort: Manual, Due, Scheduled, Priority, Created, Updated.
  - Show completed (T13).
  - Row properties on/off (feeds T9).
- **Persist per scope** (bucket / All / Queue), personal by default. Later, **"Save as view"**
  puts the view in the rail's top section next to All, Queue and Inbox.
- **Filter seeds capture** (ClickUp). Pressing New inside a `#client-x · Mine` view pre-fills that
  tag and assignee. This is "friction behind the dump" done right.
- **A badge on Filter/Display** shows how many are active, and a clear-all appears next to the
  chips.
- **A "Time" grouping:** Earlier · Today · Tomorrow · This week · Later · No date. TickTick has
  this, but call it "Earlier" or "Drifted", never "Overdue". On Board it doubles as a week-planning
  surface.
- **Group by Energy** (and Energy × Time) is something no competitor has.

**Recommendation:** build Filter and Display as shared primitives. Contacts' directory filters and
Notes would reuse them.

### T6 — The Plan/Focus switch is in the wrong place · S–M

**What's going on.** The switch sits at the top of the rail, but in Focus nothing in the rail does
anything. Focus always shows the Queue's first task, and clicking a bucket only changes a hidden
selection. Naming adds to it: the rail says "Queue", the mode says "Focus", the panel button says
"Commit to Queue", and the dashboard widget uses "Queue" for the opposite set (critique, DF-15).

**Options**

- **a. Focus as a launch, not a mode.** Remove the switch.
  - **"▶ Start focus"** becomes the Queue view's primary action.
  - **"Focus on this"** goes on every task: row hover, context menu, detail panel, `f`.
  - Focus takes over the center with a clear "Exit focus" (Esc).
  - The rail's Queue row shows a live dot while a session runs. The chrome chip stays.
- **b. Focus as a rail item** next to Queue. Simplest, but it stays "a page you go to" and the rail
  is still idle while you're there.
- **c. Focus as an app-level surface:** a floating, always-on-top mini timer or menubar timer on
  desktop (a second Tauri window). Tasks only launches it. Best for "I'm working in another app
  while the timer runs", which also helps T2.

**Others (A9, B1).** Nobody puts a Plan/Focus switch in the list rail. The consensus has three
entries:

1. **`F` on any task**, from anywhere (Sunsama, Akiflow, Marvin).
2. **Starting a timer drops you into Focus** (Sunsama).
3. **A Focus nav item or tab** (Sunsama, TickTick).

Plus a **floating, always-on-top bar** to get back to it (Sunsama's Focus Bar, Toggl's mini-timer,
TickTick's floating window).

Inside Focus they offer:
- ↑/↓ to the next item;
- a quick-capture field so a stray thought doesn't break focus;
- a peek at the next event;
- Marvin's progress bar that warms up once you pass the estimate.

**Recommendation:** **a** now. Entry points:
- `f` on any task;
- "Start focus" in the Queue header;
- starting a timer anywhere, Calendar blocks included.

The chrome chip is the way back. Then design **c** (Focus Bar) as the desktop follow-up.
❓ While Focus runs, should the rail collapse (true focus) or stay (context)?

### T7 — Rail counts aren't pushed to the right · S

**What's going on.** The count is a fixed `w-6` column (`bucket-rail.tsx:288`). Every row,
including All, Queue and Inbox which have no menu, reserves a 20 px slot for "…" (:356). So counts
float about 28 px from the edge. There's also a trap: **a drifted count is a button** (click →
triage). If the count swaps for "…" on hover, that button disappears exactly when you reach for it.

**Others (A8).**

- **Todoist:** the count is right-aligned and swaps to "…" on hover in the same slot (observed;
  their 2025 fix for "count showing under the ⋯" confirms the shared slot). There's also a
  setting to hide counts.
- **Linear:** unread shows as a number *or* a dot, the user's choice.
- **Notion:** "•••" and "+" appear on hover; the "+" adds a child right there.

**Recommendation**

- Counts sit flush right.
- On row hover, keyboard focus or open menu, the count fades out and "…" fades in **in the same
  slot**: no layout shift, using the motion-token fade.
- Drift moves out of the count:
  - a quiet dot before the count;
  - triage from a strip at the top of the list ("2 drifted · Review"), the pattern Calendar and
    the Dashboard already use;
  - and from the "…" menu.
- All, Queue and Inbox stop reserving a slot. Inbox can get a menu (Triage).
- The "…" stays reachable by right-click and keyboard, never hover-only.
- *Optional:*
  - a hover **"+"** next to "…" to capture straight into that bucket;
  - a Display setting for counts: **number / dot / off**, for anyone who wants buckets silent
    ("quiet until used").

**DS:** a shared **`NavRow`** primitive (see DS proposals). The Notes tree, Calendar rail and Chat
channel list each build their own today.

### T8 — Tags at creation · S–M

**What's going on.** Spec §6 deliberately kept capture tag-free ("friction behind the dump").
Dogfooding says that was wrong: for you, tags *are* part of the dump. Separately, Tasks has its
own tag plumbing (`toggleTaskTag`), while Notes, Contacts and Email use the shared `useEntityTags`.
Unify those before adding a second way in.

**Others (A6).**

- **TickTick:** `#` inline creates or picks a tag.
- **Todoist:** `#` = project, `%` = label (moving away from `@`), `+` = assignee, `p1` = priority.
- **Akiflow:** `#` = project.
- **Linear:** a label picker in the create modal + `L`.

The mixed meaning of `#` across apps is a known source of confusion. Pick one token per property
and use it everywhere: capture, search and filters.

**Proposal**

- A **Tags pill** in the capture row, using the same TagPicker as the detail panel, with inline
  create.
- **`#` in the title:**
  - Typing `#` at the start of a word opens suggestions: fuzzy-matched existing tags, with
    "Create #name" as the last row.
  - Enter/Tab picks one. The token is removed from the title and appears as a chip in the pill
    row, the same way dates already fill pills.
  - Esc leaves a literal `#`.
  - It only triggers on `#` + a letter at word start, so "#123" and "C#" stay text.
- **Description:** don't parse `#`. It creates two sources of truth, since deleting the text
  wouldn't remove the tag. `@` and `/` refs stay as they are.
- Use the same `#` grammar in search (T5) and in the global capture bar (DF-20).

❓ Should `#` also set the bucket (Todoist uses `#` for projects)? Recommendation: no. `#` means
tag only, since the chips already render tags as `#name`. Buckets are set by the pill.

If we want more tokens later, reserve them now:
- `+name` for assignee (Todoist);
- `!` for priority;
- possibly `~` for energy.

Buckets stay pill-only.

### T9 — Tags clutter rows · S (+ M for row anatomy)

**What's going on.** Rows show up to 3 tag chips after the title (`task-row.tsx:243`), cards up to
4. The right side of a row also carries blocked, recurrence, priority/energy dots, avatar,
scheduled, due, bucket badge and the queue toggle. All of these vary in width, so nothing lines
up down the list.

**Others (A6, A10).**

- **Linear:** labels are a Display-properties toggle.
- **ClickUp:** "Hide tags from task name", plus icon-only "has description / attachment /
  dependency" indicators.
- **Things:** greys or hides tags a row inherits from its context.

The common thread: rows carry *indicators*; detail carries *content*.

**Proposal**

- Show a **tag indicator `# 3`** (muted; tooltip lists the names; click opens the picker) on rows
  and cards. Full chips appear only in the detail panel.
- While a tag filter is on, show the *matching* tag inline so you can see why the task matched.
- **Bigger:** fixed right-hand columns so meta lines up vertically, in this order:
  1. title + quiet indicators (subtasks n/m · `#3` · 📎 · 💬)
  2. dates
  3. assignee(s)
  4. queue

  Make row properties toggleable in Display (T5), with sensible defaults.

**DS:** a **`MetaCount`** primitive (icon + number).

### T10 — Multiple assignees · M

**What's going on.** One assignee, stored in `owner_id`.

**Others (A5) — this is the one place the research pushes back on the request.**

- **Linear, Asana and Todoist deliberately keep one assignee** and say why: a single directly
  responsible owner (Apple's "DRI"). "Without a clear, single task owner, much of that
  accountability is lost" (Asana).
- **Their escape hatches:**
  - collaborators/followers (Asana);
  - per-person subtasks (Asana, Todoist);
  - agents as delegates while the human stays accountable (Linear).
- **ClickUp has multiple assignees, but as an admin opt-in per Space.** It also has quirks, e.g.
  a task with several assignees only shows in the matching group when filtered.
- **Notion** People properties are multi by nature.

**Trade-off.** Multiple assignees reflect pairing honestly, which matters on Duo. But shared
ownership blurs "who is actually doing this today". Moduo already has the DRI-friendly pattern:
subtasks are full tasks with their own assignee, e.g. "Design" → you, "Build" → Mike.

**Options**

- **a. Multiple, flat** (ClickUp/Notion).
- **b. Multiple, one marked as owner** (Asana's model expressed as multi-assignee). The owner is
  the first assignee by default and is the one who gets drift/due nudges. Everyone else is a
  co-assignee.
- **c. Stay single, and lean on per-person subtasks + "Watching".**

**Proposal (b)**

- A `task_assignees` join table allowing 0..n assignees, with an `is_owner` flag. Zero =
  **Unassigned**, i.e. "up for grabs".
- `owner_id` goes back to meaning **creator**. Migrate today's `owner_id` values into assignee
  rows.
- The "assigned to you" notification fires per added assignee (the DF-9 trigger reads `owner_id`
  today).
- **Pair it with a per-person Queue (T12):** each assignee commits the task independently. That
  removes the ambiguity.
- Rows show stacked avatars (2 + "+n").
- Keys: `a` assign, `i` self-assign (Linear).

❓ **a, b or c?** I recommend **b**. It gives you multiple assignees without losing who's
accountable.

### T11 — Images on tasks · M

**What's going on.** The description is Lexical (`EntityTextEditor`) with `@`/`/` refs but no image
node. Tasks has no attachments at all, and neither does Notes. Storage today is the public
`avatars` bucket, but attachments must be private (workspace RLS).

**Proposal**

- Paste or drag images and files into the description. Uploads go to a **private**
  `task-attachments` bucket at `{workspace}/{task}/{id}`.
- Images render inline as thumbnails; click to open large.
- An "Attachments" list for non-image files.
- A 📎 count on rows (T9).
- Build the image node and upload path as shared pieces so Notes, comments and Chat can reuse
  them.
- Size and storage limits per plan (pricing v2).

The most common case is likely a screenshot pasted with ⌘⇧4 → ⌘V, so paste has to be excellent.

**Others (A7).**

- **Pasting or dropping images into the description is the baseline** (Linear, Asana, TickTick,
  Notion, Superlist). Things is the deliberate outlier.
- **Todoist** keeps files in comments.
- **ClickUp's split drop zone:** drop on the left half = attachment, right half = comment.
- **Board covers:**
  - automatic in Asana, which caused so many "don't make my screenshot a cover" complaints that
    both Asana and ClickUp added off-switches;
  - Notion lets you pick the source.
- **Rows** show a paperclip/count, never a thumbnail.
- **Free-tier limits:** Todoist 5 MB per file; Notion 5 MB; ClickUp 60 MB *per workspace*.

❓ Cover images on Board cards? Recommendation: not now; if ever, opt-in per view.

---

### New findings (T12+)

**T12 — The Queue is shared across the whole workspace · High · M**

- `committed_for` lives on the task with no user. The Queue = every task committed today
  (`use-tasks-module.ts:269`).
- In a shared workspace, your teammate's queue mixes into yours: Queue, Focus card and counts.
  Drift and "All" counts are workspace-wide too.
- **Fix:** per-person commitments, e.g. a `task_commitments(task, user, date, order)` table, plus a
  **"Mine"** default scope.
- **Others** have explicit noise controls:
  - TickTick: per shared list, "show in my Today: only tasks assigned to me";
  - Todoist: a "Me and Unassigned" preset;
  - ClickUp: Me Mode;
  - Linear: My Issues ordered by "focus".
- This is a prerequisite for T3 and T10 to make sense in a team.

**T13 — Completed tasks never leave the list · High · S**

- Done tasks stay in place with a strikethrough until archived by hand (`tasks-plan-view.tsx:274`
  only drops `archived`).
- Archived tasks have **no view at all**. They can only be reached through ⌘K.
- **Proposal:**
  - Display → "Show completed": hide / at bottom (a collapsed "Completed (12)" group) / last 7
    days.
  - Auto-archive after N days.
  - A **Logbook / Archive** view (as in Things). This is also where "what did we finish this
    week" lives.

**T14 — No multi-select or bulk actions · High · M**

- Reorganizing happens one task at a time.
- Add ⇧/⌘-click and ⌘A, then move / assign / tag / queue / complete / delete in one go. Drag the
  set (T1).

**T15 — Bucket management gaps · Medium · S**

- **Delete bucket:** no confirm, no undo, and its tasks silently move to Inbox
  (`bucket-rail.tsx:514`, `use-tasks-module.ts:972`).
- Buckets can't be reordered (`position` exists, nothing writes it).
- Section collapse isn't remembered.

**T16 — Two focus timers that don't know about each other · Medium · M**

- **Tasks Focus:** app-level, tick-based.
- **Calendar block focus:** wall-clock, but component-level, so it stops when you leave Calendar
  (`use-block-focus.ts`).
- Both can run at once. The chrome chip shows only the Tasks one, and the two behave differently.
- **Fix:** one app-level focus engine that both surfaces drive.

**T17 — Tracked time is one number · Medium · M**

- `timeSpentSeconds` is updated by read-modify-write (`use-tasks-module.ts:544`). There's no
  who/when and no history.
- A lost update is possible when two timers or devices write at once.
- Round D's "time entries + `tasks_op_track_time`" decision was never built.
- **Needed for:** T3 split time, per-person time (T10/T12), and any "time this week" view.

**T18 — Focus only takes the first queued task · Medium · S**

- There's no "focus on this", and "Up next" rows aren't clickable.
- The spec's **"Do last"** is missing.
- **"Skip" reschedules the task out of today**, which is heavier than people expect mid-session.
- Folds into T3/T6.

**T19 — The Queue empties silently at midnight · Medium · S (needs a decision)**

- Unfinished queued tasks just drop out of tomorrow's Queue.
- That may be intended (no pile-up), but nothing tells you.
- **Options:**
  - a morning "carry over?" moment (Sunsama-style);
  - a quiet "3 from yesterday · Re-queue" strip (same strip pattern as drift).

**T20 — No comments on tasks · High for a team · S–M**

- The spine comments system (polymorphic, with @-mention notifications) exists and Notes uses it.
  Tasks doesn't show it.
- For a two-person tracker, this is where the discussion about a task belongs.

**T21 — No in-module search · Medium · S** — part of T5.

**T22 — The detail panel always shows every property · Low · S (debatable)**

- 10 property rows even when empty, which works against principle 1 ("quiet until used").
- **Option:** show the set properties + "Add property", or keep the full list but tighter.

**T23 — Design-system drift inside Tasks · Low · S**

- Row schedule/due popovers still use **native `datetime-local`/`date` inputs**, although DECISIONS
  planned `DateField` everywhere (the detail panel has it).
- A raw `<input type="checkbox">` in the Focus timer menu.
- Queue rows and the inline title editor use the display font, while Round A says titles use body.
- "Commit to Queue" vs "Add to queue" use different verbs.

**T24 — Keyboard gaps · Low · S**

- **Has:** j/k, x, e, c, b, s, d, q, ⌘⌫.
- **Missing:**
  - `a` assign, `i` assign to me
  - `l` tags
  - `p` priority
  - `f` focus
  - ⌘↑/↓ move
  - ⇧⌘M move to…
  - ⇧j/k extend selection
  - `/` or ⌘F search
  - `F` filter
  - `?` shortcut sheet

  These mostly mirror Linear, Things and Todoist, so muscle memory carries over.

**T25 — Capture modal gaps · Low · S**

- No "Add to queue" toggle, though "capture → do it today" is common.
- No tags (T8) and no attachments (T11).

**T26 — The Queue has no capacity mirror · Medium · S**

- The Queue can hold 14 hours of estimates on a 6-hour day, and nothing says so.
- **Sunsama** sums planned time against a threshold (~5.5 h suggested) and *warns and offers to
  defer, never blocks*. **Marvin** has a similar capacity estimator.
- **For Moduo:** a quiet "~6h 40m queued" with a soft emphasis past a personal threshold. Pure
  "mirrors, not walls". It's cheap because `durationMinutes` already exists.
- Pairs with a **"Later today" tail** in the Queue (Things' "This Evening"): visible but
  de-emphasised. This is where the spec's "Do last" lands (T18).

**T27 — No planning moment · Low · M (optional, needs a decision)**

- Plan mode is only "a list you can edit". Competitors that target this audience have a short,
  optional ritual:
  - Sunsama: yesterday → add → capacity → order;
  - Akiflow: Rituals;
  - Things: the Daily Review section.
- **For Moduo:** a `P`-triggered (or morning-prompted, off by default) flow over existing pieces:
  1. yesterday's leftovers (T19)
  2. drift triage
  3. pick into the Queue
  4. capacity check (T26)
- Never forced. Worth a discussion, not a build yet.

---

## Proposed sequencing (for discussion)

1. **Correctness & team basics** (small, high value): T2 timer, T12 per-person Queue + "Mine",
   T13 completed handling, T15 delete confirm/undo, T7 rail counts.
2. **Focus rethink:** T6 entry point, T3/T18 session vs active task + switching, T16 one engine,
   T17 time entries, T26 capacity mirror + "Later today".
3. **Organizing & finding:** T1 DnD + T14 multi-select, T5/T4/T21 filter · display · search, T9
   row anatomy, T24 keys.
4. **Content & collaboration:** T10 multi-assignee, T8 tags in capture, T20 comments, T11
   images/attachments.

The T10 data-model call should land before wave 3 builds assignee filters. T27 (planning ritual)
stays a conversation until waves 1–2 are in.

## Decisions needed before anything gets built

1. **T12:** is a per-person Queue the right model, i.e. does each of you have your own "today"?
   *(Recommend yes.)*
2. **T3:** Mike's three real examples of "multi-tasking", sorted into switching / waiting /
   genuinely overlapping. *(Recommend C → A, never B.)*
3. **T6:** remove the Plan/Focus switch in favour of `f` + "Start focus" + timer-start entries?
   And should the rail collapse during Focus?
4. **T10:** a (flat multi) · b (multi with an owner) · c (single + subtasks)? *(Recommend b.)*
5. **T1:** nesting by dragging right (a) or moved to the menu/⌥ (b)?
6. **T8:** `#` = tag only (buckets via pill)? Reserve `+` for assignee and `!` for priority?
7. **T13:** what should happen to completed tasks by default: hide, bottom, or N days? Auto-archive
   after how long?
8. **T19:** at midnight, should unfinished queued tasks silently drop, carry over automatically, or
   be offered back in a strip?

## Design-system proposals

1. **`NavRow`** — the rail row for every module:
   - icon · label · trailing slot that swaps **count ⇄ actions** on hover/focus/menu-open;
   - states: active, drop-target, dragging;
   - replaces four hand-rolled rails.
2. **`FilterBar` + `FilterChip` + `DisplayMenu`** — dimension → operator → values, chips with ×,
   and one Display popover (group / sort / completed / properties). Shared by Tasks, Contacts,
   Notes and Email.
3. **`MetaCount`** — icon + number (tags, attachments, comments, subtasks). One quiet indicator
   language for rows and cards.
4. **`AvatarStack`** — 1–3 avatars + "+n", used for assignees and presence.
5. **Drag-and-drop visual tokens** — one drop-indicator line, one drop-target highlight, one
   drag-overlay style across modules. Today Tasks has four different selection/drop treatments.
6. **`SmartInput`** — a text field that highlights parsed tokens (dates, `#tags`, `@people`) as you
   type, like Todoist. Used by capture, search and the global capture bar.
7. *(later)* **Focus mini-player** — the desktop always-on-top timer window (T6c).

---

## Appendix A — competitor patterns (Oct 2026)

_Sources: official help centers and changelogs (Linear, Todoist, Things, TickTick, ClickUp,
Notion, Sunsama, Akiflow, Amazing Marvin, Superlist). Asana claims rest on help-center snippets and
forum threads because its pages didn't render. Height shut down in Sep 2025. Observed-not-documented
items are marked (obs)._

| Topic | Linear | Todoist | Things | TickTick | ClickUp | Notion | Sunsama / Marvin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Reorder vs sort** | Manual order only; cross-group drag rewrites the field | Manual only when ungrouped | Free reorder; ⌘↑/↓ | Free; drag-right = subtask | Sorting disables in-group drag; cross-group OK | Sort locks manual | — |
| **Drop on sidebar** | not documented | "Move to…" (drag obs) | Yes, any list | Yes: list / smart list (sets date) / tag (adds) | Menu / bulk bar | — | Marvin: drag into day |
| **Multi-select** | `X`, ⇧-click, hover checkbox | Web/desktop | Yes + ⇧⌘M move | Box-select + batch bar | Bulk toolbar | Yes | — |
| **Filter UI** | `F` → type value; is/is not/any; Advanced AND/OR; in URL; saved views | Query language + Display-menu filters with count badge | Tag bar (only if tags exist) | Normal + Advanced; search → save as filter | ~25 dims; AI filter; filter seeds new tasks | Chips → advanced; per-person or shared | — |
| **Group / sort** | One Display popover; sub-groups; property toggles | Group/sort per view, personal | Fixed | Smart "Time" groups (Today/Tomorrow/7 days/Later) | Multi-sort; subtask modes | Group + sub-group; multi-sort | — |
| **Search** | `/` global (incl. comments); ⌘F in-view; `@user` → filter | `/` incl. comments; `search:` in filters | Type-anywhere, "Continue search" widens | Search page → filter | In-view | — | — |
| **Assignees** | **Single, by design** (accountability); `A`, `I` | **Single**; `+name` in Quick Add; "Me and Unassigned" | — | Single; per-list "only mine in Today" | Single default; **multi = admin opt-in**; Me Mode | Multi (People) | — |
| **Tags at creation** | Picker + `L` | `%label` inline (moving off `@`) | ⇧⌘T, per-tag hotkeys | `#tag` inline | — | — | Akiflow `#` = project |
| **Tags on rows** | Display toggle | Chips (obs) | Inherited tags grey/hidden | — | "Hide tags from name" | Property toggle | — |
| **Images** | `/file`, ⌘⇧U; comments | Files in comments (5 MB free) | None (links only) | Inline; strict free limits | Split drop zone (attach vs comment); covers pinnable | Blocks; card preview source | — |
| **Sidebar counts** | No counts; unread = number or dot | Count ⇄ "…" same slot (obs); setting to hide | (obs) counts | Right-click menu | Hover "…" | Hover "•••" + "+" | — |
| **Plan vs do** | My Issues "focus" order | Smart-sorted Today | Today + This Evening + Daily Review | Focus tab + "Start Focus" on task | — | — | **Sunsama:** planning ritual (`P`) with capacity warning; Focus via `F` / nav / timer start; floating Focus Bar. **Marvin:** funnel → Today (capacity) → Super Focus (`F`) |
| **Row config** | Display property toggles | Fixed | Fixed, context-aware | — | Many toggles + "has X" icons | Per-view properties, card size | — |

**The ten patterns most worth stealing**

1. **One rule for manual order:**
   - reorder within a group needs Manual;
   - cross-group drag always works and rewrites the field;
   - when blocked, *say why*.
2. **Sidebar drop targets, including smart ones:** bucket = move, Queue = commit. Multi-select
   aware.
3. **`F` filter chip bar** with type-to-jump. Simple operators; boolean logic only behind
   "Advanced".
4. **Filters seed new tasks** (ClickUp).
5. **One Display popover:** group / sort / show completed / properties, personal by default.
6. **A "Time" grouping** (Earlier/Today/Tomorrow/This week/Later) **and Energy grouping**. No
   competitor has energy.
7. **Single owner + escape hatches** is the consensus. If we go multi, keep an owner.
8. **One token per property** across capture, search and filters (`#` tag, `+` person, `!`
   priority).
9. **Rows show indicators, detail shows content:** tag/attachment/comment counts, never chips or
   thumbnails.
10. **Focus is entered from a task (`F`) or by starting a timer, and lives in a floating bar on
    desktop.** Planning is a short, optional ritual with a capacity mirror.

## Appendix B — focus, multitasking & background timers

### B1. How others start and show focus

| App | Entry | Visible outside the window | Away / sleep / idle |
| --- | --- | --- | --- |
| Sunsama | `F` on a hovered task; "Focus" in the left nav; starting a timer with Space | **Focus Bar** — floating, always on top; global ⌘⇧Space | Timer keeps running through sleep and quit (a user reported **52 h**); no idle detection |
| TickTick | Focus tab + "Start Focus" on a task; Pomo or Stopwatch | Floating window; iOS Live Activities | Focus records attach to the task |
| Amazing Marvin | ▶ on each task | Draggable floating box; tray/menubar | One tracked task at a time (implied) |
| Motion | ▶ on a task → focus banner | Banner | On stop: "how long did you work, how much is left?" |
| Toggl Track | Timer bar | Menubar + pinnable mini-timer | Idle prompt: Keep / Discard / Discard & continue / Add as new entry |
| Harvest | Timer | Menubar | Idle alert at 10 min: stop and remove · continue and remove · add as entry |
| Timing (macOS) | Automatic + manual timers | Menubar | Asks "what did you do?" after ≥5 min away; manual timers keep running (they record intent) |
| Super Productivity | ▶ on a task; full-screen focus (Pomodoro / Flowtime / countdown) | — | Idle dialog: Break / Task+Break / **Split** across tasks |
| Tiimo | Focus tab, auto-starts for scheduled tasks | Live Activities / Dynamic Island | Help text implies several timers can run (unverified) |
| Llama Life, Session, Flow, Forest | One timebox; menubar Pomodoro; tree-dies-if-you-leave | Menubar / big visual timer | — |

**Patterns**

1. **Entry is a per-task action** (▶, `F`, Space). A "Focus" nav entry is the second way in.
   **Nobody puts a mode switch inside the list rail.**
2. **Every serious desktop tool keeps the timer visible outside the main window** (floating bar,
   mini-timer, menubar).
3. **Nobody else loses time in the background.** Their failure is the opposite: *runaway* timers.
   Once we use wall-clock time, we need a "while you were away" answer.
4. **Time away** is handled by a prompt (Toggl, Harvest, Timing, Super Productivity), a silent
   auto-pause (Rize, Timing auto), or nothing (Sunsama). Every prompt boils down to **keep /
   discard / split**.

### B2. Concurrent timers

**Toggl, Clockify, Harvest and Everhour all refuse two timers at once.** Everhour: users "are not
supposed to be doing two things at the same time". Tiimo is the only one found that allows it.
Super Productivity splits time *after the fact*.

**Why they refuse:**
- totals stop adding up to real time, which breaks reports, estimates and billing;
- it's unclear whose time to cut when the user goes idle;
- it's a deliberate stance.

**What they offer instead:** fast switching, tagging an interruption, splitting afterwards, and a
separate passive record.

### B3. What the research says (honestly)

- **Each task switch has a cost (solid).**
  - Rubinstein, Meyer & Evans 2001 found switch costs. The popular "40% productivity loss" is an
    extrapolation, not a measurement.
  - **Attention residue** (Leroy 2009): leaving a task unfinished drags your attention into the
    next one.
  - Leroy & Glomb 2018: a **~1-minute "where I left off / what's next" note** measurably reduces
    that residue. **This is directly buildable into a switch action.**
- **"Multitasking damages you" is contested.** The Ophir/Nass media-multitasker effect shrinks to
  non-significant after bias correction (Wiradhany 2017).
- **Real parallel work exists.**
  - Tasks that don't compete for the same mental resource interfere little (threaded cognition),
    e.g. a render running while you write.
  - The real cost is *remembering to check back* (prospective memory, Smith 2003). Handing that
    to a reminder is what the evidence supports.
- **ADHD.**
  - Moderate deficits in switching mental sets (Willcutt 2005, Boonstra 2005; adult lab results
    are mixed).
  - Consistent **time-perception deficits** (Marx 2021). This argues for showing elapsed time and
    never relying on the user to remember how long they were away.
  - **Hyperfocus**, including difficulty stopping, is linked to ADHD symptoms (Hupfeld 2019), but
    the concept is under-defined.
  - **Body doubling**: early evidence only. The "interest-based nervous system": a clinical
    framing, not tested.
  - **Scheduled breaks** (incl. Pomodoro) beat self-chosen breaks on fatigue (Biwer 2023, not
    ADHD-specific).

**Takeaway — "multitasking" is two different things.**

- **Attention multitasking** means interleaving two demanding tasks. It has a real per-switch
  cost, probably worse with ADHD.
- **Overlapping work** means one attention thread plus something running on its own. It costs
  only the check-back.

### B4. Design options for T3

| | Option | For | Against |
| --- | --- | --- | --- |
| A | **One attention timer + "Waiting" items.** Mark a task *Waiting on…*, optionally with a check-back time; a notification brings it back; wait time is logged separately | Fits overlapping work; offloads the check-back; honest focus data | Doesn't cover "really doing two things"; needs a waiting state |
| B | **True concurrent timers** | Literal ask | Totals exceed real time; corrupts estimates and stats; idle handling ambiguous; the pros all decline it |
| C | **Fast switching with split time** — one key "switch to…", optional one-line "where I left off" note, quick-capture an interruption, split afterwards in the away prompt | Honest data; strongest research support; matches how people actually bounce | Still sequential; the switch must be truly one step |
| D | **No multitasking**, just fix the timer | Simplest | Ignores Mike's real need |

**Recommendation: C, then A, never B.**

- **C** comes first, on top of T3's session / active-task split.
- **A** is the honest version of "parallel", and replaces the vaguer "background slot".
- **Before deciding,** get three concrete examples from Mike and sort each into *switching* (C),
  *waiting* (A) or *genuinely overlapping* (B).

### B5. Background-accurate timers — the fix pattern

1. **State:** `{taskId, segmentStartedAt, accruedBefore, running, mode, phase, phaseStartedAt,
   phaseDurationMs}`.
   - Elapsed = `accruedBefore + (Date.now() − segmentStartedAt)`.
   - The 1 Hz interval only repaints.
   - Use `Date.now()`, not `performance.now()`, which **freezes during sleep** in WebKit on macOS.
     Guard against clock jumps.
2. **Recompute** on tick, `visibilitychange` and window focus.
3. **Persist the running session** to localStorage, plus a Supabase "running session" row, so it
   survives reload, crash and a device switch.
4. **Store work as `[start, end]` intervals** (time entries, T17), not accrued seconds. Then
   trimming idle time and splitting are trivial.
5. **Gap detection:** if more than ~90 s passed since the last tick, the app was suspended or the
   machine slept. Show "while you were away" rather than silently crediting the time.
6. **Pomodoro catch-up:**
   - Credit work only up to the scheduled end of the phase.
   - Never auto-start a new work phase while the user is away. Park it as "break's over —
     resume?".
   - Say what happened, e.g. "Your 25-min focus ended at 14:25".
7. **Phase-end alerts while backgrounded:** schedule them from **Rust** (tokio sleep; fire at once
   on wake if overdue) and use **`tauri-plugin-notification`**. `backgroundThrottling: "disabled"`
   (Tauri ≥2.3, macOS 14+ only) also makes JS timers fire on time, at some battery cost. Measure it
   before relying on it.
8. **Idle detection (later):**
   - **Desktop:** the `user-idle2` crate (macOS `CGEventSourceSecondsSinceLastEventType`), polled
     every ~30 s while a session runs.
   - **Web:** visibility + gap detection only. The Idle Detection API is Chromium-only.
   - Use a generous default (10–15 min) with an off switch: meetings and paper work cause false
     positives.

**"While you were away" prompt:** a quiet, non-modal chip state offering **Keep · Discard ·
Discard & continue · Count as break · Split / assign**. It's a mirror, not a wall.

_Sources (inline in the research hand-off): help centers of Sunsama, Toggl, Harvest, Timing,
Motion, Super Productivity, TickTick, Tiimo; Chrome timer-throttling blog; WebKit bugs 107494 /
225610; wry PR 1445; tauri-utils `BackgroundThrottlingPolicy`; Rubinstein et al. 2001; Leroy 2009;
Leroy & Glomb 2018; Mark et al. 2008; Wiradhany & Nieuwenstein 2017; Salvucci & Taatgen 2008;
Smith 2003; Willcutt 2005; Boonstra 2005; Marx 2021; Hupfeld 2019; Biwer 2023._
