# Lane 1 · Part C — Board, Timeline, Drag and drop (code audit, `maciej` @ 95d988b0)

> Raw research report from the Tasks re-plan, 2026-10-09 (`maciej` @ 95d988b0), kept for its evidence. The synthesis and the open calls are in [../REPLAN.md](../REPLAN.md). Nothing here is decided.

**Legend** (all under `src/features/tasks/`): B=`ui/task-board-view.tsx` · C=`ui/task-card.tsx` · T=`ui/task-timeline-view.tsx` · G=`timeline-geometry.ts` · TD=`timeline-drag.ts` · D=`ui/dnd/task-dnd.tsx` · R=`reorder.ts` · P=`ui/tasks-plan-view.tsx` · L=`ui/task-list-view.tsx` · M=`hooks/use-tasks-module.ts` · H=`helpers.ts` · TM=`ui/task-meta.tsx` · TR=`ui/task-row.tsx`. dnd-kit sources: CORE=`node_modules/@dnd-kit/core/dist/core.esm.js`, SORT=`node_modules/@dnd-kit/sortable/dist/sortable.esm.js`. Bare filenames (`queue.ts`, `completed.ts`, `display.ts`, `recurrence-engine.ts`, `row-layout.ts`, `use-tasks-display.tsx`, `assign-context-menu.tsx`, `plan-view-header.tsx`, `bucket-rail.tsx`) live in `src/features/tasks/` or its `ui/`. Other paths start at `src/`, unless they begin with `supabase/`, `e2e/` or `node_modules/`.

## Board view
**(a) Today**
- Columns = status `todo · in_progress · done` (archived never) B:75-77,177-185, or bucket (Inbox + every bucket, empty ones too) B:165-176. "Columns" picker only in All / My tasks; every other scope is forced to status B:128-129,256-269. Persisted per workspace in localStorage P:113-115,239.
- Drag within a column writes `position` (B:244-246, R:47-62). Across columns writes `status` (`set_status` op, M:779-796) or `bucketId` (field write, M:797-813); B:247-251.
- Completed: Display Hidden/7 days/All, plus a per-column "N completed · show" line B:161-164,422-427. Cards stay when checked off, selected, the selected card's parent, or a parent with open subtasks B:149-160.
- Nested subtasks are left off the board; the parent card shows n/m B:134-145.
- Columns flex 280–400 px and scroll sideways B:298,381.
- Create = header "New" → capture modal: the task lands in the scope's bucket as todo, whichever column you're looking at (plan-view-header.tsx:52-57, P:355-356, H:215).

**(b) Can't do:** per-column add, WIP limits, column collapse, swimlanes, group by assignee/priority/date, sort, search, multi-select. No empty-scope state; the List has one (L:680-681).

**(c) Inconsistent with the List**
- The List has no drag reorder outside the Queue: grouped lists have no drag at all (L:753-796), a flat bucket list only nests (L:713-752). The Board reorders `position`, the same key that orders the List (M:185-189, R:43-44), so every Board reorder silently reorders the List.
- The Board can't nest.
- Bucket columns include empty buckets; List groups (H:351-364) and Timeline lanes (G:334) skip them.
- Column order ignores the rail's sections (B:166 vs H:443-462).

**(d) Legacy leaks**
- Inbox-as-bucket: Inbox is the first column; an unknown bucket id is labelled "Inbox" (P:311-317). *live*
- Buckets as the only container (B:38). *live*
- `group_label` sections ignored. *forgotten*
- Time-of-day picks the starting scope (P:258-282). *live*
- The Board exists only in Plan mode (P:656-683). *live*
- Scope id `"today"` = Queue; a comment still says "committed subtasks" (B:134-137). *transitional shim*
- Archived is filtered from every scope (P:321,325). *live*

**(e) Smells**
1. **Queue-scope reorder bug.** Cards arrive in queue order (P:320 → queue.ts:51-53), but `boardDropPosition` assumes position order (R:40-45,56-61). It writes `task.position` from queue neighbours (B:237-246; `a>=b` → H:154). The card snaps back to its queue slot while the bucket's List order changes. The List in this scope reorders the queue instead (L:563-574, P:693-694).
2. **Cross-column drops give no preview.** Each column has its own `SortableContext` (B:395-398), so dnd-kit turns transforms off in the destination (SORT:314,507) and no gap opens. The column tints only when `over` is the column itself (B:374,392). The drop always inserts *before* the hovered card (R:65-67).
3. **Permissions only show up on drop.** Droppables are gated by module `canEdit` (B:374). The server refuses moves into a bucket you can't edit (`supabase/migrations/20261008150000_tasks_assignee_creator.sql`:309-313), so the user sees an optimistic move, an error toast, then a bundle refetch (`void load()`, M:381-391).
4. **"7 days" uses `updatedAt` as completion time** (completed.ts:19-27). Reordering a done card brings it back.
5. In Queue scope the Board still applies the stored Completed setting (B:162), though the Queue's Display has no such control (display.ts:48-50) and the List ignores it there (L:195).

