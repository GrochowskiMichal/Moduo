# Lane 2 — Element-by-element visual and interaction audit of Notes

> Raw research report for the Notes v2 re-plan, 2026-10-13 (`t/maciej/notes-replan`). Storybook shots are at 9a8887ae; the live app was a dev server on the shared worktree, so it hot-reloaded as other sessions committed (HEAD reached 2073f4ef, including the Tasks v3 merge). **No Notes-owned file changed** in that range (`src/features/notes`, `notes-page.tsx`, `published-note-page.tsx`). Kit/spine files that did change mid-run: `ui/avatar.tsx` (team-mark colour), `ui/dropdown-menu.tsx` + `ui/context-menu.tsx` + new `ui/menu-scroll.ts` (scrolling menus fade at the foot), `ui/feed.tsx` + `spine/ui/comments-panel.tsx` (reaction and ⋯ slots on comment cards), `ui/group-header.tsx`, `ui/date-field.tsx`, `spine/references/ui/date-chip.tsx` (weekday date in the hover), `spine/editor/mention-menu-plugin.tsx` (team colour), `global.css` (menu fade + print layout). None of them changes a finding below; where it matters it's noted. The synthesis and the calls go in [../REPLAN.md](../REPLAN.md) §5. Nothing here is decided. Format and rigor copied from the Tasks audit ([../../tasks-v3/research/visual-audit.md](../../tasks-v3/research/visual-audit.md)).

**How it was measured.** Storybook 10.6 on :6108 for the stories that exist (`notes-notetreesidebar--{default,empty-workspace,view-only}`, `notes-tasklinestates--all-states`, the spine hub/ref-chip/suggestion stories, and the DS-6 kit `Densities` stories as the baseline). Everything else in the **live local app** (web build on :8111 against the local Supabase stack, never the cloud), signed in as the seeded dev user, in a new workspace named **"Notes replan visual audit"**, plus the seeded teammate added to it as a viewer for presence and read-only. Playwright/Chromium 1228, 1440×1000 @2×, dark first, densities comfortable/compact/dense, a light spot-check. Numbers are **computed styles** (px, comfortable, dark) unless marked "code". Contrast is WCAG 2.x, measured in the page (colour converted through a canvas, alpha composited over the real background).

**Rendered live:** sidebar (rows, sections, search, ⋯ menu, drag into/before/over the editor), the editor with every block type typed in through markdown shortcuts and the slash menu (title line, paragraph, bold/italic/inline code, H2/H3, bulleted + nested, numbered, checklist incl. a checked item, quote, divider, 3×3 table, task lines, page row, RF-1 note reference, code block), slash menu + its picker stage (`/task`, `/note`), the `@` menu, the format toolbar, the selection, the right panel's title dropdown with Detail · Comments (two comments incl. a quote-comment) · Outline, the embedded Task detail, presence avatars (two browsers), the share popover, the publish popover (published), the import dialog, the viewer (read-only) view, empty workspace, Home.
**Code only:** the mindmap embed (Mindmap is hidden), the public page `/p/<token>` (the local stack's `notes-public` function answers 503, so the live page only showed its error state), loading/degraded/offline/trash states (not reproducible on demand), the Home "Notes" widget (the default Home grid had no free slot and the gallery's Add didn't place it in a headless run). **No story for:** the editor, slash menu, `@` menu, format toolbar, right-panel views, presence, publish, import, public page. Only the tree and task-line states have stories.

Screenshots and measurement dumps: session scratchpad `shots/sb/` and `shots/live/` (ephemeral; index at the end of §F). Scripts: copies of the Tasks harness with paths fixed, plus a contrast probe.

## 0. Headline

Notes passes the lint gate — **zero** raw hex, arbitrary values or duration utilities in all 37 Notes-surface files — and that is exactly why it looks finished in code review while still being the least "north-star" module in the app. Almost nothing Notes owns is built from the DS-6 kit: no Row, NavRow, GroupHeader, MetaCount, EmptyState, drag visuals or `FLOATING_SURFACE`; **18 legacy `bg-accent` hovers against 3 `state-hover`**, **26 full-strength focus rings against 0 of the kit's `/50` ring**, 25 hand-rolled buttons, 40 hard-coded icon sizes, 19 `border-border` edges and not one `border-hairline`. The editor is a second design system living in `global.css` (`.notes-*`): the first line (title) and an H1 are the same 30/600, body text is 14 px while Tasks titles are 15 px and table cells 13 px, the divider has **no style of its own** (preflight's 1 px rule in the text colour, 20:1 — the brightest line in the app), and every other edge in the document (quote bar, code, table) sits at 1.1–1.2:1, i.e. invisible. Five floating surfaces inside one editor (slash, picker, `@`, format toolbar, task-line menu) use five hand-made shells with no `motion-pop`. **None of the editor's own chrome responds to density** (tree rows 26.6 px at every density); only the pieces borrowed from the kit (RF-1 reference chip, Publish button, panel toggle) do. The floating top-right cluster (presence · Share · Publish · panel toggle) sits over the document and collides with text when you scroll, and its panel toggle duplicates the bottom bar's (48b). If Email compose, Chat or task descriptions copied Notes today, they would copy all of it.

## A. Element-by-element audit

### A1 · Sidebar tree (`note-tree-sidebar.tsx`)

