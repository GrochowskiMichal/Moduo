# How the best chat products look, and Moduo's best chat look

> Raw research report from the Chat re-plan, 2026-10-13. Nothing here is decided.

**Why this exists.** Maciej: *"the current version was a placeholder and no stylistic decisions should carry over to the new version without reconsideration… I like how Discord and Slack look… go in-depth on the competition's visuals and present the best possible option, while still respecting the visual decisions made in the Tasks module and the shell of Moduo. If we can reuse any components that were decided in Tasks, we should."*

**What it covers.** Ten products, element by element (§1), side by side (§2), why Slack and Discord read as good and where v1 and round 1 miss (§3), Moduo's best chat look in Moduo's own tokens and kit (§4), three variants worth prototyping (§5), and every place a Tasks rule would have to bend (§6).

## 0. Method and how sure each number is

Every number carries one tag:

| Tag | Meaning |
| --- | --- |
| **[live]** | Measured in this session with `getComputedStyle` in a browser tab, no sign-in |
| **[css]** | Read from the vendor's own shipped stylesheet, loaded from a public page with no sign-in (Discord's CSS chunks, served to the logged-out `/login` page) |
| **[src]** | Read from the product's open-source code on GitHub (Zulip, Element, Mattermost, Campfire, Telegram Desktop) |
| **[doc]** | Stated in the vendor's help centre, changelog or blog |
| **[approx]** | Known values from earlier inspection and screenshots, not re-measured this session. Treat as ±2 px |

