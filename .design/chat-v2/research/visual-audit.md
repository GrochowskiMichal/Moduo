# Chat v1 visual audit against the Tasks v3 north star

> Raw research report from the Chat re-plan, 2026-10-13. Nothing here is decided.

Base: `t/maciej/chat-replan` @ b33922a6. Storybook 10.6 on :6016, 1440 × 900, dark, default shade, mono accent, comfortable density, unless a row says otherwise. Spot checks: `density:dense`, `theme:light`, `accent:blue`. Contrast is WCAG 2.x, measured in the page. Every colour is resolved through a canvas, so `oklch()` and `color-mix()` resolve the way the browser paints them. Translucent fills are composited from the root down, and opacity is multiplied up the ancestor chain. Transitions were switched off before measuring, because the measuring tab ran in the background and colour transitions stall there. The harness lives in the session scratchpad, not in the repo.

**Rendered from stories:** `Features/Chat/Workspace` → Conversation, WithThread, WithDetails, Locked. **Looked at live, read-only:** the seeded workspace on 127.0.0.1:8096 (`/chat`), for the shell, the bottom bar and the loading state. **Read from code only (no story):** the App (API-key) author, failed, deleted and edited messages, inline edit, the Search panel, the dialogs (create channel, people picker, browse, ⌘J switcher), the emoji picker, and the page's empty and error states.

**Caveat:** the story frame isn't the real shell. It draws its own `rounded-xl border bg-card` panes (`chat.stories.tsx:210–335`), so the bottom bar, the shell's panel toggles and its pane widths come from the live app and the page code.