**(f) Accessibility**
- Cards are Tab stops through dnd-kit `attributes` (CORE:3406-3437); `role=button` uses `aria-pressed` to mean selected (C:94-97).
- Space/Enter lifts the card (CORE:1357-1368). There is no `onKeyDown` (C:91-118), so no key selects or opens a card. View-only cards are Tab stops that do nothing.
- Buttons sit inside the role=button (C:273-275,313). No j/k.
- Screen readers hear dnd-kit's default announcements, which read raw ids such as `col:status:todo` and UUIDs (CORE:43-75).

**(g) Scale (2,000 tasks / 60 buckets)**
- No virtualization or memo anywhere, and no virtualization dependency in `package.json`.
- Every card mounts `useSortable`, a Radix ContextMenu and tooltips.
- `columns` recomputes on every bundle change (B:186-198). Bucket mode filters all tasks once per bucket, O(n·B) (B:167-175).
- A flat subtask card looks up its parent with `api.tasks.find` (C:256): O(n²) in the Queue.
- 61 columns ≈ 17k px wide.

## Board cards
- **(a) Anatomy** C:270-331: check-off and title (muted when blocked), then one meta line: priority, energy (off by default), one date, counts (`#tags`, subtasks n/m, blocked, repeats; TM:69-120), bucket (cross-bucket scopes), a parent caption on flat subtasks, queue toggle (C:313), assignee (≥2 members; C:250-252).
- **Look:** done cards fade as a whole (C:108); selection is a tint (C:111).
- **Menu** (editors only, C:132-214): done, queue, skip occurrence, move to bucket, assign, priority, energy, delete.
- **(b) Missing:** Rename, Schedule…, Set due…, Detach, all present on rows (TR:358-386). No attachments or comments counts yet (TM:59-61).
- **(c) Date:** the card's date is plain text with no name or tooltip (C:295). The row's date cell is named and opens an editor (TR:512-574).
- **(d) No leaks.** The card uses `assigneeId`, not owner_id (C:251-253). Recurrence shows as a Repeat mark and "Skip occurrence" (C:146-150, TM:111-117).

## Timeline view
**(a) Today**
- **Zoom:** Week 120 px/day, Month 40, Quarter 14 (G:21-30). Month is the default and the choice persists per workspace (G:52-54, P:116-118).
- **Window:** the dated extent plus today, padded 21/45/120 days and capped at 120/400/800 days from today (G:33-49,94-120). Fixed, never infinite.
- **Bars** come from `scheduledAt` and `dueDate` only (G:221-267):
  - both dates → a solid span;
  - scheduled only → 1 day plus an 80 px fade to the right;
  - due only → fades in to the due day;
  - neither → the tray;
  - due before scheduled → healed to a 1-day bar (G:230-233).
- **Lanes:** buckets only. Inbox first, dateless lanes skipped, unknown buckets go to "Other" (T:146-149; G:325-334). Collapse lasts for this mount only (T:127-129).
- **Rows:** sorted by start day, then position, one row per task (G:338-343,387-391).
- **Today:** a line with a minute tick, a pill and a recenter button (T:133-142,442-444,505-532).
- **Arrows** are blocked-by relations, drawn blocker end → blocked start. They highlight on hover or selection and drop out when an end is hidden (T:597-645; G:415-435).
- No milestones, by design (G:9-12).
- A bar shows check-off, title, blocked mark and a past-date dot (T:1067-1096).

**(b) Can't do**
- No Display: done bars always show (P:652-653,685).
- No assignee lanes, no sort.
- No priority, assignee, tags, queue or recurrence mark on bars.
- No click-to-create.
- Arrows can't be deleted here (T:600 `pointer-events-none`).
- A drag can't go past the window edge (`dayAtX` clamps, G:132-136), and there is no edge auto-scroll.