| Part | Measured | Tokens / code | States | Verdict |
|---|---|---|---|---|
| Header | "Notes" 13/600 display; Import + New `IconButton` 26 px (22 dense) | `Toolbar gap="tight"` ✓ (:212) | — | Fine. The only density-aware thing in the sidebar. |
| Search | native `<input>` 230 × 30.6, 13 px, `bg-muted` (lab 5.3), radius 8, 14 px glyph; clear `×` 18 px target | :227–243, not `Input` | focus `ring-2 ring-ring` (full strength); same 30.6 px at all densities | ✗ native input + density-blind + off-recipe focus. |
| Section labels | Pinned · Inbox · Workspace · Published · Archive · Trash: 11/500 uppercase, tracking 0.44, secondary 7.99:1 | `Eyebrow` ✓ (:760) | never collapse, **no counts** | Fixed chrome, so caps are allowed (40). But no counts anywhere and no collapse: the tree hides nothing, so 45's "nothing hidden without a count" isn't broken — yet. |
| Note row | **26.6 px at comfortable, compact and dense** (NavRow kit: 36 / 32 / 28); 13/400 body; pad 4·6·4·8; gap 4; radius 8; indent `style={{ paddingLeft: 8 + depth*14 }}` | hand-rolled `div.group` (:533), not `NavRow` | rest = **secondary** (7.99:1) → hover `state-hover` + foreground; selected `SELECTED_ROW` (13 % tint + hairline) ✓ 14.3:1; untitled = italic secondary | ✗ density-blind; ✗ 1 px smaller and lighter than NavRow (14/500); unselected titles read as metadata (38: titles are primary). Selection recipe ✓. |
| Row icon | emoji 14 px in a 16 px slot, or `FileText` 16 px | `size-4` hard-coded (:506) | — | Off the icon ladder (`size-icon-*`). |
| Expand / + / ⋯ | three 18 × 18 buttons (`p-0.5` + 14 px glyph) | raw `<button>` ×3 (:553, :602, :654/:680) | reveal: `opacity-0 → group-hover:opacity-100`, reserves space ✓; Tailwind default 150 ms, not `--motion-fast` | ✗ targets under 24 px (R13); ✓ reveal pattern. |
| Trash "Nd" | 12 px secondary | `hidden … group-hover:inline` (:589) | — | ✗ reveal-by-mount (R6): the row reflows on hover. |
| Published rows | 3rd row recipe: `text-muted-foreground hover:bg-accent/60` + 14 px globe | raw `<button>` (:331) | no selection state at all | ✗ legacy token, different recipe, can't show which one is open. |
| Search results | 4th row recipe: two lines, 13 px title + 12 px 2-line snippet | raw `<button>` (:257) | `SELECTED_ROW` ✓ / `state-hover` ✓ | Different height and anatomy from tree rows. "Archived" 2xs tag. |
| ⋯ menu | 192 px, items **30.6 px fixed**, 13 px, 16 px icons; Icon › emoji grid (6 × 12, `hover:bg-accent`), Pin, Duplicate, Export as Markdown, Export subtree as .zip, Archive, Delete | `DropdownMenu` + `FLOATING_SURFACE` ✓ (hairline edge 1.29:1, shadow 0 4 12 /.45) | item transition 150 ms `cubic-bezier(.4,0,.2,1)` (Tailwind default, not a motion token) | Surface ✓; items density-blind (same as Tasks B6). |
| Drag | source `opacity-50` (`DRAG_SOURCE` = 40); overlay `bg-popover border-border shadow-md` 208 × 28.6; "into" = `ring-2 ring-primary/60`; before/after = hand-drawn 2 px `bg-primary` line; over the editor = `ring-2 ring-inset ring-primary/40` on the whole pane; over the hub = `HubDropZone` | :400–405, :542–551, `notes-page.tsx:937` | **the overlay sits on top of the target row and hides it** (shot `sidebar-drag-into`) | ✗ four drop recipes, own overlay, own opacity; none of `DROP_TARGET` / `InsertionLine` / `DragOverlaySurface` / `DRAG_SOURCE`. |
| Pinned | the same note appears twice (Pinned and Inbox) — seen in the story's data, not reproduced live | `buildNoteSections` | — | Duplicate rows; a plan question, not a styling one. |
| Section move | live: a root note jumped from **Inbox** to **Workspace** the moment it got its first child (via `/page`) | `tree.ts` | — | Surprising to a person; plan question (IA). |
| Empty / view-only | "Nothing captured yet" 12 px secondary; viewer: no Import/New ✓ | :305 | — | Plain text, not `EmptyState`. |

### A2 · Centre pane and editor shell (`notes-page.tsx`, `note-editor.tsx`)

| Part | Measured | Tokens / code | Verdict |
|---|---|---|---|
| Sheet | the editor scroller is `bg-background` (black, lab 0) inset by the centre panel's 16 px padding inside its `bg-card` fill (lab 2.5, `rounded-xl border-border p-4`) | `note-editor.tsx:396` | ✗ a black sheet inside a grey frame: the only centre pane in the app drawn as a box in a box. |
| Column | `max-w-3xl` = 768 (720 text), `px-6 pt-10 pb-24` | :402 | Fine width; padding not density-bound. |
| Floating cluster | `absolute right-3 top-3 z-10` over the document: presence · offline chip · **Share** (ghost sm 26) · **Publish** (ghost sm 26) · panel toggle (`IconButton` 26, `aria-pressed`, 9 % fill when open) | `notes-page.tsx:648–695` | ✗ **collides with text when scrolled** (shot `at-menu-open`: "Publish" over the `npm run dev` code pill). Its panel toggle duplicates the bottom bar's `»` (48b: panel toggles live in the bottom bar). Note actions have no header row of their own. The three buttons scale with density ✓ (26/24/22). |
| Title (first line) | **30/600 display, lh 36, tracking −0.45**, margin-bottom 12 | `global.css:444–456` | ✗ identical to H1 (30/600): an H1 inside a note reads as a second title. Placeholder "Untitled" `text-muted-foreground/60` (decorative, allowed). |
| Body | **14/400, lh 23.1 (1.65)**, primary 20.1:1, paragraph gap 10 | `text-base leading-relaxed` (:402), `.notes-p` | Readable. But Tasks titles are 15 px, Notes prose 14, tables 13, code 13, inline code 12.25: four content sizes for one "content" role (R4). |
| Density | title, body, headings, lists, table, code, task lines, page rows: **identical at comfortable / compact / dense**. Only the RF-1 chip (24/22/20) and the cluster buttons scale | — | See plan question Q1 (prose vs chrome). |
| Selection | browser default highlight (not a token) | — | Minor; one selection colour app-wide is 39's intent. |