The rules cited are DESIGN_RULES R1–R13, the Tasks v3 calls 38–46a (group F), 48b (the 3×3 layout) and 72/72a (the right panel's title-row dropdown), and the kit DS-6 shipped (`src/components/ui/kit.ts`).

## 0. Headline

Chat v1 is calm and mostly token-clean: no blur, no raw hex, reveals that fade instead of reflowing, the state layer on its main rows, and the accent kept off the rail. It predates DS-6 and the Tasks v3 rules, though, and in four places it would teach the wrong thing if copied.

1. **It ignores the 3×3 layout's right panel.** Chat is the only module not in the panel registry. It switches panels from icon toggles in the conversation header and closes them with an ×.
2. **The message column ignores density.** The rail and the controls move with it; every message, avatar, reaction and divider stays the same size at dense.
3. **It runs a second identity system.** It has its own grey `PersonAvatar` and its own initials rule ("Maciej" → "M"), so the self-DM shows "M" for "Me".
4. **Its dates speak five dialects**, none of them the shared grammar.

Under those sit the usual seams: four hover languages, three focus recipes, two hand-rolled floating surfaces, an accent stack on a mention, about nine pill shapes, and 18 inline-style size overrides.

## 1. Issue table

Ranked by how far each would spread if a new module copied Chat. **Kind:** *V* = breaks a rule that already exists · *N* = needs a new rule · *Q* = a chat-only design question.

| # | Issue | Measurement / evidence | Rule | Kind |
|---|---|---|---|---|
| 1 | **The right panel isn't the shared one.** Chat isn't in the registry, has no title-row dropdown, and closes with an × in the panel header. Panels are switched by `aria-pressed` icon toggles in the *centre* header. | `panel-registry.ts:34` lists five modules, not chat. `side-panels.tsx:19–37`: own `PanelHeader`, 48 px, 13/600 title, 26 px × at :34. `conversation-header.tsx:161–189`: "3 members", Search and Details all toggle panels. In WithDetails, "3 members" and the pin icon are *both* pressed for one panel. The other five modules all mount `components/app/right-panel.tsx`. | 48b, 72, 72a | V |
| 2 | **The message column ignores density.** | Comfortable → dense: rail row 36 → 28, header buttons 26 → 22, composer 71 → 67. But: message with header 49.1 → 49.1, grouped row 39 → 39, gutter 36 → 36, avatar 32 → 32, reaction pill 24 → 24, day divider 38.5 → 38.5, section header 24.5 → 24.5, conversation header 55.5 → 55.5. Fixed classes: `grid-cols-[2.25rem…]`, `pt-2 pb-0.5` (`message-item.tsx:219–220`), `h-6` (:114), `py-2` (`message-list.tsx:188`). | 44, R7 | V |
| 3 | **A second avatar system.** Chat's `PersonAvatar` is grey for everyone, in the display face at weight 400, with its own `initialsOf`. A single-word name gets one letter. | `person-avatar.tsx:10–16, 48`. Measured: every avatar `bg-muted` on the card at 1.06:1, initials 7.52:1, no `data-label` hue. The kit's `PersonAvatar` (`components/ui/avatar.tsx`) gives two initials on a hue keyed by id ("Maciej" → MA). Live: the self-DM row shows **"M" for "Member (you)"**. Avatars are shrunk with `scale-75` in chips and the switcher (`chat-dialogs.tsx:200, 621`). | 43 | V |
| 4 | **Five date formats, none from `src/lib/time-format.ts`.** | Time "2:24 AM" (`message-item.tsx:52`, own formatter). Tooltip "Wednesday, October 8, 2026 at 2:24 AM" (:53). Day divider "Wednesday, October 8" / "…, 2025" (`message-list.tsx:14–24`). "Last reply 12 minutes ago" (`message-item.tsx:395`), plus relative times on pins and search hits (`side-panels.tsx:236, 365`). "Created … on September 13, 2026" (:69). The grammar says Today · Yesterday · Mon · Oct 16 · Oct 16, 2027 · 3:00 PM. Also, the "Last reply …" span is `truncate` (:394), so a time can truncate. | 41 | V |
| 5 | **The mention stacks four accent marks**, and a mention row loses its hover. | Row tint `bg-primary/8` (1.16:1 vs card), 2 px attention bar (14.8:1 dark; near-black 17.3:1 on light), and the `@you` pill `bg-primary/14` (1.5:1 fill). A deep-linked message adds `bg-primary/14` (`message-item.tsx:223–233`; `message-body.tsx:72`). The tint *replaces* `hover:bg-state-hover` (:223), so hovering a mention changes nothing. DS-2 allowlisted each piece as status before call 46 ranked the accent, and nothing re-ranked chat. | 46, 39, R5 | N |
| 6 | **Accent budget on one screen.** | With `accent:blue`, 5 accent marks at rest: my-reaction pill (tint + ring), the "New" line (`bg-primary/60`, 6.43:1), the mention tint, the bar and the `@you` pill. Typing adds the accent Send button, and a deep link adds a flash. A second hue is always there: 3 green presence dots (`bg-success`). | 46 | N |
| 7 | **Four hover languages.** | Fill `state-hover` (rail rows, message rows). Legacy `bg-accent` in 10 places (`chat-sidebar.tsx:136, 224, 241`; `chat-dialogs.tsx:318, 488`; `emoji-picker.tsx:108`; `composer.tsx:430`; `side-panels.tsx:187, 358`; `message-item.tsx:225`). **Border** hover on the reaction pill, the thread summary and the pinned card (`message-item.tsx:117, 378`; `side-panels.tsx:231`). Text-only hover on "Jump to…" and the topic. | 39 | V |
| 8 | **Three focus recipes, plus none.** | Rail rows have no `focus-visible` class at all. Tabbing onto "launch-plan" measured the browser's own `outline: auto rgb(153,200,255)`, a light blue ring that isn't a token. Elsewhere: full-strength `ring-2 ring-ring` (the avatar button `message-item.tsx:255`, emoji cells `emoji-picker.tsx:108`), `ring-1 ring-ring` (topic edit `conversation-header.tsx:142`), and `focus-within:border-ring` (composer `composer.tsx:462`). The one recipe is `ring-2 ring-ring/50`. | 39 | V |
| 9 | **Two hand-rolled floating surfaces.** | Hover toolbar: `rounded-lg border-border bg-popover` plus an inline shadow and z-index (`message-item.tsx:409, 414`), measured at 12 px radius. The @/#/: suggestion list: same recipe (`composer.tsx:409–410`). The jump pill: inline shadow (`message-list.tsx:219`). `FLOATING_SURFACE` is `rounded-md border-hairline` + `motion-pop`. | R13 | V |
| 10 | **Small caps in the rail and panels.** | Rail sections "STARRED / CHANNELS / DIRECT MESSAGES": `Eyebrow` 11/500 uppercase, 24.5 px (`chat-sidebar.tsx:145`). Details "ABOUT / 3 MEMBERS / PINNED" (`side-panels.tsx:150, 166, 214`): a count inside small caps. Tasks decided no small caps anywhere in a sidebar, one sentence-case header style, and a hairline-only split (29e, 20). The lint allowlist lists chat as debt (`scripts/check-text-rules.ts:84–85`). | 40, R12, 29e | V |
| 11 | **Count languages: five in one module.** | (a) Rail pip: inverted `bg-foreground`, 20 × 16.5, 11/500 (`chat-sidebar.tsx:105`). It means *unread* on a DM but *mentions* on a channel (:73). (b) 6 px unread dot (:110, :147). (c) "3 replies" 12/500 in the foreground colour. (d) "3 members" as a 14/500 ghost button, and as "3 MEMBERS" small caps. (e) The ⌘J switcher's plain 11 px muted number (`chat-dialogs.tsx:593`). The group-DM glyph is a bare "3" in a grey disc (`chat-sidebar.tsx:51`). Tasks: plain tabular count in the tertiary level; the inverted pip is only the Filter badge. | 45 | V |
| 12 | **The reaction pill is a chip that isn't the Chip.** | Fixed `h-6` (24 at every density), opaque `border-border` rest ring (1.16:1), border hover, emoji 13 px, count 12 px. "I reacted" uses `SELECTED_OPTION` (the selection recipe, tint 1.33:1 + 32 % ring) (`message-item.tsx:113–121`). A pressed toggle is `state-active`, and the kit's `Chip xs active` is exactly that. The "add reaction" pill repeats the same recipe (:357). | 45, R5, 44 | V |
| 13 | **Bottom bar: chat's tools aren't there, and two controls are dead.** | Live /chat: Collapse left · Search · Quick capture · Create new · **"Collapse right panel"**. No right panel is rendered (only the rail at 348 px and the centre at 1044 px), because the page sets `hideRight` whenever no thread, details or search is open (`chat-page.tsx:682`). "Create new" (⌘N) does nothing on /chat: tasks, calendar, email, contacts, notes and the dashboard all call `onCreateNew`; chat doesn't. Chat's own tools (new message, new channel, browse, jump to) sit in the rail and the centre header instead. | 48b, 82 | V |
| 14 | **Message text is a step below body.** The composer sets it looser than the messages. | Message body 13 px (`text-sm`, "secondary UI") at a line height of 18.57 px. The class asks for `leading-relaxed`, but `text-sm` comes after it in `cn()`, so tailwind-merge drops it (`message-body.tsx:141–142`). The composer textarea is 13 px at 21.45 px (`composer.tsx:483`). Body content is 14 px in the type ladder; Tasks titles are 15 px. | R4, type ladder | V |
| 15 | **Timestamps and hints sit on the secondary level.** The topic placeholder is a one-off fade. | Times, "(edited)", "Pinned", the typing line and "Last reply" are all `text-muted-foreground` (7.99:1). R11 files timestamps, hints and counts under tertiary (`text-subtle-foreground`, 6.09:1 on the card). "Add a topic" is `text-muted-foreground/60`, which composites to ≈3.5:1 (`conversation-header.tsx:150`). | 38, R11 | V |
| 16 | **A muted channel fades below readable.** | `opacity-60` on the whole rail row: label 3.47:1 on dark, 2.19:1 on light (`chat-sidebar.tsx:84`). A muted channel *is* a state, so a fade is allowed. But Tasks' done-row fade (50 %) is on rows whose title still reads; nothing says how low a state fade may go on a rail label. | 38 | N |
| 17 | **18 inline styles, most of them size overrides.** | `style={{ height: "var(--ctrl-h-sm)" }}` and the width twin on Buttons that already sit on the rung (14), plus inline shadows, z-index and an opacity. `message-item.tsx:414, 423, 435, 465`; `composer.tsx:398, 410, 520, 544, 552`; `conversation-header.tsx:168, 174, 204, 236`; `message-list.tsx:219`; `side-panels.tsx:175`; `chat-dialogs.tsx:465, 511, 520`. Use `IconButton` / `Button size="sm"`. | AGENTS rule 3, R1, R10 | V |
| 18 | **Hit targets under 24 px.** | Topic button 16 px tall (`conversation-header.tsx:145`). A member's name in Details 18.6 px, and the hover-revealed "Remove" 16.5 px at 11 px text (`side-panels.tsx:190, 200`). From code: failed-send "Retry" / "Discard" text buttons about 16 px (`message-item.tsx:323–336`), and the picked-person × `p-0.5` + 12 px glyph = 16 px (`chat-dialogs.tsx:318`). Inline `@name` (18.6) and `#ref` (22.6) chips sit inside text, where WCAG exempts them. | R13 | V |
| 19 | **Three ways to search, two of them chat-only.** | Rail "Jump to… ⌘J" is a bordered black well, 32 px (`chat-sidebar.tsx:195–203`); a header search icon opens a message-search panel (`conversation-header.tsx:178`); the bottom bar has the global ⌘K. Tasks' grammar has one Search in the centre toolbar. | Toolbar grammar (§5.2) | Q |
| 20 | **The conversation header doesn't line up with the bars.** | 55.5 px (`min-h-(--bar-h)` 48 + `py-2`, `conversation-header.tsx:105`), at every density; h1 15/600 display with a 12 px topic under it. Seven controls: "3 members", Search, Details, Star, Notify, ⋯, and Join. | 48b, R1 | Q |
| 21 | **Section headers are 24.5 px; the kit's are 28.** Collapse isn't remembered. | `chat-sidebar.tsx:131–149`: `py-1` eyebrow button, legacy `hover:bg-accent/60`; `useState(true)` (:127) resets on every load. `GroupHeader` is `--row-h-sm` (28 / 26 / 24) with sentence case, and Tasks remembers collapse per person (29e). | 40, 44, 29e | V |
| 22 | **Rail rows are 13 px; NavRow is 14/500.** Unread is told by weight. | Read 13/400 muted (7.99:1); unread 13/500 foreground (19.08:1) plus a pip or dot (`chat-sidebar.tsx:88–95`). NavRow sets every label at 14/500 display, so it can't express "unread = heavier". DM rows carry a 24 px avatar pulled in with `-my-1` (:48); NavRow's leading slot is 16 px, so the avatar would have to shrink to the icon rung after mapping. | R1, DS-3 | Q |
| 23 | **Presence is the only hue besides the accent, and it fails on light.** | Online = `bg-success` green, 8 px, 9.19:1 on dark but **2.17:1 on light**. Away = a hollow `muted-foreground/60` ring, 3.44:1 dark, **2.19:1 light** (`person-avatar.tsx:18–29`). Non-text needs 3:1. Light tuning is out of scope today, but the colour question isn't. | R5, brand (no stray hues) | Q |
| 24 | **The App (API-key) author has a badge and a robot.** | A bordered "App" chip (`rounded-sm border-border`, 11 px display) after the name, and a `Bot` glyph in a bordered 32 px tile instead of an avatar (`message-item.tsx:245–251, 270–274`). Brand 40a: assistant actions show **by name, in the normal neutral style**. The badge is neutral, but it's a second mark nobody else uses. | brand 40a, 46 | N |
| 25 | **The day divider is a bordered pill on two opaque rules.** | 38.5 px. The pill is 11 px **display**, muted, `border-border` (1.16:1). The rules are `bg-border` (1.16:1). Sticky (`message-list.tsx:186–195`). Tasks' day headers are `GroupHeader` (13/500 sentence case, sub-line, hairline). The "New" marker is a separate 24.5 px accent line with an 11/500 label (:200–205). | 40, 41, 45 | Q |
| 26 | **The composer is an inverted well with ten icons always showing.** | The shell is `bg-background` (black) inside the card (fill 1.05:1), 12 px radius, `border-border` (1.22:1). Bold · Italic · Strike · Code · Code block · Quote | @ · # · emoji · Send, all 26 px (`composer.tsx:383–390, 487–565`). In the 302 px thread panel the row fills 300 of 302 px. The kit's `FeedComposer` is a hairline card that firms up on focus. | 39, R13 (surface) | Q |
| 27 | **The thread summary changes language on hover.** | 34 px, `border-transparent` → `hover:border-border hover:bg-card` (`message-item.tsx:378`): a border *and* a card fill. "View thread" fades in (fine). A 24 px avatar stack with `-space-x-1.5`. | 39 | V |
| 28 | **Hand-rolled empty states.** | The page empty state uses `EmptyState` ✓ (`chat-page.tsx:570`). Hand-rolled: search "Type at least two characters." / "No messages match" (`side-panels.tsx:339–348`), "Nothing pinned…" (:221), "No emoji match" (`emoji-picker.tsx:119`), browse empty with a primary button (`chat-dialogs.tsx:472–481`), people-picker empty (:353). The channel intro is a custom 40 px icon tile + 20/600 heading (`chat-page.tsx:453–496`). | §5.2 kit | V |
| 29 | **The loading and locked states show the shell's placeholder text.** | The loading, locked and error shells pass no `left` (`chat-page.tsx:394–436`), so the rail renders the literal "Feature tools panel" (`feature-panels-shell.tsx:262`). Seen live while /chat loaded. | — | V |
| 30 | **The locked screen is a marketing page inside the app.** | h1 24/600 display, four `bg-background` "well" cards (fill 1.05:1, `border-border` 1.22:1, 12 px radius), a 40 px icon tile, one `lg` primary "Upgrade to Duo — $20/mo for two" (`chat-locked.tsx:57–100`). One primary ✓. "Real time" carries an `AtSign` icon and "Linked to the work" a `Zap`, so the icons don't match their words. It's the only screen in the app built this way. | — | Q |
| 31 | **Legacy borders where the hairline belongs.** | `border-border` (opaque) on the header rule, the composer, day pills and rules, reaction pills, the hover toolbar, pinned cards, code blocks, the locked cards and the App badge: 1.16–1.27:1. `--hairline` measured 1.24:1 on the card, but it is translucent, so it re-resolves on every surface and shade. | R10, DS-1 | V |
| 32 | **The type role is mixed.** | Display face on people's names (author 13/500), the day pill label, the rail pip and the group-DM count. R4 puts names (content), dates and counts in the body face. | R4 | V |
| 33 | **Editing paints a legacy fill.** | `editing && "bg-accent/40"` (`message-item.tsx:225`). | R10, 39 | V |
| 34 | **Deleted and failed messages use their own state language.** | Deleted: 13 px italic muted "This message was deleted." (:295). Pending: `opacity-60` body (7.04:1, fine). Failed: red `text-danger` icon + "Not sent." + underline-on-hover text buttons (:319–338). Nothing in the rules says whether "not sent" is an error (red) or a quiet state. | 38 | N |
| 35 | **Emoji have five sizes.** | Jumbo emoji-only message 36 px (`text-4xl`, `message-body.tsx:142`); picker grid 18 px; context-menu quick row 14 px; hover toolbar and reaction pills 13 px. They are system colour emoji, the one place full colour enters chat. | — | Q |
| 36 | **Rotated chevrons.** | The collapsed-section chevron rotates (`rotate-90`, `chat-sidebar.tsx:141`). It's an icon, so R12 allows it. Noted only so the rebuild uses GroupHeader's `-rotate-90` on `ChevronDown`. | 46a | — |
| 37 | **Motion: mostly right, with untokened colour transitions.** | 12 bare `transition-colors` with no `duration-(--motion-*)` (for example `message-item.tsx:114, 378`; `composer.tsx:462`; `chat-dialogs.tsx:194`), the debt DS-2 recorded. The rest holds: no `backdrop-filter` or blur, no tw-animate entrances, every reveal (hover toolbar, gutter time, add-reaction pill, typing line, "View thread", section `+`) fades in a reserved space, and the chevron turns on `--motion-fast`. | R6 | V |
| 38 | **Stories are thin.** | No story for: an App author, failed, deleted, edited, inline edit, Search panel, dialogs, emoji picker, the empty and error states, a self-DM or a group DM. WithDetails' "Pinned" spins forever: `runtime={null}` (`chat.stories.tsx:319`) never resolves `listPinned` (`side-panels.tsx:105–115`). The frame isn't the shell. | Tasks §5.1 #14 (stories as the example) | V |

**Light theme, for the record** (light tuning is out of scope in AGENTS.md, so these aren't ranked): `--muted-foreground` measures 4.29:1 on the light card, so every 11–12 px time, eyebrow, typing line, quote and day pill in chat is just under 4.5:1. Avatar initials 3.87:1; the muted rail row 2.19:1; presence 2.17 and 2.19:1. All of that is token-level except the presence colours.

## 2. Element-by-element evidence

### 2.1 Rail (`chat-sidebar.tsx`)

| Part | Measured (dark, comfortable) | Code | Verdict |
|---|---|---|---|
| Row | 36 / 32 / 28 by density ✓, `px-2 gap-2`, radius 8. Current = `bg-state-active` ✓, hover `state-hover` ✓ | :75–86 | Height is right. No focus ring (#8). Muted rows `opacity-60` (#16). |
| Label | 13 px; read 400 muted 7.99:1; unread or current 500 foreground 19.08:1; hover lifts to foreground | :88–95 | NavRow is 14/500 for every row (#22). |
| Glyph | `#` / lock 14 px muted; 1:1 DM = 24 px avatar with presence; group DM = "N" in a 24 px grey disc | :29–55 | A 24 px avatar in a 16 px slot. The number disc is a count pretending to be an avatar (#11). |
| Count | Inverted pip 20 × 16.5, 11/500 display, `bg-foreground` (20.12:1). DM = unread, channel = mentions; "99+" cap | :72–73, :104–108 | Two meanings, one look (#11). |
| Unread dot | 6 px `bg-foreground`; also shown on a collapsed section with unread inside | :110, :146–148 | Good idea. Belongs in NavRow's `indicator` slot. |
| Muted | `BellOff` 12 px + `opacity-60` row | :101–103 | — |
| Section header | 24.5 px, 11/500 uppercase eyebrow, chevron 12 px, hover `+` fades in ✓ | :116–159 | #10, #21. |
| Jump to… | 32 px bordered black well, 13 px muted, `Kbd ⌘J` | :195–203 | #19. |
| New message | 32 px `IconButton md` beside the field; also a 26 px `+` on the DM section and "Message a teammate" when empty | :204, :233, :238–245 | Three entrances for one verb. |
| Browse channels | 36 px row, legacy `hover:bg-accent`, `-mt-2.5` | :221–228 | A command styled as a row. |

### 2.2 Conversation header (`conversation-header.tsx`)

55.5 px (#20). Glyph 16 px (`size-icon`) or a 32 px avatar for a DM. h1 15/600 display. The sub-line is 12 px muted: the topic for channels, "Active now / Away / N people" for DMs. Controls, all 26 px (22 at dense): "3 members" (ghost `sm`, 14/500), Search, Details/Pin, Star (filled when starred), the Notify menu (radio items with an 11 px hint line), ⋯ (Mark as read, Archive, Leave). The topic edit swaps to a bare `<input>` with `ring-1 ring-ring` (:127–143). For a DM it shows Info instead of Pin. In WithDetails, "3 members" and Pin are both pressed (`state-active`) for the same panel.

### 2.3 Message row (`message-item.tsx`, `message-body.tsx`)

| Part | Measured | Code | Verdict |
|---|---|---|---|
| Grid | 36 px gutter + 12 px gap, `px-2`, radius 8. First of a group `pt-2 pb-0.5`, grouped `py-0.5`. 49.1 px for one line with a header, 39 px grouped | :219–220 | Fixed at every density (#2). |
| Hover | `state-hover` 5 % (1.10:1 vs card) ✓; not on a mention row | :223 | #5. |
| Avatar | 32 px grey, display face, presence dot | :253–260 | #3. |
| Author · time | 13/500 display foreground · 11 px muted "2:24 AM", full-date tooltip | :266–281 | #4, #15, #32. |
| Grouped time | 11 px in the gutter, fades in on hover ✓ (reserved, R6 ✓) | :238–244 | — |
| Body | 13 px / 18.57; links underlined `decoration-muted-foreground/50`; inline code 12 px mono on `bg-muted`; quote with a 2 px `border-border` rule in muted text (7.99:1); code block bordered | `message-body.tsx` :28–124 | #14. |
| Mentions | `@name` 13/500 on `bg-muted` (others) or `bg-primary/14` (you); `@channel` always `bg-primary/14` | :61–85 | #5. |
| References | spine `EntityRefChip`, 22.6 px | :86–99 | Fine (spine owns it). |
| Edited | "(edited)" 11 px muted, in parentheses, after the body | :147 | The words are fine; the level should be tertiary. |
| Pinned | 12 px pin + "Pinned" 11 px muted beside the time | :282–291 | Fine; tertiary. |
| Jumbo emoji | 36 px, line height 1.2 | :135–142 | #35. |
| Reactions | 24 px pills, `gap-1`, `pt-1`; add-reaction pill fades in on hover ✓ | :340–372 | #12. |
| Thread summary | 34 px; 24 px avatar stack; "3 replies" 12/500; "Last reply 12 minutes ago" 12 muted; "View thread" fades in | :374–402 | #4, #27. |
| Hover toolbar | 200 × 32; 👍 ❤️ 😂 · add reaction · reply · edit (own) · ⋯; 26 px buttons; fades, never reflows ✓; stays while a menu is open ✓ | :406–482 | #9, #17. |
| Context menu | The quick-reaction row (5 emoji, 14 px) + the same items as ⋯ ✓ (one menu, two entrances) | :487–514 | Good; matches NavRow's MenuKit idea. |
| Deleted / pending / failed | see #34 | :294–338 | — |

### 2.4 Conversation scroller (`message-list.tsx`)

Day divider 38.5 px, sticky, pill on two rules (#25). "New" marker 24.5 px: a `primary/60` line (6.43:1) and an 11/500 "New" label (#6). Jump pill: `rounded-full border-border bg-popover`, 12 px display, an inline shadow, fades in ✓ (#9). Loading older: a 14 px spinner. The intro at the top is custom (#28).

### 2.5 Composer (`composer.tsx`)

Typing line: 11 px muted in a reserved 16 px row that fades ✓ (R6). Shell: see #26. Textarea 13 / 21.45, grows to 240 px. Send: ghost while empty, the accent primary once there's text (the one primary ✓). Over 8000 characters, a red count appears. Edit mode adds Cancel / Save (26 px, inline sizes) and an "Esc to cancel · Enter to save" line in `Kbd`s. The suggestion list (#9) uses `bg-accent` for its highlight (`composer.tsx:430`), where menus use `state-active`. Its group label is a plain 11 px muted line, and the reference kind uses `capitalize` (allowlisted debt, `:592`).

### 2.6 Right panel (`side-panels.tsx`, `chat-page.tsx:588–676`)

320 px in the story, 48 px header with a 13/600 title, a 12 px sub-line and a 26 px × (#1). **Thread:** the parent message, then an 11 px "3 replies" label on a `bg-border` rule (`chat-page.tsx:620–625`), the replies (the same `MessageItem`, 291 px wide) and the compact composer. **Details:** ABOUT (topic 13 px, "Created by … on September 13, 2026" 12 px), N MEMBERS (36 px rows with a 24 px avatar, legacy hover, hover "Remove"), PINNED (bordered cards with border hover, relative time, a 4-line clamp). **Search:** an input with an icon, results as 2-line buttons with legacy hover and a `bg-primary/14` `<mark>`. Opening a thread hides the other panel, and the page forces the right panel open even if you had collapsed it (`chat-page.tsx:214–220`).

### 2.7 Dialogs, picker, switcher

Built on `Dialog` / `CommandDialog` ✓, so they get the floating surface. Inside: the Create-channel people toggles are `rounded-full` 26 px with `SELECTED_OPTION` when on and a `scale-75` avatar (`chat-dialogs.tsx:193–203`). The people picker uses `SELECTED_ROW` ✓ with a check. Picked people are `bg-state-selected` pills with a 16 px × (:311–321). Browse rows: legacy hover, "Join" outline / "Open" ghost (inline heights). The ⌘J switcher groups Unread · Channels · People with an 11 px count. The emoji picker is 288 px, 8 columns of 18 px emoji with legacy hover and a full-strength ring (#7, #8).

### 2.8 States

| State | What shows | Verdict |
|---|---|---|
| Loading | Spinner in the centre; the rail shows the placeholder "Feature tools panel" (live) | #29 |
| Error | `EmptyState` + "Try again" ✓; same placeholder rail | #29 |
| Locked | #30; same placeholder rail | #29, #30 |
| No conversation open | `EmptyState`: "No conversation open", "New message" primary + "New channel" outline, hint "⌘J jumps to any conversation" ✓ | Two buttons; Tasks keeps one action. |
| Archived | A bordered `bg-background` bar in place of the composer, with "Unarchive" | Another well (#31). |
| Not a member | "Join channel" primary `sm` in the header | Fine. |

### 2.9 Bottom bar

Chat adds nothing to it (#13). Left: the left-panel toggle. Centre: the global Search · Quick capture · Create new, each 32 px. Their `BarButton`s use `size-4` icons and an offset focus ring, which is shell debt, not chat's. Right: the right-panel toggle, which says "Collapse right panel" while no right panel exists.

## 3. Kit mapping

| Chat piece today | Should be (DS-6 kit) | Notes |
|---|---|---|
| Rail row (`chat-sidebar.tsx` `Row`) | **NavRow** | `icon` = glyph or 16 px avatar; `indicator` = unread dot; `count` = mentions only; `menu` = star · mute · mark read · leave (today these live only in the header). Needs two additions: a muted state and an unread emphasis (#22). |
| Rail section headers | **GroupHeader** (sentence case, `onToggle`, remembered) or the hairline-only split | See Q3. |
| Group-DM glyph, avatars everywhere | **PersonAvatar** (`components/ui/avatar.tsx`), `AvatarGroup` for stacks | Delete `features/chat/ui/person-avatar.tsx`'s avatar and `initialsOf`; keep `PresenceDot` as a chat-only piece. |
| "Jump to…" field | Nothing in the rail; the **Toolbar** Search (or ⌘K) | Q4. |
| Conversation header | **Toolbar** grammar: `title + count … Search · ⋯` | Star / notify / leave → the ⋯ menu (and the NavRow menu). Details → the right panel's dropdown. |
| Right panel header, Thread / Details / Search switching | **RightPanel** + a `chat/panel-views.ts` registry entry | Q4. |
| Details "About" lines | **PropertyRow** (Topic, Created, Created by, Visibility, Notifications) | Today: an eyebrow and free text. |
| Members list | **CollectionHeader** ("Members 3", + Add) + **Row** with a 16 px avatar | "Remove" in the row's ⋯ menu, not a hover word. |
| Pinned list | **CollectionHeader** + **ItemCard** (hairline, fill hover) | |
| Search results | **Row** (two-line variant) + **EmptyState** `inline` | |
| Reaction pill, add-reaction pill | **Chip** `xs`, `shape="full"`, `active` when it's yours | Count inside the chip in the tertiary level. |
| `@name`, `@channel`, inline code | Stay inline marks (text, not chips) | One mention mark, see Q2. |
| `#ref` | spine `EntityRefChip` (already) → Chip `xs` when the spine adopts it | |
| Day divider | **GroupHeader** `sticky` with the date grammar | Q-free if the designer accepts #25. |
| Thread summary line | Chat-only (below), built from **AvatarGroup** + **MetaCount**-style count + the date grammar | |
| Composer | **FeedComposer** surface + `IconButton`s | Chat-only behaviour on top (below). |
| Hover toolbar | `FLOATING_SURFACE` + `IconButton`s (a small **Toolbar**) | |
| Suggestion list | `Command` / `Popover` (floating surface, `state-active` highlight) | |
| Emoji picker | `Popover` + a grid; cells `state-hover` / `state-active` | |
| People picker, browse, switcher | `Dialog` / `CommandDialog` ✓ + **Row** + **Chip** for picked people | |
| Empty states (search, pins, emoji, browse, people) | **EmptyState** `inline` | |
| Channel intro, locked screen | **EmptyState** `page` (intro), Q5 for locked | |
| Thread panel's "3 replies" rule | **GroupHeader** or a hairline divider with a count | |
| Day-time, relative time | `src/lib/time-format.ts` (`formatTime`, `formatDay`, `formatWhen`, `formatStamp`) | A "how long ago" form doesn't exist in the grammar yet (#4). |

**Genuinely chat-only** (each needs its own north-star definition, the way Tasks defined its timeline and run surfaces):

- **Message row.** Gutter (avatar or hover time) · author line · body · reactions · thread line. One density-bound layout, grouped rows, one hover fill, a reserved toolbar.
- **Composer.** Markup mode, @ / # / : triggers, a typing line, the edit mode, a draft per conversation.
- **Reaction bar.** A row of Chips plus the add pill; the who-reacted tooltip.
- **Thread summary line.** Avatars · "3 replies" · last reply time · the reveal.
- **Unread divider ("New").** The one accent line a conversation keeps (see Q2).
- **Day divider.** Sticky; the grammar's day words.
- **Typing indicator.** A reserved line of tertiary text.
- **Presence dot.** Colour, size and the away form (Q, #23).
- **Jumbo emoji.** The size ladder (#35).
- **App / assistant author mark** (#24).

## 4. What would spread if copied

Like Tasks §5.1, these are the things a Notes, Email or Calendar session would copy from Chat today:

| # | What would spread | Why it's tempting | Section 1 |
|---|---|---|---|
| 1 | **Panels switched from the centre header with pressed icon toggles and an × in the panel** | It's how Slack works and it was fast to build | #1 |
| 2 | **A content column with fixed sizes** inside a density-aware shell | The rail and buttons scale, so it looks done | #2 |
| 3 | **A feature-local avatar and initials helper** | One file, no dependencies | #3 |
| 4 | **Ad-hoc `Intl` and date-fns formatters** | One line each | #4 |
| 5 | **"Status" accents that stack** (tint + bar + pill on one item) | Each was allowlisted alone | #5, #6 |
| 6 | **The inverted pip as the unread count** | It's the loudest, clearest count | #11 |
| 7 | **Border hover on pills and cards** | shadcn's outline defaults | #7, #12, #27 |
| 8 | **Inline `style={{ height: var(--ctrl-h-sm) }}`** on Buttons | It passes `lint:tw` | #17 |
| 9 | **Hand-rolled floating surfaces** (a toolbar, a listbox) | They aren't Radix popovers, so `FLOATING_SURFACE` never reaches them | #9 |
| 10 | **Small-caps section labels with a count inside** ("3 MEMBERS") | They're on the allowlist as debt | #10 |
| 11 | **A search field in the rail** | Slack and Linear both have one | #19 |
| 12 | **A message row that isn't a Row** (its own grid, gap and padding) | Messages aren't list rows | #2, #14 |

## 5. Questions only the designer can answer

**Q1 · How dense is a conversation, and is it a chat setting?**
- *Options:* cozy (Slack's default: avatar + name per group, 36 px gutter); compact (Slack's "compact": name inline on every line, no avatars, the time in the gutter); or one layout that density tunes.
- *Recommend:* one layout, cozy at comfortable, that tightens with the app's density axis (call 44): gutter 36 → 28, avatar 32 → 24, row padding with `--pad-y-sm`, body 14 px at every step. No chat-only toggle (customisation stays on one axis).

**Q2 · How does a mention or an unread conversation show weight without stacking the accent?**
- *Today:* a row tint + a bar + a pill for a mention; an inverted pip that means "unread" on a DM and "mentions" on a channel; weight for unread in the rail.
- *Recommend:* in the conversation, only the `@you` mark carries the accent (no row tint, no bar), and the "New" line is the one accent line. In the rail: an unread conversation gets the NavRow `indicator` dot (neutral); the count shows mentions and DMs only, as a plain tabular number; label weight stays the same for every row.

**Q3 · The rail's grouping: named sections, or Tasks' hairline split?**
- *Today:* three small-caps sections (Starred · Channels · Direct messages), each collapsible.
- *Recommend:* sentence-case `GroupHeader`s "Channels" and "Direct messages" (people need to know which is which, unlike Tasks' "yours vs shared" split); Starred becomes a group at the top that appears only once something is starred, split by the hairline with no label (as Tasks' Pinned does, 29b). Collapse remembered per person.

**Q4 · What are Chat's right-panel views?**
- *Recommend:* register *about this*: **Details** (members, topic, notifications) and **Pinned**; *alongside*: **Search**. A thread opens as an **item** ("← Thread in #launch-plan", per 72a), not a view, so the menu never grows with what you open. The conversation header keeps only title · count · Search · ⋯; the × goes, and the bottom bar's toggle opens and closes the panel (the page stops forcing it open).

**Q5 · Formatting tools in the composer, and the locked screen.**
- *Composer:* ten icons always visible, or @ · # · emoji · Send with formatting shown when text is selected (and ⌘B / ⌘I / ⌘E as today)? *Recommend:* the latter; the thread panel's 302 px row is already full.
- *Locked screen:* keep the four-card marketing page, or an `EmptyState` with one line, one primary and a link to plans? *Recommend:* `EmptyState`, with the rail showing the conversation list greyed out, so the page still teaches what chat looks like.

## 6. Method notes

- Hit-target sweep: every `button`, `a`, `[role=button]`, `input`, `textarea`, `[role=option]` with a box under 24 px, `.hit-min` checked.
- Accent count: on `accent:blue`, every visible element whose background, border, ring or text has a hue was listed. On a mono shade that is exactly the accent plus status colours.
- Density: the same probe at `density:comfortable` and `density:dense` (`--row-h` 2.25rem → 1.75rem confirmed in the frame).
- Live app: 127.0.0.1:8096, read-only (DOM reads and screenshots only; no clicks that change data).
- Not audited because it doesn't exist yet: drag and drop (Chat v1 has no drop target or drag source) and attachments (the composer has no paste or drop surface, and messages have no file rows).