**(c) Inconsistent with other views**
- Dated nested subtasks get their own bars (G:312-316); List and Board hide them (B:134-145, L:163-172).
- Neither of this wave's two Timeline items is in code: no attachment mark on bars (no attachment/paperclip hit in T), and selection is still a `ring-2` (T:1153), not the tint (C:111).
- Lane order is flat, though a comment claims rail order (G:291-292 vs H:443-462).
- The fallback lane is "Other" (G:328) where the Board says "Inbox" (P:314).
- The Timeline runs its own context nested inside the page's, so nothing drags from it to the hub to link (P:729-734).

**(d) Legacy leaks**
- `duration_minutes` isn't the bar length (G:226-252), but it is the Calendar's drop block size (`features/calendar/ui/calendar-page-view.tsx`:596-604). *Forgotten here, live there.*
- Single-row recurrence: one bar for the current occurrence. Catch-up moves `scheduledAt` but never `dueDate` (recurrence-engine.ts:121-124,147-150), so a recurring task with a due date degrades to a healed 1-day bar (G:230-233). *live, latent*
- One-level subtasks are enforced on write (H:531-542, L:589-602). The Board shows n/m only (B:134-145); the Timeline flattens dated children into their own bars (G:312-316). *live*

**(e) Smells**
- **Whole-tree re-renders.** Hover state lives at the root (T:131,1106-1107), so every enter or leave re-renders every bar. The minute tick re-renders the whole tree too (T:136-140), contrary to its comment (T:133-135). A connector drag sets root state on every move (T:372-380).
- **Arrows lag** a bar's drag preview (T:163-166 vs 1039-1047).
- **Deep links miss.** Tray chips have no `data-task-id` (T:777-797), so the deep-link reveal (P:596-610) can't reach undated tasks. Collapsed lanes render no bars (G:349).
- **Wrong hint for viewers.** The empty-axis hint "drag a task up" also shows to people who can't drag (T:651-657,766).
- **Recurring bars jump back.** Drag one earlier than its current occurrence and the next load's catch-up undoes it (recurrence-engine.ts:138-143).

**(f) Accessibility**
- Bars are unfocusable divs with no role or name (T:1135-1158). The check-off is their only keyboard stop, as the code says (T:1064-1066).
- A narrow bar's outside label is a clickable div (T:1192-1200).
- Arrows are `aria-hidden` (T:604).
- Move, resize and connect are mouse-only (T:1172-1176).
- Edge zones are `min(8px, width/3)` (T:989). A 1-day bar at Quarter is 14 px, so each zone is about 4.7 px.

**(g) Scale**
- No virtualization: every tick, lane and bar is in the DOM (T:520-563,869-886).
- The canvas runs to ~34k px wide at Week (283 days × 120 px).
- Two SVG overlays span the whole canvas (T:566-572,599-605): about 72k px tall at 2,000 bars.
- Done history widens the window and fills the lanes (G:94-104).

## Timeline tray (unscheduled)
- **(a) What it holds:** open undated tasks, minus nested undated subtasks (G:309-318). A collapsible strip, `max-h-28` (T:663-696). Click selects the task (T:782-788).
- **(a) Drag:** a chip dropped on a day sets `scheduledAt` to 09:00 that day; the due date is untouched (TD:46-57; G:460-486). A day wash shows where it will land (T:533-540).
- **(b)** No sort, filter or search in the tray; no keyboard scheduling (T:232-239, D:102-105). The lane you drop on is ignored; only the day counts (T:281-298).
- **(e) Bug: the drop target is only as tall as the lanes.** `LanesDropRegion` has `minHeight = totalHeight + 8` (T:515-518,745) inside a canvas with no height (T:478).
  - With no dated tasks, the droppable is an 8 px strip under the header.
  - Below the last lane is dead space. A drop must land inside the region's rect (T:247-253,296), so drops into the visible empty area do nothing.
  - That is exactly the empty case whose hint says to drag a task up (T:654-656). Gridlines and the today line also stop at the last lane (T:520-532).
- **(g)** 1,000 undated tasks, a typical student backlog, means 1,000 un-virtualized chips in a 112 px box (T:683-692).

## Timeline drag
- **(a) Engine:** a custom pointer engine per bar (T:942-1047):
  - 5 px slop (T:92);
  - the grab point picks start, end or move (T:989-991);
  - the preview runs through the same resolver as the commit;
  - Escape cancels (T:969-977);
  - three exits plus a `buttons==0` self-heal (T:1015-1019,1139-1141).