**Limits.**
- **No screenshots this session:** the Browser pane was hidden, so the browser couldn't paint frames. Everything visual was measured from computed styles and shipped CSS instead, which is more exact than reading screenshots, but it means nothing here was eyeballed.
- **Slack, Teams, Google Chat and Linear need a sign-in to load their client CSS** (Slack's sign-in page loads only marketing CSS: checked). Their numbers are [doc] or [approx].
- **Discord was the richest source:** its logged-out `/login` page ships the webpack map of every CSS chunk, so the real message, reaction, divider, composer and theme rules were readable without an account. The theme tokens were resolved per theme in the page.
- **Zulip** was measured live on chat.zulip.org's public view, dark theme, 1440 × 900.
- **Moduo's own round-1 prototype** (`prototypes/round-1.html`) was measured live for comparison (§3.3).

---

## 1. Product by product

### 1.1 Slack (2023–26 design: Home / DMs / Activity tabs)

| Part | What it looks like |
| --- | --- |
| **Layout** | Since the Aug 2023 redesign, a narrow tab rail (Home, DMs, Activity, Later, More), then the sidebar, then the conversation as a **rounded card inset on the workspace colour** [doc][approx]. Structurally the same move Moduo's shell makes: panels as cards on a frame |
| **Message display** | **Clean** (default: photos beside messages) or **Compact** (less white space, no photos). Extra options: typing indicator, 24-hour clock, colour swatches [doc]. A font picker (Latin scripts only) and zoom for size [doc] |
| **Avatar** | 36 px, **rounded square** (radius ≈ 6–8 px). Shown once per group [approx] |
| **Name** | Same size as the body, much heavier: 15 px, weight 900 (Slack's Lato "black"). Full or display name, an admin default the member can override [doc][approx] |
| **Timestamp** | 12 px grey after the name, "10:32 AM". Continuation rows show a short time in the left gutter on hover [approx] |
| **Body** | 15 px / 22 px (≈1.47), Lato. Dark: off-white (#d1d2d3-ish), not pure white [approx] |
| **Grouping** | Consecutive messages from one person collapse under one name and avatar while nobody else posts in between. Slack doesn't document a time window [doc: none found]. In practice a long gap restarts the group [approx] |
| **Rhythm** | Content starts ≈64 px from the pane edge (20 + 36 + 8). About 8 px of air above a group; continuation rows about 4 px apart [approx] |
| **Hover** | A very light full-width fill (≈4% of the text colour), square-edged [approx] |
| **Hover toolbar** | Floats at the row's top-right, overlapping the row's top edge by half its height. Card fill, hairline, small shadow, ≈32 px buttons. Contents: three quick reactions · Add reaction · Reply in thread · Forward · Save for later · ⋮ [approx] |
| **Reactions** | Pills ≈24 px tall, emoji 16 px, count 11–12 px bold. "You reacted" = brand-blue ring + tint + blue count. Add-reaction pill appears at the end on hover [approx] |
| **Threads** | A line under the message: up to 5 tiny square avatars (≈24 px) · "3 replies" in bold link-blue · "Last reply 2 hours ago" in grey. On hover the line becomes a bordered box with "View thread ›" [approx] |
| **Mentions** | `@you` (and @channel / @here) in a yellow highlight; other people's mentions in link-blue on a faint blue fill [approx] |
| **New messages** | A red rule across the list with a small red "New" at its right end [approx] |
| **Day divider** | A sticky centred pill ("Today ⌄", ≈13 px bold) on a full-width hairline. Clicking it opens jump-to-date [approx] |
| **Link previews** | Unfurls under the text with a 4 px grey bar on the left: site · bold title · description · thumbnail. Collapsible [approx] |
| **Files, images** | Images inline (≈360 px max height, rounded). Files as bordered cards: type tile · name · "PDF" [approx] |
| **Code** | Inline code in red-ish text on a light fill; code blocks bordered, monospace ≈12 px [approx] |
| **Edited, deleted** | "(edited)" in grey after the text. A deleted parent with replies reads "This message was deleted." [approx] |
| **System lines** | "joined #channel" as a grey line under the person's name; several joins collapse into "Alex and 3 others joined" [approx] |
| **Composer** | A bordered box (radius ≈8) at the bottom with ≈20 px side margins. The formatting row on top is optional (the "Aa" toggle hides it). Bottom row: + · Aa · emoji · @ · video · audio · / … Send (green when there's text) with a schedule chevron. "X is typing…" sits below the box in small grey text [approx][doc for the indicator] |
| **Sidebar** | Rows ≈28 px, 15 px labels, sentence-case sections (Channels, Direct messages, Apps, custom) with a caret. Unread = **bold white name**; mentions = a red pill with a white number; muted = dimmed. DM rows: ≈20 px rounded-square avatar + presence (filled green = active, hollow = away). The current row takes the theme's highlight [approx] |
| **Header** | ≈50 px: "# name ⌄" bold ≈18 px · member face stack + count · huddle · kebab; a tab row below (Messages · Files · Canvas · +). The topic moved out of the header into channel details in 2023 [approx] |
| **Density options** | Clean / Compact, zoom, font family [doc] |
| **Surfaces** | Light: white card, coloured sidebar (aubergine by default). Dark: ≈#1a1d21 content, slightly different sidebar, many colour themes [approx] |

### 1.2 Discord (the March 2025 visual refresh)

All [css] unless tagged. Class names stripped of hashes.

| Part | What it looks like |
| --- | --- |
| **Settings** | **Message display:** Cozy / Compact. **UI density:** Compact / Default / Spacious (new in the 2025 refresh, separate from message display). **Themes:** Light / Ash / Dark / Onyx (Onyx is near-black, formerly mobile's "Midnight") [doc]. **Chat font scaling** 12–24 px (stylesheet has `font-size-12` … `-24` classes) and **space between message groups** 0 / 4 / 8 / 16 / 24 [css] |
| **Avatar** | 40 px **circle** (`--chat-avatar-size: 40px`), absolutely placed 16 px from the row's left, 4 px below the row top |
| **Content inset** | `calc(40px + 2 × 16px)` = **72 px** from the pane edge; every message, reply, embed and reaction aligns to it |
| **Name** | **16 px (1rem), weight 500**, `--text-strong` (brighter than the body), line height 22 px. Role colour when the server sets one |
| **Timestamp** | Inline after the name: **12 px (.75rem)**, `--chat-text-muted`, 4 px gap. Hover gutter time on continuation rows: **11 px (.6875rem)** in a 56 px column, fades in on hover |
| **Body** | **16 px / 22 px** (`.markup { font-size: 1rem; line-height: 1.375rem }`), `--text-default` (a step dimmer than names). Font gg sans |
| **Vertical rhythm** | Every message row 2 px padding top and bottom (`--custom-message-spacing-vertical-container-cozy: .125rem`). A group start adds **17 px** above it at the default spacing (`.groupStart { margin-top: var(--custom-group-spacing-start) }`; the setting maps 0 / 4 / 8 / 16 / 24 → 1 / 5 / 9 / 17 / 25 px). Group start min-height 44 px |
| **Grouping** | Same author, close in time; a longer gap starts a new group. The window isn't in the CSS; community reports say a few minutes (unverified). A day change always breaks it |
| **Hover** | `--message-background-hover`: the grey mod colour at **12%** (same in every theme), right corners rounded 4 px, left edge full-bleed. `.buttons` (the hover bar) go from opacity 0 to 1 on hover |
| **Hover toolbar** | Top-right, above the row; surface fill, hairline, shadow; quick reactions + Add reaction · Reply · Thread/Forward · ⋯ [approx] |
| **Reactions** | Rounded rectangle, **radius 8 px**, 1 px transparent border, padding 2 × 6 px, emoji 20 px, count **14 px semibold** in `--text-subtle`. Height ≈30 px. Yours = `--reaction-background-reacted` + matching border (the brand blurple tint), count in the brand colour |
| **Mentions of you** | The **whole row** tints yellow at 8% (`--message-mentioned-background-default`) with a **2 px yellow bar** at the left (`.mentioned:before { width: 2px; background: var(--icon-feedback-warning) }`); hover lowers the tint to 4%. The `@name` itself is a blurple 24% pill with light-blue text (`--mention-background/-foreground`) |
| **Replying / highlighted** | The same recipe in brand blue: tint + 2 px bar |
| **New messages** | The divider turns red (`--divider-color: var(--background-feedback-notification)`) with a red **"NEW"** end cap on the right: 13 px tall, 10 px bold. A floating blurple bar at the top (32 px tall, bottom corners radius 8) says how many are new and offers "Mark as read" |
| **Day divider** | A 1 px `--border-subtle` rule across the list, the date centred on it in ≈12 px semibold muted text |
| **Embeds** | Surface-high fill, 1 px subtle border, a **4 px left bar** (neutral, or the site's colour), rounded |
| **Code** | Inline code at 85% with radius 4 on `--background-code` plus a border; code blocks 12–14 px monospace with radius 4 |
| **Quotes** | A 4 px rounded bar on the left, text in `--text-subtle` |
| **Edited** | "(edited)" at **10 px** (.625rem), regular weight |
| **Jumbo emoji** | Emoji-only messages at **48 px** (`--custom-emoji-size-jumbo-emoji: 3rem`) |
| **Composer** | `channelTextArea`: 1 px `--border-muted` (4% grey on dark), **radius 8 px**, filled with the input colour; on focus the border steps to `--border-subtle`. Icons 20 px (`--chat-input-icon-size`). One row: + (attach) on the left, gift / GIF / sticker / emoji on the right; it grows with the text |
| **Sidebar** | Channel rows ≈32 px; an unread channel gets a **4 × 8 px white pill** at the rail's left edge (`.unreadPill`) and a bright, bolder name; mentions get a red number badge; muted channels dim [css for the pill, approx for the rest] |
| **Header** | 48 px title bar: # name · topic (truncated, muted) · icons (threads, notifications, pins, members) · search [approx] |
| **Surfaces (resolved per theme)** | **Ash:** base L 0.30 → 0.34, chat 0.35, body text 0.96, muted 0.75. **Dark:** base 0.18 → 0.25, chat 0.26, body 0.95, muted 0.68. **Onyx:** base pure black, chat 0.17, surfaces 0.15–0.18, body **0.87** (deliberately dimmed on black), names 0.90, muted 0.61. **Light:** chat white, body 0.30. Hover and borders are translucent grey (12%), so they re-resolve on every theme |

### 1.3 Microsoft Teams (new Teams, 2024–26)

| Part | What it looks like |
| --- | --- |
| **Density** | **Comfy** (default: more space) / **Compact** ("more condensed, with less space between messages"). Under Settings → Chats and channels → Message density; message previews in the chat list are a separate toggle [doc] |
| **Chats** | **Bubbles.** Others: left, ≈32 px round avatar, name + time above a light-grey bubble. Yours: right-aligned, tinted with the brand lavender, no avatar. Font Segoe UI ≈14 / 20 [approx] |
| **Channels** | Posts as cards with reply threads under them; newer "threaded/chat-style channels" bring chat-like rows to channels [approx] |
| **Hover** | A floating reaction bar above the bubble with six defaults (👍 ❤️ 😆 😮 😢 😡) + more reactions + "…" [approx] |
| **Reactions** | Small pills under the bubble; yours outlined in the brand colour [approx] |
| **Mentions** | `@you` in a coloured, bold mention; mentioned messages get a left-edge marker in the chat list [approx] |
| **Take-away** | Bubbles suit 1:1 talk. In a channel of 5 people the alternating sides and per-bubble chrome make scanning slower, which is why Teams' channels don't use them |

### 1.4 Google Chat (Material 3)

| Part | What it looks like |
| --- | --- |
| **Density** | **Comfortable** (default; Material 3; bubbles clearly differentiated) / **Compact**: "message bubbles aligned in the same direction for both sender and recipient", "wider message bubbles", reduced padding in the left bar, conversation list and home (Oct 2024) [doc] |
| **Messages** | Rounded tonal bubbles; ≈32 px round avatars; name ≈14 / 500 with a small grey time; Google Sans Text ≈14 / 20 [approx] |
| **Hover** | Add reaction · Reply in thread · Forward to inbox · More [approx] |
| **Reactions** | Pills; yours on a light-blue tonal fill [approx] |
| **Take-away** | Google itself moved away from left/right bubbles for people who read a lot: Compact aligns everything one way |

### 1.5 Linear (no chat; the aesthetic Moduo's Tasks follows)

| Part | What it looks like |
| --- | --- |
| **The 2024 redesign** | Sidebar, tabs, headers and panels cut back to reduce clutter; **Inbox made denser, with higher contrast**; default themes gained contrast; themes generated in LCH [doc] |
| **Inbox** | Two-line rows: the item's title, then "who did what · when" in grey; small round avatars; unread = a dot plus bolder text [approx] |
| **Comments** | Hairline cards in the item's activity: ≈20 px avatar · name 13 / 500 · grey time · body ≈14 / 1.5 [approx] |
| **Take-away** | Linear's lesson for chat is restraint, not layout: hairlines, translucent fills, three text greys, small round avatars, no colour except where it means something. Moduo's FeedCard and FeedItem already copy this |

### 1.6 Campfire (37signals, ONCE, open source)

All [src] (`basecamp/once-campfire`, `app/assets/stylesheets/messages.css`, `models/message_formatter.js`).

| Part | What it looks like |
| --- | --- |
| **Messages** | **Bubbles all aligned left**: the body sits on `--color-message-bg` with radius .66em and padding .66rem × 1.5 inline-space. Your own messages get the `me` class and go full width |
| **Meta is quieter than the content** | The author is **.8rem, weight 400** (not bold); the time is a .8rem permalink at **50% opacity** |
| **Avatar** | 3.5ch round, with a ring in the page colour |
| **Rhythm** | **1.33em** between messages; consecutive messages by one author within **5 minutes** are "threaded" and tuck up under the previous one (`THREADING_TIME_WINDOW_MILLISECONDS = 5 * 60 * 1000`) |
| **Day separator** | A centred pill, .8rem / 600, **uppercase**, on a 2 px rule |
| **Reactions** | "Boosts": a short text or emoji reply attached to a message, shown under it |
| **Type** | The system font stack, line height 1.4 |
| **Take-away** | The calmest of all ten: no hover toolbars, no colour, no counts. It looks friendly because content sits on soft bubbles and the meta whispers |

### 1.7 Zulip (measured live on chat.zulip.org, dark)

| Part | What it looks like |
| --- | --- |
| **Structure** | Messages sit in **topic blocks**: a 44 px recipient bar (channel name + topic, 17.1 px / 600, the date at the right) over a card of messages (`#222` on a `#1c1c1c` page) [live] |
| **Avatar** | **40 px, rounded square, radius 4 px** [live] |
| **Name** | **16 px / 700**, 85% white [live] |
| **Time** | **14.86 px, weight 350**, in a right-hand column (not beside the name) [live] |
| **Body** | **16 px / 22.4 px** (1.4), Source Sans 3 [live] |
| **Grouping** | Same sender inside the same topic block is grouped **with no time window**; a date change breaks it (`same_sender` = same `sender_id`) [src] |
| **Controls** | Inline at the top-right of each message (not floating), visible on hover [src] |
| **Reactions** | Pills **26.4 px tall, fully round (radius 21)**, a dark 30% fill, count 14.4 px [live] |
| **Mentions** | Mentioned messages get a coloured left marker and tint; the `@name` is a coloured pill [approx] |
| **Sidebar** | Channel rows **27.4 px**, 16 px labels, unread counts as plain numbers on a pill [live for rows] |
| **Header** | 40 px [live] |
| **Composer** | Collapsed into "Start new conversation" / "Reply" buttons until clicked (spectators can't post) [live] |
| **Density** | "Information density" settings: font size and line spacing [doc] |
| **Take-away** | Strong structure, but heavy: three text weights in one line, a coloured bar per topic, time far from the name. Proves that a 40 px rounded-square avatar plus 16 px body reads well; also proves that too many bars feel bureaucratic |

### 1.8 Telegram Desktop (open source)

All [src] (`Telegram/SourceFiles/ui/chat/chat.style`, `history/history_item.cpp`).

| Part | What it looks like |
| --- | --- |
| **Messages** | Bubbles, max width **430 px**, min 160, padding **11 × 8 px**, 2 px shadow; the time sits inside the bubble's bottom-right in **13 px** |
| **Avatar** | **33 px**, once per group, at the group's bottom |
| **Grouping** | Same sender within **15 minutes** (`kAttachMessageToPreviousSecondsDelta = 900`); attached bubbles get 0 px top margin (`msgMarginTopAttached`) |
| **Unread bar** | A **32 px** full-width bar, semibold "Unread messages" |
| **Service lines** | Joins and renames as centred pills (padding 12 × 3), semibold |
| **Reactions** | Inline in the bubble's footer: emoji 18 px, padding 5 / 2 / 7 / 2 |
| **Big emoji** | 36 px |
| **Density** | Interface scale 100–300% [doc/approx] |
| **Take-away** | Superb for 1:1, but bubbles waste the width of a desktop pane and push the eye left and right |

### 1.9 Element (Matrix, open source)

All [src] (`element-web`, `packages/shared-components/…/EventTileView.module.css`).

| Part | What it looks like |
| --- | --- |
| **Layouts** | **Modern** (default) · **Message bubbles** (radius 12, own messages on green-300) · **IRC**; a compact Modern toggle and a font-size slider [src][doc] |
| **Geometry** | Content gutter **64 px**; line height **22 px** (1.375rem); a new sender's group starts with **18 px** top padding; continuation lines 1 px above, 3 px below |
| **Avatar** | ≈30 px circle [approx]; names coloured from a per-user hash of 8 colours |
| **Time** | Hover column **46 px** wide on the left |
| **Hover** | `--cpd-color-bg-subtle-secondary`, rows radius 8 |
| **Mentions of you** | The row turns **yellow-200** |
| **Selected** | A **4 px** marker in the action colour at the row's left |
| **Action bar** | Buttons **28 px**, 3 px margins, 8 px from the right, sitting above the row's top edge |
| **Thread summary** | A 24 px line under the message |
| **Take-away** | Discord's geometry with Slack's calmness; the yellow mention tint is the loud part |

### 1.10 Mattermost (open source)

All [src] (`webapp/channels/src/sass/components/_post.scss`, `utils/constants.tsx`).

| Part | What it looks like |
| --- | --- |
| **Row** | Padding 8 px top, .5em right, 0 bottom, 1.5em left; hover = the text colour at **4%** |
| **Avatar** | ≈32 px circle in a 53 px column (10 px gap) [src for the column, approx for the image] |
| **Body** | 14 px Open Sans, line height **1.5** |
| **Grouping** | Same user within **5 minutes** (`POST_COLLAPSE_TIMEOUT: 1000 * 60 * 5`) |
| **Mentions** | A highlight fill plus a **4 px** left border on replies that mention you |
| **Reactions** | A list at least 30 px tall |
| **Density** | Standard / Compact message display, clock, colourised names in Compact [doc/approx] |
| **Take-away** | Slack's layout at a smaller type size. Reads busier than Slack because 14 px Open Sans plus bold names plus blue links all compete |

---

## 2. Side by side

### 2.1 The message row

| | Avatar | Name | Time by the name | Body (size / line) | Content inset | Air above a group · inside it | Group breaks after | Hover |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Slack** | 36, rounded square | 15 / 900 | 12, grey | 15 / 22 | ≈64 | ≈8 · ≈4 | another poster (no documented window) | ≈4% fill, full width |
| **Discord** | 40, circle | 16 / 500, brighter than body | 12, muted | 16 / 22 | 72 | 17 (setting 1–25) · 2+2 | a few minutes (unverified), day | 12% grey, square left edge |
| **Teams** | ≈32, circle | ≈12–14 / 600 above bubble | ≈12 | ≈14 / 20 in bubbles | bubble | bubble gaps | — | the bubble |
| **Google Chat** | ≈32, circle | ≈14 / 500 | ≈12 | ≈14 / 20 in bubbles | bubble | bubble gaps | — | the bubble |
| **Zulip** | 40, rounded square r4 | 16 / 700 | 14.9 / 350, right column | 16 / 22.4 | ≈56 | topic bar 44 · ≈5 | another sender (no window), day | fill |
| **Element** | ≈30, circle | ≈15 / 600, hashed colour | hover column 46 | ≈15–16 / 22 | 64 | 18 · 1+3 | another sender | subtle fill, radius 8 |
| **Mattermost** | ≈32, circle | 14 / 600 | ≈12 | 14 / 21 | ≈53 + 1.5em | 8 · small | **5 min** | 4% fill |
| **Campfire** | 3.5ch, circle | .8rem / **400** | .8rem at 50% | ≈16 / 1.4 in bubbles | bubble | 1.33em · tucked | **5 min** | none |
| **Telegram** | 33, circle (group bottom) | semibold in bubble | 13 inside bubble | ≈13 scaled | bubble | small · 0 | **15 min** | none |
| **Moduo v1** | 32, grey, one initial | 13 / 500 display | 11 | **13 / 18.6** | 56 | ≈10 · 4 (`pt-2 pb-0.5` / `py-0.5`; fixed at every density) | — | 5% |
| **Moduo round 1** [live] | 32, hue, two initials | 14 / 600 | 12 tertiary | 14.5 / 22.5 | 62 | **12 · 8** (6 + 6 vs 6 + 2: barely two speeds) | — | 5% |

### 2.2 Reactions, mentions, dividers

| | Reaction shape | "You reacted" | Mention of you | Others' mentions | New-messages line | Day divider |
| --- | --- | --- | --- | --- | --- | --- |
| **Slack** | pill ≈24 | brand blue ring + tint | yellow highlight on the word | blue text on faint blue | red rule, "New" at the right | sticky centred pill on a hairline |
| **Discord** | rounded rect r8, ≈30 | brand tint + border | **row** tint 8% yellow + 2 px bar; blurple pill on the word | blurple pill | red rule + red "NEW" cap; floating "N new" bar | centred date on a hairline |
| **Teams** | pill | brand outline | coloured bold mention | coloured | divider | centred date |
| **Zulip** | full pill 26 | coloured | row marker + pill | pill | — (unread marker bar per row) | date in the topic bar |
| **Element** | pill | accent | **row** yellow | pill | "New" marker line | centred date |
| **Mattermost** | pill ≥30 | accent | fill + 4 px left border | link-coloured | red "New messages" line | centred date |
| **Telegram** | inline in bubble | accent | — | link-coloured | 32 px "Unread messages" bar | centred floating pill |
| **Campfire** | boosts (text) | — | `mentioned` class tint | — | — | centred uppercase pill |
| **Moduo v1** | 24 pill, opaque border | the selection recipe | row tint + 2 px bar + pill (4 accents) | grey pill | accent line 60% | bordered pill on two opaque rules |

### 2.3 Composer, sidebar, header, density

| | Composer | Sidebar row | Unread | Mention count | Header | Density options |
| --- | --- | --- | --- | --- | --- | --- |
| **Slack** | bordered box r≈8, optional format row, Send turns green | ≈28, 15 px | **bold white name** | red pill | ≈50 + tab row | Clean / Compact, zoom, font |
| **Discord** | filled box r8, 1 px faint border, one row | ≈32 | white pill at the left edge + bright name | red number badge | 48 | Cozy / Compact × UI Compact / Default / Spacious × font 12–24 × group space 0–24 |
| **Teams** | rounded box, format on demand | ≈32–36 | bold | number badge | ≈48 + tabs | Comfy / Compact |
| **Google Chat** | rounded M3 field | ≈32 | bold | number badge | ≈56 | Comfortable / Compact |
| **Zulip** | collapsed until clicked | 27.4, 16 px | count | count pill | 40 | font size, line spacing |
| **Element** | flat field + icons | ≈32 | bold + dot | number badge | ≈56 | Modern / Bubbles / IRC, compact, font size |
| **Mattermost** | bordered box + format row | ≈28–32 | bold | mention pill | ≈62 | Standard / Compact |
| **Moduo v1** | **black inverted well, 10 icons always** | 36 / 32 / 28, 13 px | 500 weight + pip | **inverted pip, two meanings** | 55.5 (off the bar grid) | the app axis, but messages ignore it |

**Patterns worth noting:**
- **Nobody under 14 px body, and the two Maciej likes are 15 and 16.** Moduo v1 is 13.
- **Names are the body's size, heavier.** Slack 15/900 on 15, Discord 16/500 on 16, Zulip 16/700 on 16. Campfire is the exception, and deliberately whispers.
- **Two speeds of vertical space.** Inside a group, 2–4 px; above a group, 8–18 px. That alternation is most of the "rhythm".
- **One content edge.** Every product aligns body, reactions, embeds, thread lines and system lines to one inset (Slack ≈64, Discord 72, Element 64).
- **Every group-chat tool for teams is flat rows, not bubbles.** Bubbles live in 1:1 products (Teams chats, Google Chat comfortable, Telegram), and Google added Compact precisely to drop the left/right split.
- **Hover is a translucent fill, never a border.** 4–12%.
- **The hover toolbar floats** (Slack, Discord, Element), overlapping the row's top edge, with a shadow. Zulip's inline controls are the only exception and read as clutter.
- **Mentions of you are the loudest thing in every product**, always a non-brand warm colour (yellow) or a full row tint. That's the one place Moduo's rules push back hardest (§6).
- **The new-messages line is red in every product that has one.** Moduo has no red to spend (§6).
- **Density settings converged on two message layouts** (cozy with avatars / compact without) plus a separate UI-density or font-size axis. Moduo decided one app-wide axis (CH27).

---

## 3. Taste: why Slack and Discord read as good

### 3.1 What specifically makes them good

1. **Reading-size content.** 15–16 px with a 22 px line. A 2–5 person team reads hundreds of lines a day; chat text is content, not chrome, so it sits at the top of the type ladder for content, not the bottom.
2. **Hierarchy by weight, not by grey.** The name is the body's size, bolder (and a touch brighter in Discord: `--text-strong` over `--text-default`). Only the time is small and grey. Three steps, all readable: the same idea as Tasks rule 38.
3. **One anchor per group, then bare lines.** The avatar and name appear once; continuation lines carry nothing at rest. The eye finds the speaker, then reads.
4. **Two speeds of vertical space.** About 2–4 px between lines of one group, 8–17 px before a new group (Discord: 4 px vs 21 px row to row). It's what turns a wall of text into a conversation. Round 1 nearly misses it: 8 px inside a group vs 12 px between groups.
5. **One left edge for everything.** Body, reactions, embeds, thread line, system lines and the hover time all hang off one inset. Nothing jitters.
6. **Chrome appears only when asked.** The toolbar, the gutter time and the add-reaction pill are invisible at rest; they arrive in place without moving anything.
7. **Generous but not loose avatars.** 36–40 px is big enough to carry identity (photos, colour) from across the room. Slack's rounded square and Discord's circle both work; what matters is the size and that it's coloured, not grey.
8. **Quiet surfaces, layered.** Content sits on one surface; the sidebar and the frame are a step away (Slack's coloured sidebar, Discord's three grey ladders). Hover and borders are translucent, so they work on every theme. Discord's darkest theme even dims body text to L 0.87 to cut glare on black.
9. **A composer you can't miss.** A filled or clearly bordered box, radius 8, full width, at a constant height at rest, with a handful of tools.
10. **Almost no motion.** Hover is instant or near-instant; the toolbar appears without animating; nothing slides.
11. **Colour only where it means something.** Avatars, emoji, links, one warm mention colour, one red "new" line. The text column itself is monochrome.

### 3.2 Where v1 goes against that (from the visual audit)

| v1 | Against | Audit # |
| --- | --- | --- |
| Body **13 px / 18.6**, a step below Moduo's own body size; the composer types at a different size | 1 | 14 |
| Names in the display face at **13 / 500**, the same weight as UI labels: names don't anchor | 2, 3 | 32 |
| **Grey avatars for everyone** with one initial: no identity, nothing to find a speaker by | 3, 7 | 3 |
| **Fixed sizes at every density**: rhythm doesn't scale with the rest of the app | 4 | 2 |
| Mention = tint + bar + pill + lost hover: **four accent marks** for one fact | 11 | 5, 6 |
| **Opaque borders** on reactions, day pills, code, the toolbar: everything outlined | 8 | 31 |
| **Border hover** on pills and the thread line, fill hover elsewhere: four hover languages | 6 | 7, 27 |
| **A black inverted composer well with ten icons** always visible | 9 | 26 |
| **Day divider as a bordered pill on two opaque rules** in the display face | 8 | 25 |
| **Small caps** in the rail and panels; "3 MEMBERS" | — (rule 40) | 10 |
| **A header 55.5 px tall** with seven controls, off the shell's bar grid | 6 | 20 |
| **Five count languages**, an inverted pip with two meanings | 11 | 11 |

### 3.3 What round 1 already fixed, and what it still misses [live]

Round 1 (`prototypes/round-1.html`, measured at 1440 × 900):
- **Fixed:** avatars 32 px with two initials on a hue; names 14 / 600; body **14.5 / 22.5**; time 12 px tertiary; hover 5% fill, radius 8; day line 12 px on hairlines; the composer filled at 3% with a 14% border, radius 12; the toolbar floats.
- **Still misses:**
  - **Little group air:** a new speaker gets 12 px (6 + 6) where a continuation gets 8 px (6 + 2). Slack and Discord give a new group two to five times the gap inside one.
  - **14.5 px isn't a token** (the ladder has 14 and 15).
  - **The composer recipe is ad hoc** (a 3% fill and a 14% border nobody else uses); the kit's FeedComposer is hairline-only.
  - **Reactions are a third chip look:** 22 px full pills with a hairline and 12 px text, not the kit's Chip.
  - **The hover toolbar is ten controls** (six reactions, any emoji, Reply, "Task", ⋯) at 26 px: about 270 px, more than a 320 px thread panel can spare beside a message.