### A3 · Editor blocks (`global.css` `.notes-*`, theme map `note-editor.tsx:353–381`)

| Block | Measured | Verdict |
|---|---|---|
| H2 / H3 | 24/600 lh 28.8 · 20/600 lh 24; margins 20 / 8; display face | Steps OK (30 → 24 → 20). H1 = title (A2). |
| Bulleted list | 14 px, marker secondary 8.42:1 ✓, nested circle → square, pad-left 24, item gap 3 | ✓. Numbered list pads 28 → bullets and numbers start 4 px apart. |
| Checklist | 16 px circle, border `muted-foreground` 50 % = **2.68:1 dark / 1.86:1 light** (non-text needs 3:1); the circle sits **~2.5 px low** (centre 14 px vs text centre 11.5 px); checked = primary fill + a **text "✓" at 12 px**, visibly off-centre; hover border → foreground ✓; transitions on `--motion-fade` ✓ | ✗ mimics `CompleteToggle` by CSS but differs (glyph, alignment, contrast). Clicking it leaves a full-width focus ring round the whole line (shot `after-l5`). 16 px target. |
| Quote | **3 px left bar** in `--border` = **1.22:1** (barely visible) + italic secondary text (8.42:1) | ✗ a bar that doesn't read; people's words demoted to the secondary level and italic. |
| Inline code | Geist Mono 12.25 px (0.875 em), `bg-muted`, border 1.09:1, radius 4 | Border invisible; fine otherwise. |
| Code block | Mono 13 px lh 21.45, `bg-card`, border **1.16:1**, radius 8, pad 12·14, `white-space: pre` + horizontal scroll; no language label, no copy | Edge invisible; no affordances. |
| Divider | `<hr>` has **no theme class**: Tailwind preflight's default, `1px solid currentColor` = the **foreground** at **20.1:1** dark, 19.8:1 light | ✗ the loudest line on the page (shots `editor-*`). Should be `hairline`. |
| Table | `/table` inserts 3 × 3 with a **header row and a header column** (first column bold); 720 wide, radius 8, border **1.22:1**; cells 13 px (smaller than prose), pad 8·12; header `bg-popover`, body `bg-card` | ✗ cell focus/selection = legacy `--accent` fill + 2 px full `--ring` (`global.css:718–748`). Header column by default is a surprise. Tab inside cells ✓. |
| Table picker CSS | `.notes-table-picker*` (100 ms ease) | **Dead CSS** — no consumer. |
| Link | `--primary` underline, `transition: color 120ms ease` | ✗ raw duration; accent used for links (R5's list has no links). |
| Bold | weight **700** literal | `.notes-text-bold` — not a weight token. |

### A4 · Task lines (`task-line-plugin.tsx`, `global.css:611–629`)

| Part | Measured | Verdict |
|---|---|---|
| Line box | pad **2 · 112 · 2 · 28** (a 7 rem right gutter reserved on every line), min-height 28, radius 4 | ✗ inside a 240 px table cell the title wraps after two words ("Book the / venue", shot `after-page-row`). |
| Checkbox | `CompleteToggle` overlay ✓ (16 px) | ✓ but 16 px target; differs from the checklist circle (A3) it's meant to equal. |
| Meta chip | "**Details**" (or the date) 12 px secondary on `bg-background/80`, radius 4, shown at rest on every undated line | ✗ a word as a placeholder on every line = noise; dates read "Tomorrow 09:00" (24 h) against 41's "3:00 PM". |
| Hover actions | schedule · detach · delete, 14 px glyphs in `p-0.5` (18 px targets), opacity reveal on `--motion-fast` ✓ | ✗ targets; `hover:bg-accent` ×7. Schedule opens `DateField` ✓ (the only DateField in Notes). |
| Pending / missing | `animate-pulse` dot (infinite, untokenised); "task deleted" strikethrough + `×` | Copy lowercase OK; the pulse is outside the motion system. |
| "Make task" pill | `fixed z-40 border-border bg-popover text-xs shadow-sm hover:bg-accent` | ✗ hand-made floating surface. |
| Context menu | `fixed z-50 min-w-48 rounded-md border-border bg-popover p-1 shadow-lg`, items `hover:bg-accent`, shortcut `muted/70` | ✗ hand-made because Lexical owns the DOM (comment :1065); no arrow-key navigation beyond the meta buttons. |

### A5 · Page rows, references, mindmap embed

| Part | Measured | Verdict |
|---|---|---|
| Page row (`page-row-node.tsx:67`) | full-width button **33 px**, 14 px, 16 px icon, title underlined, chevron reveals on hover (150 ms default) | ✗ `hover:bg-accent`, full ring, density-blind; another row recipe. Untitled child shows "Untitled" upright here but *italic secondary* in the sidebar. |
| RF-1 reference chip (`reference.tsx:188`) | kit `Chip xs`: **24 / 22 / 20 px by density**, 13 px, `ring-1 ring-inset ring-hairline`, `size-icon-sm`, title max 224 px truncate, transition 100 ms ease-out ✓ | ✓ **the one kit-conformant element in the editor.** |
| `/note` picker | lists **the open note itself first**; choosing it fails with a toast "Couldn't link that." + Retry (shot `at-menu-open`) | ✗ (behaviour, see C3). |
| Date chip (`date-chip.tsx`) | kit `Chip xs` + "Today / Tomorrow / formatDate" | ✓ 41's grammar. |
| Mindmap embed (code) | `max-w-[800px] h-[400px] rounded-2xl border-border bg-card shadow-lg`, gradient header + `drop-shadow-md`, Eyebrow in a `bg-accent` box; loading `h-[300px] rounded-xl animate-pulse` "Loading embedded mindmap..." (three dots); error shows the raw mindmap id in mono | ✗ R2 (a card is `rounded-lg`), shadow on an in-flow card, raw id to the user, ASCII ellipsis; `global.css` mindmap rules use raw 150/200 ms and **infinite** edge pulses. Mindmap is hidden, so low priority. |

### A6 · Slash menu and its picker stage (`slash-menu-plugin.tsx:624–701`)

| Part | Measured | Verdict |
|---|---|---|
| Shell | portal, `fixed z-50 max-h-80 w-72 rounded-md border border-border bg-popover p-1 shadow-lg`, placed at the caret with top/left, no flip or collision handling | ✗ not `FLOATING_SURFACE` (edge `border-border` not hairline, no `motion-pop`: it appears instantly); raw `z-50`. |
| Group labels | Basics · Insert · Embeds: 11/500 uppercase `Eyebrow` | ✓ fixed chrome. |
| Items | **30.6 px at every density**, 13 px, 16 px hard-coded icon, title + right-aligned description 12 px `muted-foreground/70` | ✗ one-off fade (≈4.4:1); density-blind. |
| Highlight | `bg-accent` (opaque lab 9.5) for both keyboard and hover | ✗ should be `bg-state-active` (the highlighted option) — legacy token. |
| Truncation | "**Che…**" — the command name *Checkbox* truncates because its description "A humble checkbox — never a task" is long (shot `slash-menu-open`) | ✗ 42: the label is the thing that must never fragment; the hint gives way. |
| Picker stage | same hand-made shell around `MentionCommand` (cmdk): 44 px search field, rows 13 px; opens at the caret and **runs over the centre pane into the right panel** (shot `slash-picker-note`) | ✗ no collision handling. `/task` offers "Create task '…'" — no way to tell it apart from an existing match except the `+`. |

### A7 · `@` menu (`spine/editor/mention-menu-plugin.tsx:640`)

Shell `fixed z-[var(--z-popover)] max-h-80 min-w-60 rounded-md border-border bg-popover p-1 shadow-lg` (a third recipe, at least on a z token); rows 13 px, `hover:bg-accent`, kind tags as `Eyebrow tone="tag"`. People-only in Notes. **In a one-person workspace a bare "@" shows "No matches." at once** — not even yourself, no hint that @ is for people. The date sub-picker uses `Popover` + Calendar ✓.

### A8 · Format toolbar (`format-toolbar-plugin.tsx:230`)

116 × 32, `rounded-md border-border bg-popover p-0.5 shadow-lg`, `z-[var(--z-popover)]` ✓, four `IconButton`s 26 px with 14 px icons ✓ (kit). Active state = text colour only (secondary 7.52:1 → foreground), no fill. ✗ not `FLOATING_SURFACE`, no `motion-pop`; ✗ "on" shown without the pressed fill (`state-active`) every other toggle uses (39).

### A9 · Right panel (`right-panel.tsx`, `note-detail-panel.tsx`, `entity-hub.tsx`, `note-comments-panel.tsx`, `note-outline-panel.tsx`)

| Part | Measured | Verdict |
|---|---|---|
| Title row (SH-1) | ghost button "Detail ⌄" 26 px, 14/500; menu `menuitemradio` Detail ⌥1 · Comments ⌥2 · Outline ⌥3, items 30.6 px, `FLOATING_SURFACE` ✓; views crossfade `motion-view` ✓ | ✓ the switcher Maciej asked for; a focused task line prepends a transient **Task detail** view with a back arrow (the full Tasks panel, consistent ✓). |
| Detail · tags | "Add tag" chip with a **dashed** border | ✗ a fifth chip look (dashed). |
| Detail · hub | eyebrows "OPEN WORK", "ACTIVITY" (fixed chrome ✓) + count `Badge` pill 20.8 × 18.5 at 9 % fill; rows: icon + title + relation tag "SPAWNED FROM" (`Eyebrow tone="tag"`) **wrapping onto a second line** in a 368 px panel | ✗ count language 2 (pill) vs plain counts in `CollectionHeader`/NavRow; the caps relation label wraps under the title. |
| Detail · suggestions | `EntityLinkSuggestions` (spine strip; story measured, nothing to suggest in the live note): 44 px card `bg-muted`-like fill (oklch 0.18), radius 8, "Link to **X**? · Shares tags" 13 px + 12 px reason, Dismiss ghost sm + Link **primary** sm (26 px) | Fine shape; a filled card plus a primary button inside the panel spends the accent on a suggestion (46). |
| Detail · activity | "You linked this (spawned…" **truncated mid-phrase** + "10 minutes ago" | ✗ 42 (meta fragments) and a third relative-time grammar (see B6). |
| Detail · empty | "Nothing linked yet / Drag, @mention, or /ref to connect." | Copy says `/ref`; the command is `/note` (`ref` is only a keyword). |
| Comments | `Feed` CommentCard ✓ (hairline card, 13 px, coloured "DE" avatar, "You · just now"); quote chip 24 px `border-l-2 border-border` (**1.12:1** bar) on `bg-muted/50`, 12 px secondary; composer quote `border-l-2 border-primary/40` | ✗ two more bars, one of them in the accent (R5 + "no bars"); ✗ quoted text is **not marked in the document** — the jump finds it by text search; composer 146 px wide wraps its placeholder onto two lines; ⌘↵ to send with no visible hint. The kit `Feed` gained reaction and ⋯ slots mid-audit (Tasks TV-U13); Notes' comments panel doesn't pass them, so comments on a note can't take reactions yet. |
| Outline | items **26.6 px fixed**, 13 px secondary, indent 20 / 32, `hover:bg-accent`, no title entry | ✗ legacy hover, density-blind; current section not marked. |
| No note open | plain centred text "Select a note to see its links, comments, and outline." | Not `EmptyState`. |

### A10 · Presence (`note-presence-avatars.tsx`)

Live with two browsers: `AvatarGroup`, `Avatar sm` **24 px**, fallback "**TE**" 12 px secondary on `bg-muted` (7.52:1), **no per-person colour**; tooltip "Tess Mate is viewing". The comments panel on the same screen shows "DE" on a stable colour. ✗ 43: two avatar languages on one screen; the kit `Avatar` has an identity mode (story `avatar--identity`: two letters on a label hue) that presence doesn't use.

### A11 · Share and publish (`share-menu.tsx`, `note-publish-control.tsx`)

| Part | Measured | Verdict |
|---|---|---|
| Share | ghost sm "Share" with Lock/Users icon; popover "Who can open this" + in a two-person workspace a single switch "Shared with Tess Mate" | ✓ primitives. **New notes are private**: the viewer saw "Nothing captured yet" and the deep link was silently dropped until the note was shared (plan question, important for the hackathon). |
| Publish (unpublished) | ghost sm "Publish" (secondary text) → popover 320 px, pad 16, title 13/500, description 12 px secondary, primary sm "Publish to web" | ✓ |
| Published | "Published" (foreground); native read-only `<input>` 26 px 12 px `border-border bg-muted`; Copy secondary sm; "Open public page" 12 px **`text-primary`** link; Unpublish ghost destructive; a "Published" section appears in the sidebar | ✗ native input; accent spent on a link. |

### A12 · Import dialog (`note-import-dialog.tsx`)

`Dialog` ✓ (`rounded-xl`), title 18/400, description 13 px secondary; drop zone is a `<label>` 132 px `rounded-lg border-dashed border-border bg-muted/40 hover:bg-muted/70`, 24 px icon hard-coded; the file input is `className="hidden"` (display: none) — **keyboard users can't reach the file chooser**; "Import" is primary **md 32 px** (other Notes actions are sm 26), disabled at 50 %; no Cancel until a plan exists; `Progress` ✓ during import. Scrim barely dims the page (shot `import-dialog`).

### A13 · Public page `/p/<token>` (`published-note-page.tsx`, `global.css:1090–1174`) — code + error state

Live: the local `notes-public` function answers 503, so both a real and a fake token showed "Something went wrong · Couldn't load this page. Try again shortly." (`font-display text-xl` title). Code: 224 px sticky tree nav + `max-w-5xl` main, `h1 text-3xl`, `.notes-public-prose`, footer `border-border`. **A second prose recipe that already drifts from the editor's**: paragraph gap 12 vs 10; headings margin 24 vs 20; code block `bg-muted radius-lg` vs editor `bg-card radius-md + border`; inline code no border vs bordered; quote upright vs italic; `hr` styled (`--border`) vs unstyled; checkboxes are **native square inputs** vs round toggles. The mobile tree toggle is a hand-rolled bordered button.

### A14 · States

| State | Measured / code | Verdict |
|---|---|---|
| Empty workspace | centre "Write something down" `font-display text-lg` + "Select a note on the left, or press ⌘N for a fresh one." | Hand-rolled, not `EmptyState`. For a viewer: "Select a note on the left." with nothing on the left. |
| First run | a "Welcome to Notes" note is created but **not opened**; opened in a later session it is **empty and its title is wiped to "Untitled"** (live, see C3) | Trust bug. |
| Loading | "Loading notes…" / "Preparing note…" plain 13 px text, no skeleton (rendered in < 400 ms locally) | Plain text. |
| Degraded / refresh error | `border-b border-border bg-card px-4 py-1.5 text-xs` strip | Hand-rolled banner. |
| Offline | `rounded-full bg-muted p-1.5` chip, 14 px `CloudOff`, tooltip "Saved locally — will sync" | Hand-rolled. |
| Trash | "This note is in the Trash." + hand-rolled Restore (`bg-secondary hover:bg-accent`, full ring) | Not `Button`. |
| Read-only (viewer) | `contenteditable=false` ✓, no Import/New ✓, Share/Publish hidden ✓, same layout | ✓ |
| Search | "Searching…" / "No matches." centred 13 px | Plain text. |

### A15 · Home "Notes" widget (code: `dashboard/ui/widgets/notes-widget.tsx`)

`WidgetRow` (the dashboard's shared row): `FileText` 16, title 13 px, snippet 12 px secondary (M/L only), trailing "5m ago" `text-2xs muted-foreground/80`, published globe `size-icon-xs muted/70`; empty "No notes yet. Press ⌘⇧N to capture one." (⌘⇧N here, ⌘N in Notes). The file is still on `lint:tw`'s ignore list but scans clean (0 hits): **a stale exemption**.

### A16 · Lint status and raw-value inventory

- **Assumption 14 (the notes-editor exemption) was removed.** NO-3 (`ac05b965`, 2026-07-03) dropped `LexicalNoteEditor.tsx`, `EmbeddedTask.tsx`, `NotesSplitView.tsx`; NO-4 (`784b6505`, same day) dropped `SlashCommandPlugin.tsx` and the assumption-14 comment; `b416c897` (2026-07-29) dropped `EmbeddedMindmap.tsx`. Today `scripts/check-arbitrary-tw.ts` ignores no `src/features/notes` path.
- **Only leftover:** `src/features/dashboard/ui/widgets/notes-widget.tsx` in `IGNORED_PATHS` — 0 hits, so the entry is dead.
- **Scanner over all 37 Notes-surface files (ignored ones included): 0 hits.** No raw hex, palette colours, arbitrary text/radius/spacing/shadow, `duration-NNN` or inline hex in TSX.
- What the gate can't see: raw durations in `global.css` (`.notes-link` 120 ms ease; dead `.notes-table-picker-cell` 100 ms ease; mindmap rules 150/200 ms + infinite pulses). `.stylelintrc.json` checks colour and text rules only; `src/styles/motion.test.ts` checks the motion tokens, the four patterns and blur, not raw `ms` in other rules. Weight `700` literal in `.notes-text-bold`.
- **Rotated text (46a) and capitalised people's words (40): none found.** No `writing-mode`, no 90°/270° turns on text (the sidebar chevron's `rotate-90` is an icon, allowed), and every `Eyebrow` in Notes holds fixed chrome (section names, slash groups, relation tags). Both linters already guard these.
- Arbitrary geometry (allowed by lint): `EmbeddedMindmap.tsx:77/85/94` (`max-w-[800px]`, `h-[300px]`, `h-[400px]`); sidebar indent via inline style `8 + depth * 14` px.
- **Native inputs:** sidebar search (`note-tree-sidebar.tsx:227`), public link (`note-publish-control.tsx:123`), file input (`note-import-dialog.tsx:199`). (Public page checkboxes are rendered by react-markdown.)
- **Hand-rolled buttons:** 25 raw `<button>` in Notes-owned files (sidebar 9, task-line plugin 7, linked-notes panel 3, page row 1, slash 1, comments 1, outline 1, notes page 1, public page 1) + 7 in the spine pieces Notes uses.
- **Kit primitives imported by Notes-owned files:** `Toolbar`, `SELECTED_ROW`, `Eyebrow`, `IconButton`, `Button`, `Dialog`, `DateField` (task line only), `Progress` (import only), `Avatar` (presence). **Not used:** Row, NavRow, GroupHeader, MetaCount, CollectionHeader, PropertyRow, EmptyState, Input, `FLOATING_SURFACE`, drag visuals. (The spine pieces Notes embeds use Chip, Feed, EmptyState, Avatar.)

## B. What would spread to other modules if copied (ranked)

| # | Rule broken | Evidence |
|---|---|---|
| 1 | One floating surface (R13) | Five hand-made shells in one editor: slash (`slash-menu-plugin.tsx:628/660`), `@` (`mention-menu-plugin.tsx:640`), format toolbar (`format-toolbar-plugin.tsx:230`), task-line menu and "Make task" pill (`task-line-plugin.tsx:1049/1073`). All `border-border`, none `motion-pop`, three with raw `z-50`. Cause: Lexical-owned DOM can't host Radix triggers, and there's no "caret-anchored menu" primitive. Email compose, Chat and task descriptions will hit the same wall and copy one of these. |
| 2 | Three text levels + one prose type scale (38, R4) | Prose lives in `global.css` `.notes-*`: title = H1 (30/600), body 14 vs Tasks 15, tables/code 13, inline code 12.25; and a second, already-different copy in `.notes-public-prose`. Any rich-text surface will copy one of the two. |
| 3 | Visible, quiet edges (hairline) | Divider = preflight's text-colour rule at 20:1; every other document edge at 1.09–1.22:1 (quote bar, inline code, code block, table). Nothing in between. |
| 4 | One interaction language (39) | 18 `bg-accent` hovers vs 3 `state-hover`; 26 full-strength focus rings vs 0 kit `/50` rings; slash highlight `bg-accent`; table cell focus `--accent` + 2 px ring; format-toolbar "on" without a fill. |
| 5 | Density on everything (44) | Notes-owned chrome is fixed (tree rows 26.6, slash items 30.6, outline 26.6, page rows 33, task-line gutters, table padding); only borrowed kit pieces scale. |
| 6 | One date/time grammar, no truncation (41, 42) | `notes/recent.ts timeAgo` ("3w ago", "2mo ago"), `spine/comments relativeTime` ("5d ago" → "Oct 12"), hub activity "10 minutes ago", task line "Tomorrow 09:00" (24 h), task panel "9:37 PM", linked card "Edited Oct 13". Truncations: "Che…" in the slash menu, "(spawned…" in activity. |
| 7 | Avatars: two initials + stable colour (43) | Presence "TE" grey-on-grey next to coloured comment avatars. |
| 8 | Tint, never a bar; accent budget (R5, 46) | Quote 3 px bar, comment quote 2 px bar, composer quote `border-primary/40` (accent bar), links in `--primary`. |
| 9 | One chip, one count language (45) | RF-1 Chip ✓, but also: dashed "Add tag", "Details" text chip on task lines, `Badge` count pill in the hub, underlined page-row titles, "SPAWNED FROM" caps tag. |
| 10 | One row (kit Row/NavRow) | Four row recipes in one sidebar (tree, published, search result, page row in the editor) plus outline items; none is `NavRow`/`Row`. A future Docs, Files or Chat-channel tree would copy `NoteRow`. |
| 11 | One drop target and drag preview (39) | Sidebar into/before/after, editor pane ring, hub — four drop looks; an overlay that hides the target; `opacity-50` source. |
| 12 | 3 × 3 layout (48b) | Note actions float over the document in the centre pane; the panel toggle is duplicated there. A module copying this would put its actions over its content too. |
| 13 | EmptyState | Six hand-rolled empty/loading strings (centre, right panel, sidebar inbox, search, outline, trash). |

## C. Fix list

### C1 · Rule-backed fixes (no call needed; each breaks a ratified rule)

1. **A caret-anchored menu primitive** in `ui/` (portal + `FLOATING_SURFACE` + `motion-pop` + collision/flip + `--z-popover`, rows = the menu item recipe with `bg-state-active` highlight) and move slash, picker stage, `@`, task-line menu, "Make task" and the format toolbar onto it (B1).
2. **Prose tokens**: give the title its own step above H1 (or make H1 one step down), set body to the content size Tasks uses (15) or record why prose is 14, bring tables/code to the body size or one defined step below; delete the divergent copy in `.notes-public-prose` by sharing one prose stylesheet (B2).
3. **Edges**: `hr` → `hairline`; quote bar, inline code, code block and table borders → `hairline` (visible, quiet). Table cell focus/selection → `bg-state-selected` + `ring-state-selected-edge`, not `--accent` + full ring.
4. **Checklist checkbox** → the `CompleteToggle` geometry exactly (svg check, 3:1 rest edge, centred on the first line's x-height) — "the checkbox IS the task" only holds if they're the same.
5. **Sidebar** → `NavRow` (36/32/28, 14/500, primary text at rest), one row recipe for tree, Published and search results; `Input size="sm"` for search; hit areas via `.hit-min`; trash days reserve-and-fade; drop/drag → `DROP_TARGET`, `InsertionLine`, `DragOverlaySurface`, `DRAG_SOURCE` with the overlay offset so the target stays visible.
6. **Legacy tokens**: every `bg-accent` hover/highlight → `bg-state-hover` / `bg-state-active` (18 in Notes files + 3 in the spine pieces); every focus → the kit `focus-visible:ring-2 ring-ring/50`; `bg-accent/60`, `muted/70`, `muted/80`, `bg-muted/40|50|70` → the three levels / state layer.
7. **Format toolbar** "on" state → `bg-state-active` fill.
8. **Avatars**: presence → kit `Avatar` identity (two letters + stable hue).
9. **Dates**: one formatter (call 41) for task-line meta, comments, activity, widget, linked card; no truncation of meta mid-word — drop whole items behind "+n".
10. **Slash menu**: the label never truncates (hide the description first); description at the tertiary level, not `/70`.
11. **Task line**: no "Details" placeholder at rest (show the open-detail affordance on hover/focus only, like the queue mark in Tasks); right gutter only as wide as its meta; 24 px targets.
12. **Empty/loading states** → `EmptyState` (centre, right panel, sidebar inbox, search, outline, trash) with a viewer-appropriate line.
13. **Native inputs** → `Input` (sidebar search, public link); file input visually hidden but focusable (`sr-only`), the drop zone a real button.
14. **Motion**: replace `120ms ease`, `100ms ease`, Tailwind-default 150 ms reveals, and `animate-pulse` with the tokens / `.motion-*` patterns; delete the dead `.notes-table-picker*` CSS; extend `motion.test.ts` (or stylelint) to fail raw `ms` / `ease` in `global.css` rules.
15. **Lint**: remove `notes-widget.tsx` (and the missing `widget-shell.tsx`) from `IGNORED_PATHS`.
16. **Mindmap embed** (when Mindmap returns): `rounded-lg`, no shadow on an in-flow card, no raw id, "…".
17. **Copy**: hub empty state "/ref" → "/note" (or add `/ref`); Home widget's ⌘⇧N vs Notes' ⌘N — make sure both are real and named the same way.
18. **Stories**: add stories for the editor (all blocks), slash/picker/`@`, format toolbar, right-panel views, presence, publish and import — the kit's `kit.test.ts` pattern shows how.

### C2 · Questions for the plan (need Maciej; recommendations attached)

- **Q1 · Does prose follow density?** Call 44 says density applies to everything. *Recommend:* chrome inside the editor (task-line meta, page rows, table cell padding, chips, menus) follows density; the reading size of prose is its own setting (as in Notion/Linear docs), not density.
- **Q2 · Where do note actions live (48b)?** Today: floating over the document. *Recommend:* a quiet header row in the centre pane (breadcrumb · presence · Share · Publish), the panel toggle only in the bottom bar.
- **Q3 · Box in a box.** *Recommend:* the editor uses the centre panel's own surface, like every other centre pane.
- **Q4 · Sidebar sections.** Pinned notes are listed twice; a root note jumps from Inbox to Workspace when it gets a child; sections have no counts or collapse. Structure question for round 1.
- **Q5 · Tables.** Header column on by default? *Recommend:* header row only.
- **Q6 · Private by default.** A teammate (and every hackathon participant) sees an empty Notes until each note is shared. Belongs with the hackathon plan's "prepared workspace" decision.

### C3 · Found along the way (not visual; for the current-state lane / spec)

1. **Welcome note loses its title.** First visit creates "Welcome to Notes" but doesn't open it; opened in a later session it is empty and the title derivation renames it to "" ("Untitled") — live, reproducible in a fresh workspace.
2. **`/note` offers the current note**; picking it fails with "Couldn't link that." + Retry.
3. **Tab at the end of a paragraph leaves the editor** and lands in the right panel's "Add tag" field; the next keystrokes are typed into the tag search.
4. **Backspace at the start of the empty paragraph after a table** jumps into the last cell (Lexical default) — easy to type into the table by accident.
5. **Bare `@` in a one-person workspace** shows "No matches." with no hint.
6. **Quote-comments aren't anchored** in the document (no highlight); they're found by text search, so editing the quoted words orphans them silently.
7. **Viewer deep link** to a private note is silently cleared (no "you don't have access" line).

## D. Which kit primitive each Notes part should become

| Notes part | Today | Becomes |
|---|---|---|
| Tree row, Published row, search result | `NoteRow` + 2 more hand-made rows | **NavRow** (one row; search result as NavRow with a second line, or Row) |
| Section labels | `Eyebrow` | **NavSectionHeader / GroupHeader** (fixed chrome caps, count when collapsible) |
| Sidebar header controls | `Toolbar` + `IconButton` | keep (**Toolbar**) |
| Sidebar search | native input | **Input size="sm"** (or the FilterBar search field) |
| Tree drag | hand-made lines/ring/overlay | **InsertionLine, NestPreview, DROP_TARGET, DragOverlaySurface, DRAG_SOURCE** |
| Page row in the editor | hand-made 33 px button | **Row** (inline, density-bound) |
| Task line meta | "Details" chip + hand-made buttons | **Chip xs** for the date, **IconButton** sm for actions, **MetaCount** for counts |
| Note reference | RF-1 Chip xs | keep (**Chip**) |
| Slash menu, picker stage, `@` menu, task-line menu, "Make task", format toolbar | five hand-made shells | new **caret-anchored menu** on `FLOATING_SURFACE`; toolbar = **Toolbar** in that surface |
| Format toggles | `IconButton` | **IconButton** with the pressed state (`state-active`) |
| Right panel title | `RightPanel` dropdown | keep |
| Hub sections + counts | Eyebrow + `Badge` pill | **CollectionHeader** (label · plain count · action) |
| Hub rows | entity rows with wrapping caps tag | **Row** with a trailing **Chip** for the relation |
| "Add tag" | dashed chip | **Picker pill** |
| Activity, comments, composer | spine `Feed` | keep (**Feed**), add a quote **Chip** instead of the bar |
| Outline items | hand-made 26.6 px buttons | **NavRow** (level = indent), current section = `bg-state-active` |
| Presence | `Avatar` fallback | **Avatar** identity (two letters + hue) |
| Share / Publish | `Button` ghost sm + `Popover` | keep; public link field → **Input** |
| Import drop zone | `<label>` + hidden input | **EmptyState** with a **Button** action + visually-hidden file input |
| Empty/loading/trash/degraded | hand-made strings and strips | **EmptyState**; banner → one shared notice strip (`truncation-notice` pattern) |
| Date in task lines | `formatScheduled` | **DateField** (already in the schedule popover) + the 41 formatter |
| Home widget rows | `WidgetRow` | keep, but adopt the 41 formatter and drop `/70`, `/80` |

**Notes-only (stay in `features/notes`):** the prose stylesheet (but one, shared with the public page), task-line overlay mechanics, the page-row node, the title-derivation line, table/code block styling, the public page layout.

## E. Motion

| Where | Today | Against call 81 / R6 |
|---|---|---|
| Slash, picker, `@`, task-line menu, "Make task", format toolbar | appear instantly (no `motion-pop`) | ✗ should grow from the caret on `--motion-base`. |
| Radix menus, popovers (⋯, panel title, share, publish) | `motion-pop` via `FLOATING_SURFACE` ✓; menu **items** transition 150 ms `cubic-bezier(.4,0,.2,1)` (Tailwind default) | items ✗ (primitive-level, affects every module). |
| Right panel view switch | `motion-view` crossfade ✓ | ✓ |
| Sidebar chevron, hover actions, page-row chevron | Tailwind default 150 ms; `motion-reduce:transition-none` ✓ | ✗ should be `--motion-fast`. |
| Task-line meta reveal | `--motion-fast` + `--ease-out` ✓ | ✓ |
| Checklist circle | `--motion-fade` ✓ | ✓ |
| Slash items, RF-1 chip | `--motion-fade` / 100 ms ease-out ✓ | ✓ |
| `.notes-link` | `color 120ms ease` | ✗ raw. |
| `.notes-table-picker-cell` | `100ms ease` | ✗ raw and dead. |
| Pending task dot, mindmap skeleton, hub skeleton | `animate-pulse` (infinite) | ✗ outside the system; use the `.motion-*`/skeleton pattern or a static mark. |
| Mindmap CSS | 150/200 ms raw + infinite edge pulses | ✗ (hidden module). |
| Drag | overlay `dropAnimation={null}` (no settle), no row add/remove animation in the tree | `.motion-row` not used when notes are created, moved or trashed. |
| Check-off | checklist and task lines don't use `.check-pop` (the one sanctioned delight) | Could, for task lines. |
| Blur / backdrop | none ✓ | ✓ |

## F. Research data created (remove when done)

All rows are in the **local** stack only, inside one workspace. Deleting the workspace removes everything that cascades from it; list kept explicit so nothing is missed.

| What | Id / detail |
|---|---|
| Workspace "Notes replan visual audit" (owner dev@moduo.local) | `d2cb2621-cd4d-4cd8-83ad-78bef9237f0d` (+ its system Inbox bucket `225ec51d-479d-43e7-a379-72e85d579d4b`, created by the app's triggers) |
| Membership: teammate@moduo.local (Tess Mate, `17c405d5-ca87-4156-9d77-6e81c04262f1`) as **viewer** | inserted with the local service role (RLS blocks an owner insert), the same way `tests/support/local-stack.ts ensureTeammate` does |
| Note "Hackathon brief" (was the auto-created "Welcome to Notes"; shared with Tess Mate, **published**) | `027ed50d-1778-4fc0-8b90-9dd7e518f5a4` (its public link is the value in that row's `publish_token` column; unpublish or delete the note to revoke) |
| Child note (blank title, from `/page`) | `e40f5fcf-2922-4f33-ac29-f4c91334fcad` |
| Share grant on the note | `resource_grants` `9e03f462-bb81-4b8f-b6ea-657938e07b24` |
| Tasks "Book the venue", "Book" (from `/task`) | `502b72e2-3d19-4d87-8631-a6a62c58d8a2`, `07cd4b52-1802-479f-8536-163267b52c47` |
| Note → task links (origin `ref`) | `39453d73-c174-4be8-8240-9f1f7523a567`, `174a2226-6518-4750-bdbb-027b1185d6d4` |
| Comments on the note (one quote-comment, one plain) | `cfee0ab8-a240-4dde-b742-d2b6341cf7e7`, `e7e4f6c0-9e4d-480f-905d-3811fb78f8a0` |
| Activity/notification rows the app wrote for the links, comments, share and publish | cascade with the workspace |
| Not created | no tags (text typed into the tag search was never submitted), no mention (no match), no self-link (failed), no Home layout row (layout is per-device storage) |

**Screenshot index** (session scratchpad, ephemeral): `shots/sb/` — `notes-notetreesidebar--*` (+ `__density-{compact,dense}`, `__light`, `__hover`, `__focus-tab3`, `__menu`), `notes-tasklinestates--all-states`, `spine-*`, kit `components-ui-*--densities`. `shots/live/` — `notes-empty-ws`, `notes-boot-400ms`, `welcome-note`, `after-text`, `after-l5(-full)`, `editor-{comfortable,compact,dense}-dark`, `editor-comfortable-light`, `slash-menu-open`, `slash-menu-filtered`, `slash-picker-task(-typed|-existing)`, `slash-picker-note`, `at-menu-open`, `at-menu-typed`, `table-cell-focus`, `format-toolbar`, `selection-and-toolbar`, `panel-dropdown(-open)`, `comments-empty`, `comment-composer-quote`, `comments-thread`, `outline`, `share-popover`, `share-on`, `publish-popover`, `published-popover`, `import-dialog`, `sidebar-hover`, `sidebar-menu`, `sidebar-expanded`, `sidebar-drag-{into,before}`, `drag-over-editor`, `presence-A`, `viewer-note`, `viewer-presence`, `readonly-viewer` (before sharing), `public-page`, `public-404`, `home`. Measurements: `*.measure.json` (element dumps) and `*.probe.json` (styles + contrast).