- **(a) Writes**
  - Move shifts every known date by whole days and keeps the clock time (G:444-458).
  - The start edge writes `scheduledAt` (a new one at 09:00); the end edge writes `dueDate` (a new one at local midnight). Both clamp and never invert (G:470-508).
  - The connector dot calls `addBlocker`; dropping on itself, an existing edge or a cycle does nothing (TD:66-78, T:401-406).
  - Every write is an optimistic `patchTask` field write (T:225-230, M:797-813).
- **(b)** Vertical drag is ignored, so a task never changes bucket (TD:31-44). No multi-bar drag, no undo. Done bars can still be dragged (T:979-983).
- **(c)** The Calendar's drop writes the pointer's time plus a duration (`features/calendar/ui/calendar-page-view.tsx`:596-604); the Timeline writes 09:00 and no duration.

## DnD system
**(a) What exists**
- dnd-kit core 6.3.1 + sortable 10 (`package.json`:49-51).
- One shared vocabulary for payloads, targets and sensors (D:41-117): pointer drags start after 6 px, plus a keyboard sensor (off on the Timeline).
- One page-level `DndContext` (P:735-770,874). List and Board subscribe through a monitor (D:155-219). The Timeline nests its own context (T:468-475).

**(a) What drags where**
- Queue row → reorders my queue (L:563-574).
- Childless row in a flat bucket list → nests under a top-level row (L:576-630).
- Board card → reorders or moves (B:219-252).
- Row or card → the hub, which links them (P:790-833).
- Tray chip → a day; bar → its dates; connector dot → a blocker edge.

**(a) Order**
- `position` is a Lexorank-style key that subdivides, so gaps never run out (H:123-162).
- It is one global sort across all buckets (M:185-189). Queue order is stored separately, per user (queue.ts:48-53).
- No view has a Sort control; the List only groups (L:104-110). Spec §8's "sorted" note has no code.

**(a) Undo:** none for drag writes (M:742-825). Only hub links (`features/spine/ui/drop-link-toast.tsx`:5,75) and delete (M:1175) offer Undo.

**(b) Not built**
- Rail buckets, the Queue and My tasks aren't drop targets: no dnd import in `bucket-rail.tsx`:1-20.
- Nothing drags from Tasks to the calendar. Calendar's own panel reuses `taskDrag(…,"list")` (`features/calendar/ui/calendar-tasks-panel.tsx`:169,236).
- No Board nesting, no reorder in non-Queue lists, no multi-drag.

**(e) Smells**
- The `column` target variant is declared but unused (D:73-74). Columns resolve by an id prefix instead (B:229,374).
- External mode drops each view's own sensors (D:175-177), so the List's nest sensor (L:152-153) is dead in the app.
- Drag styling is hand-rolled per view:
  - overlays: B:323, L:745, T:702;
  - drop targets: B:392, TR:163;
  - source opacity: 0 (C:116), 60 (D:278), 50 (D:345, T:794).
  - The shared values (`components/ui/drag-visuals.tsx`:27-34) go unused in Tasks.

**(f) Accessibility**
- No `accessibility` prop on any context, so screen readers get raw ids (CORE:43-75).
- Only Board cards can be keyboard-dragged. List rows have no `tabIndex` (TR:145-152), and D:91-93's "focus the grip" is stale: there is no grip.

## DS-4 components: shipped vs reachable
- **FilterBar, FilterButton, FilterChip, FilterMenu + `filter-model`** (`components/ui/filter-bar.tsx`:398,476,502): no importers outside their own stories and tests. **Present, not reachable.** Tasks uses the tags-only `TagFilterButton` instead (P:614-633).
- **DisplayMenu + view-prefs:** reachable through `use-tasks-display.tsx`:78-85, List and Board only (P:653). Two controls: Completed and Show on rows (display.ts:20-50).
  - Stored per scope in localStorage (display.ts:60-63, `lib/view-prefs.ts`:64).
  - That runs alongside the page's own `lsKey` store for view, group and zoom (P:75-93). Neither syncs.
- **InsertionLine, DragOverlaySurface, NestPreview** (`components/ui/drag-visuals.tsx`:50-135): no importers. **Present, not reachable.**
- **DRAG_SOURCE / DROP_TARGET:** only NavRow uses them (`components/ui/nav-row.tsx`:276-277). No caller passes `dropTarget`; Contacts passes only `dragging` (`features/contacts/ui/contact-directory.tsx`:176). So `DROP_TARGET` is **not reachable**.

### C-matrix
| Capability | Board | Timeline |
|---|---|---|
| create | partial: header New only, lands as todo (P:355-356) | partial: header New only |
| edit inline | partial: menu for priority/energy/bucket/assignee/done, no rename (C:135-213) | partial: dates by drag, check-off (T:1069) |
| reorder | Y in a column (B:244-246); broken in Queue scope | N: sorted by date (G:338-343) |
| nest | N | N |
| multi-select | N: one `selectedTaskId` (B:53-54) | N |
| bulk | N | N |
| group | partial: status, or bucket in All/Mine only (B:128-129) | partial: fixed bucket lanes (T:146-149) |
| sort | N | N: fixed (G:338-343) |
| filter | partial: tags, OR (P:330-338) | partial: same |
| search | N | N |
| show completed | Y (B:161-164,422-427) | partial: done bars always shown, tray never (G:317, P:652-653) |
| keyboard nav | partial: Tab + lift, can't open (C:91-118, CORE:1357-1368) | partial: Enter on a tray chip opens it; a bar exposes only its check-off (T:778-788,1064-1066) |
| DnD across | Y: status or bucket (B:247-251) | partial: tray → day only (TD:31-57) |
| open detail | Y: click (C:100) | Y: click bar or chip (T:1098-1105,782-788) |
| schedule | N: detail panel only (C:135-213) | Y: drop, start edge, move (G:444-495) |
| set due | N: detail panel only | Y: end edge (G:497-508) |
| assign | Y: menu (`assign-context-menu.tsx`:18-49) | N |
| queue | Y: toggle and menu (C:142-145,313) | N |
| start focus | N | N |
| see subtasks | partial: n/m only (B:134-145, TM:102-109) | partial: own bars, no link to parent (G:312-316) |
| see dependencies | partial: blocked mark (TM:110) | Y: arrows + connector (T:597-645,1172-1187) |
| see attachments/comments counts | N (TM:59-61) | N |

### C-top smells (ranked; details above)
1. Empty timeline can't take a tray drop: the target is an 8 px strip (T:478,515-518,745,247-253,654-656).
2. Queue-scope Board reorder writes `position` from queue neighbours; the card snaps back and the List order changes (P:320, queue.ts:51-53, B:237-246, R:56-61).
3. One global `position` and no drag Undo: Board reorders rewrite List order (M:185-189, L:753-796, M:742-825).
4. No cross-column preview; the card inserts before the hovered one (SORT:314, B:374,392, R:65-67).
5. Accessibility: UUID announcements; cards lift but don't open; rows and bars can't be focused (CORE:43-75, C:91-118, TR:145-152, T:1135-1158).
6. Bucket permissions surface only after the drop, as an error toast and a bundle refetch (B:374, migration :309-313, M:381-391).
7. The Timeline re-renders everything on hover, each minute and while connecting; no virtualization; canvas-sized SVGs (T:131,136-140,372-380,566-605).
8. Recurring tasks with due dates degrade to 1-day bars (recurrence-engine.ts:121-124,147-150; G:230-233).
9. "7 days" goes by `updatedAt`, so dragging a done task resurfaces it (completed.ts:19-27).
10. DS-4 drag visuals and FilterBar are unreachable; four hand-rolled drag treatments remain (`components/ui/drag-visuals.tsx`:134-135, `components/ui/filter-bar.tsx`:502).
11. Dead contract parts: the unused `column` target and dropped per-view sensors (D:73-74,175-177).

### Could not verify
- Nothing was run live (`e2e/tasks/timeline.spec.ts`:12 skips without `E2E_APP_URL`). Above all: the 8 px tray strip, the insert-before drop, and whether a drop's trailing click also selects the card.
  - Repro for the strip: pick a scope with only undated tasks, drag a chip into the visible empty canvas, and expect no `scheduledAt` write.
- The 2,000-task / 60-bucket degradation point: no benchmark.
- Whether `closestCorners` turns a drop just under a column's last card into "before it". Reasoned from the math, not observed.
- Whether subtasks follow a parent's bucket move on the server. The client sends one row (M:797-813); I didn't open `20260612130000_tasks_add_parent.sql`.
- Whether `api.buckets` includes view-only buckets, which would render as drop columns.
- Keyboard nesting in the app. The page uses `sortableKeyboardCoordinates` (P:735), which needs a droppable with the active's id (SORT:732-737), but the nest droppable is `onto:<id>` (D:330-333), so the arrows likely do nothing. Moot while rows can't be focused.
