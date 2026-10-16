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
| **Surfaces (resolved per theme; the stylesheet's classes are `theme-dark`, `theme-darker`, `theme-midnight`; mapping them to Ash, Dark and Onyx is my inference from their lightness and the "Midnight is now Onyx" note)** | **Ash:** base L 0.30 → 0.34, chat 0.35, body text 0.96, muted 0.75. **Dark:** base 0.18 → 0.25, chat 0.26, body 0.95, muted 0.68. **Onyx:** base pure black, chat 0.17, surfaces 0.15–0.18, body **0.87** (deliberately dimmed on black), names 0.90, muted 0.61. **Light:** chat white, body 0.30. Hover and borders are translucent grey (12%), so they re-resolve on every theme |

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
| **Density** | Font size 12–20 from the profile menu, plus a separate line-spacing setting [doc] |
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
  - **The hover toolbar is ten controls** (six reactions, any emoji, Reply, "Task", ⋯) at 26 px: about 270 px, more than the 320 px right panel can spare when a reply chain is open there.

---

## 4. Moduo's best chat look (the recommended variant, C)

Expressed only in Moduo's tokens and kit. "New" in a cell means the kit or the tokens need an addition; §6 lists each one as a tension for the designer.

### 4.1 Eight principles, taken from §3 and fitted to Moduo

1. **Reading-size content:** messages at `text-md` 15 px / `--leading-normal` 1.5 (22.5 px), the same size as a Tasks title. Not 13 (v1), not 14.5 (round 1).
2. **Hierarchy by weight:** name 15 / 600, body 15 / 400, meta 12 in the tertiary level. Three readable levels (rule 38), nothing fainter.
3. **One anchor per group:** PersonAvatar + name once; continuation lines bare.
4. **Two speeds of space, bound to density:** 4 px between lines of a group at every density; 18 / 15 / 12 px before a new group (comfortable / compact / dense).
5. **One content inset** for body, reactions, files, reply lines, system lines and the hover time.
6. **Chrome on demand, one floating surface:** the hover toolbar, gutter time and add-reaction chip fade in in reserved space; the toolbar is `FLOATING_SURFACE`.
7. **One accent mark per fact** (CH28, rule 46): the `@you` mark and the "New" line; selection and Send are the accent's other two uses. Everything else is the state layer.
8. **Everything translucent:** `state-*` fills and `hairline`, so the whole module follows shades, accents and light/dark with no chat-only colour.

### 4.2 The message row (`MessageRow`, chat-only)

A chat-only primitive, like Tasks' Timeline (re-plan §5: "the message row needs its own north-star definition"). It isn't the kit's `Row` because messages vary in height; it uses Row's language (rounded inset, fill hover, the selection recipe).

| Part | Token / component | Comfortable | Compact | Dense |
| --- | --- | --- | --- | --- |
| List side padding | `px-2` | 8 | 8 | 8 |
| Row radius | `rounded-md` | 8 | 8 | 8 |
| Row padding, inline | `--pad-x-sm` | 12 | 10 | 8 |
| Row padding, block (every row) | `py-0.5` | 2 | 2 | 2 |
| Group start: extra space above | `margin-top: --pad-y` + `padding-top: --pad-y-sm` | 10 + 6 | 8 + 5 | 6 + 4 |
| → text-to-text gap inside a group / before a group | — | **4 / 18** | **4 / 15** | **4 / 12** |
| Avatar | `PersonAvatar`, round (`rounded-avatar`), hue via `bg-label-fill`, two initials; **new** density-bound size `--avatar-row` | 32 | 28 | 24 |
| Avatar initials | `personFill`: `text-xs` / `text-2xs` / `text-2xs`, 600 | 12 | 11 | 11 |
| Avatar position | top-aligned with the name line | — | — | — |
| Avatar → text gap | `--pad-x-sm` | 12 | 10 | 8 |
| **Content inset** (row edge → text; add 8 for the panel edge: 64 / 56 / 48, Slack's 64 at comfortable) | sum of the above | **56** | **48** | **40** |
| Name | `font-sans text-md font-semibold text-foreground`, line `--leading-normal` | 15 / 600 | 15 / 600 | 15 / 600 |
| "via Claude" (CH18) | `text-xs text-muted-foreground` after the name | 12 | 12 | 12 |
| Time by the name | `font-sans text-xs text-subtle-foreground tabular-nums`, `formatTime` ("3:00 PM"), tooltip `formatStamp` ("Oct 6, 12:07 PM"), `gap-2` after the name, baseline-aligned | 12 | 12 | 12 |
| Body | `font-sans text-md text-foreground`, `--leading-normal`; paragraphs `mt-1.5` | 15 / 22.5 | 15 / 22.5 | 15 / 22.5 |
| Continuation time (gutter) | `text-2xs text-subtle-foreground tabular-nums`, right-aligned in the inset, `opacity-0 → 100` on row hover / focus-within over `--motion-fade` | 11, shown | 11, shown | **hidden** (the inset is too narrow for "12:59 PM"; the time stays in the row's tooltip) |
| Hover | `bg-state-hover` (5%), `--motion-fade` | — | — | — |
| Keyboard-selected message (↑/↓, `R`, `T`) | `SELECTED_ROW` (accent tint + edge); focus ring `ring-2 ring-ring/50` inset | — | — | — |
| Landing from a link | `SELECTED_ROW` for 2 s, then fades over `--motion-slow` | — | — | — |

**Grouping rule (no product documents a better one):** same author, nobody else in between, the same day, no "New" line between, and **at most 5 minutes** since their previous message (Mattermost and Campfire's window; Telegram's 15 min is for 1:1; Zulip's "no window" works only because topics split the stream).

### 4.3 Hover toolbar

| Part | Token / component | Value |
| --- | --- | --- |
| Surface | `FLOATING_SURFACE` + `shadow-md`, `p-0.5` | popover fill, 1 px hairline, `rounded-md` |
| Position | absolute, top = −(half a small control + 2 px), right = `--pad-x-sm`; overlaps the row's top edge like Slack, Discord and Element | ≈ −15 / −14 / −13 px |
| Buttons | `IconButton size="sm"` (`--ctrl-h-sm` 26 / 24 / 22); emoji buttons on the same rung with emoji at `--icon` (16 / 15 / 14) | — |
| Separator | `w-px h-4 bg-hairline mx-1` | — |
| Contents (recommended) | **3 quick reactions** (the first three of your personal row, CH16a) · ☺+ (any emoji) · │ · Reply (CH30's one action) · Make a task · ⋯ | 7 controls ≈ 196 px at comfortable |
| Contents (CH16 as decided) | the six reactions · ☺+ · │ · Reply · Task · ⋯ | 10 controls ≈ 280 px; doesn't fit the 320 px right panel (§6 #13) |
| Arrival | opacity over `--motion-fade`, no movement; stays while its ⋯ menu is open | — |
| Same verbs elsewhere | right-click opens the same items with a quick-reaction row on top (v1's good idea, kept) | — |

### 4.4 Reactions

| Part | Token / component | Comfortable | Compact | Dense |
| --- | --- | --- | --- | --- |
| Row | `mt-1`, `flex flex-wrap gap-1` under the body | 4 | 4 | 4 |
| Chip | `ChipButton size="xs"` (`--ctrl-h-xs`), `shape="md"` (radius 8, the kit's chip shape and Discord's) | 24 | 22 | 20 |
| Emoji | `--icon` | 16 | 15 | 14 |
| Count | Chip xs text: `text-sm tabular-nums text-muted-foreground` | 13 | 13 | 13 |
| You reacted | `active` → `bg-state-active`; count `text-foreground font-medium`. **Neutral, not the accent** (rule 46) | — | — | — |
| Hover | the chip's own `hover:bg-state-hover` / `hover:bg-state-active-hover` | — | — | — |
| Who reacted | tooltip on `FLOATING_SURFACE`: "Sofia, Alex and you" | — | — | — |
| Add reaction | `ChipButton xs` with `SmilePlus`, muted; fades in at the end of the row on hover (reserved slot); only when reactions exist | — | — | — |
| Custom emoji (CH16b) | a 16 px image inside the same chip | — | — | — |
| Hit target | `.hit-min` keeps 24 px at dense | — | — | — |

### 4.5 Replies (styled for CH30's proposal: replies, not threads)

CH30 proposes one action, Reply: a reply posts in the stream with a quote line; a message with replies gets a reply line; a tangled chain folds into one row. These are the looks, in the same tokens.

| Part | Token / component | Value |
| --- | --- | --- |
| **Quote line** (above a reply's body) | one line, height 20: `CornerUpLeft` at `--icon-xs` in `text-subtle-foreground` · `PersonAvatar size="icon"` · the author `text-sm font-medium text-foreground` · the quoted words `text-sm text-muted-foreground`, truncated (people's words give way, rule 42); hover `bg-state-hover rounded-sm`; click jumps to the original. Discord's reply preview, without its curved spine | 13 |
| **Reply line** (under a message with replies): "2 replies · Alex, Mike ›" | `mt-1`, height `--ctrl-h-sm` (26 / 24 / 22), `-ms-1 px-1 rounded-md gap-2`: `AvatarGroup` of up to 3 `PersonAvatar size="icon"` (`ring-2 ring-card`, `-space-x-1`) · "2 replies" `text-sm font-medium text-foreground` · the names `text-sm text-muted-foreground` · `ChevronRight` `--icon-xs` tertiary. New replies: "2 new" in the count's style (no dot, no colour). Hover `bg-state-hover`; the chain open in the panel: `bg-state-active` | 13 / 500 |
| **Folded chain row** (CH30 item 3) | one row at the content inset, height `--row-h-sm` (28 / 26 / 24), `rounded-md`, hover `bg-state-hover`: `CornerDownRight` `--icon-sm` tertiary · "Sofia's" `font-medium` + the quoted start in `text-muted-foreground` · "6 replies" `font-medium` · "Anna: Sent them…" muted · the time `text-xs` tertiary (`formatWhen`); all `text-sm`; the quote gives way first | 13 |
| **Wrapped-up chain** (CH30 item 4) | the folded row with a `Check` at `--icon-xs` and the settling reply's words instead of the latest; no colour (the done check's accent is Tasks' alone) | — |
| Times | `formatWhen` ("3:40 PM", "Mon, 3:40 PM"); no "2 hours ago", the grammar has no relative form | 12 |

### 4.6 Text marks inside a message

| Mark | Token / component |
| --- | --- |
| `@person` | inline, `font-medium text-foreground bg-state-active rounded-sm px-0.5`; hover `bg-state-active-hover`; opens the person card |
| **`@you`, `@channel`, `@everyone`** | inline, **`bg-primary text-primary-foreground font-medium rounded-sm px-0.5`**: the one accent mark in the text. On the default mono accent it's a white mark with near-black text, the strongest contrast on the screen, so it's found without a row tint (§6 #4) |
| `#tag` (CH14) | the Tasks tag chip (shared tag store), inline at Chip `xs` |
| References (RF-1) | `EntityRefChip` inline; a reference alone on a line becomes its RF-1 card |
| Links | `text-foreground underline underline-offset-2 decoration-muted-foreground`, hover `decoration-foreground`. Not blue: the text column stays monochrome |
| Inline code | `font-mono text-sm bg-state-active rounded-sm px-1` |
| Code block | `font-mono text-sm` / `--leading-normal`, `bg-state-hover ring-1 ring-inset ring-hairline rounded-md px-3 py-2`, horizontal scroll; over 20 lines → "Show more" (`Button ghost sm`); Copy `IconButton sm` fades in at top-right |
| Quote | `border-s-2 border-hairline ps-3 text-muted-foreground` |
| Emoji, four sizes | inline in text 1.375em (≈20 px; Discord's ratio) · reactions and toolbar `--icon` · picker grid `--icon-lg` (20 / 18 / 16) · jumbo (≤ 3 emoji alone) `text-4xl` 36 |

### 4.7 Files, images, previews

| Item | Token / component | Value |
| --- | --- | --- |
| One image | `max-w-[…]` is banned (R10), so a **new** layout token `--media-max` (400 × 300, both densities); `rounded-md`, `ring-1 ring-inset ring-hairline` over the image so dark images separate from the card; ⋯ `IconButton sm` on `FLOATING_SURFACE` in the corner on hover; click → the AT-3 viewer | 400 × 300 |
| Several images | 2-column grid, `gap-1`, square crops at half `--media-max`; outer corners `rounded-md`, inner square (R3) | — |
| File | the kit `Card` in its compact form: `px-3 py-2 gap-3`, max width 360; a 32 px tile (`rounded-md bg-state-active`, `FileText` at `--icon`, muted) · name `text-base font-medium` (truncates in the middle) · "PDF · 2.4 MB" `text-xs text-subtle-foreground`; hover `bg-state-hover`; Download `IconButton sm` fades in | 48 tall |
| PDF (CH17 previews inline) | first-page thumbnail 200 × 260, `rounded-md ring-hairline`, the file line under it | — |
| Uploading | a neutral `Progress` inside the file card; failure "Not uploaded · Retry" | — |
| Link preview (outside sites; "Later" per CH26) | `Card`: `rounded-lg border-hairline p-3`, max 520; site `text-xs` tertiary · title `text-base font-medium` · description `text-sm text-muted-foreground`, 2-line clamp · a 64 px thumbnail at the right or an image (max height 240) below. **No coloured side bar** (Slack's grey bar and Discord's coloured bar both left out) | — |

### 4.8 States and system lines

| State | Treatment |
| --- | --- |
| Edited | "(edited)" `text-xs text-subtle-foreground` after the last line; tooltip "Edited Oct 6, 12:07 PM" |
| Editing in place | the composer recipe (§4.10) replaces the body in the row; "Esc to cancel · ⏎ to save" in `text-xs` tertiary with `Kbd`. No legacy fill |
| Sending | the body at a state fade (`opacity-60`, ≈7:1, as v1); a spinner only after 2 s |
| Not sent | under the body: `CircleAlert` (`--icon-sm`, muted) · "Not sent" `text-xs text-foreground` · `Button ghost sm` "Retry" · "Discard" (24 px hits). Neutral: no red |
| Deleted with replies | "Deleted message" in `text-muted-foreground`; reactions go, the reply line stays (tech decision 10) |
| Pinned | `Pin` at `--icon-xs` + "Pinned" `text-xs` tertiary after the time. No row tint |
| Joins, leaves, renames, topic, links (CH2) | `FeedItem` at the content inset: `PersonAvatar icon` · `text-xs text-muted-foreground` with the actor in `font-medium` · the time tertiary. Height `--row-h-sm`. Consecutive joins collapse: "Alex, Sofia and 2 others joined" |
| Start of a conversation | `EmptyState size="inline"` with the conversation's icon: "This is the start of Acme" + the linked item's card when there is one |

### 4.9 Dividers

| Divider | Token / component | Value |
| --- | --- | --- |
| **Day** | `GroupHeader sticky` (`--row-h-sm`: 28 / 26 / 24; label `text-sm font-medium` sentence case) followed by a `flex-1 h-px bg-hairline` rule; `bg-card` while stuck; `mt-(--pad-y)`. Label from the grammar: **Today · Yesterday · Mon · Oct 9 · Oct 9, 2025** (the past weekday needs a grammar addition, §6 #7). Left-aligned, like every Tasks group header | 28 / 26 / 24 |
| **New** | a 1 px `bg-primary` rule from the content inset to the row's end, with "New" in `text-xs font-medium text-primary` at the right end on a `bg-card` pad; 16 px tall, `my-1`. The one accent line (CH28) | 16 |
| Unread above the view | a floating `ChipButton sm` on `FLOATING_SURFACE` at the top centre: "12 new · Mark read" | — |
| Scrolled up | "↓ Jump to latest" `ChipButton sm` on `FLOATING_SURFACE` at the bottom centre | — |

### 4.10 Composer

| Part | Token / component | Comfortable | Compact | Dense |
| --- | --- | --- | --- | --- |
| Surface | `FeedComposer` with a **new `filled` look**: `bg-state-hover` + `border-hairline` at rest, `focus-within:border-border` (FeedComposer's own focus step); `rounded-lg` | — | — | — |
| Placement | bottom of the centre panel, `mx-2 mb-2` so it lines up with the rows' rounded inset | 8 | 8 | 8 |
| Min height | `--ctrl-h-lg` | 40 | 36 | 32 |
| Text | the shared editor (CH15) at the **message size**: `font-sans text-md`, `--leading-normal` ("what you type is what you'll see"); FeedComposerInput is `text-sm` today, so it needs a size option | 15 / 22.5 | 15 / 22.5 | 15 / 22.5 |
| Max height | `max-h-60`, then scrolls | 240 | 240 | 240 |
| Placeholder | "Message Acme" · "Message Sofia Ortiz" · in the panel's chain: "Reply to Sofia" | — | — | — |
| At rest (CH15) | one row, Discord's shape: `IconButton sm` Attach on the left · text · `@` · Emoji · Send on the right | 26 | 24 | 22 |
| Send | `IconButton sm`, ghost and `text-subtle-foreground` while empty; `variant="default"` (`bg-primary`) once there's text: the surface's one primary | — | — | — |
| Selected text | a mini `Toolbar` (`gap="tight"`) on `FLOATING_SURFACE` above the selection: Bold · Italic · Strike · Code · Link │ Quote · List · Code block | — | — | — |
| Suggestions (`@` `#` `/` `:`) | the editor's RF-1 menus: `Command` on `FLOATING_SURFACE`, `state-active` highlight | — | — | — |
| Attachments waiting | the `leading` slot: 56 px thumbnails (`rounded-md ring-hairline`, × with `.hit-min`) and file `Chip sm` with `onRemove`; `gap-1.5`; a neutral `Progress` under each while uploading | — | — | — |
| Typing | a reserved `h-5` line under the composer, `text-xs text-subtle-foreground`, "Sofia is typing…", text aligned with the composer's text; fades over `--motion-fade` | 20 | 20 | 20 |
| Can't post (archived, announcements) | a plain `text-sm text-muted-foreground` line in the composer's place, no well | — | — | — |

### 4.11 Left panel (CH5 decided the shape)

| Part | Token / component | Comfortable | Compact | Dense |
| --- | --- | --- | --- | --- |
| Row | `NavRow` (`--row-h`, `font-display text-base font-medium`) | 36 | 32 | 28 |
| Catch up | `NavRow` + count, then the hairline split (Tasks' rail divider) | — | — | — |
| Sections | `NavSectionHeader` ("Channels", "Direct messages", "Pinned"), sentence case, collapsible and remembered, hover + ("New channel", "New message") | 28 | 26 | 24 |
| Channel icon (CH3) | the 16 px slot: project `NavRowDot` · company icon · `TeamMark size="icon"` · `Lock` · `MessageCircle` | — | — | — |
| Direct message | `PersonAvatar size="icon"` + a **neutral** presence dot: 6 px, filled `bg-muted-foreground` = active, a ring = away, nothing = offline; `ring-2 ring-card`. `AvatarBadge` is `bg-primary` today, so it needs a neutral option | 16 | 15 | 14 |
| Group DM | two 11 px discs in the two people's hues, overlapped, **no letters** (two initials can't fit 11 px; §6 #15) | — | — | — |
| Unread | label `text-foreground font-semibold` (CH5 "unread is weight"); **new** `unread` prop on NavRow, which today sets every label to 500 | — | — | — |
| Count (only what's addressed to you) | NavRow's count, `text-xs tabular-nums`; `text-foreground font-medium` for mentions and DMs, muted for "Every message" channels | — | — | — |
| Muted conversation | label `text-subtle-foreground` (not `opacity-60`, which measured 3.47:1), `BellOff` at `--icon-xs` as the indicator, never bold | — | — | — |
| Current | `NavRow current` → `bg-state-active text-foreground` | — | — | — |

### 4.12 Conversation header (the centre panel's title row)

- **The Tasks toolbar recipe:** `pt-3 pe-3 pb-2 ps-4`; title `font-display text-lg font-semibold tracking-tight` (18 / 600).
- **Left to right:** the conversation's icon (`--icon`) or, for a DM, `PersonAvatar size="sm"` (24) · the name · the linked item as a `Chip xs` with its dot (CH2) · faces: `AvatarGroup` of 3 `PersonAvatar size="icon"` + the count in `text-sm text-subtle-foreground` (opens Details) · `Toolbar.Spacer` · Search `IconButton sm` · ⋯ `IconButton sm` (Notifications ▸, Pin to sidebar, Mark as read, Leave).
- **No topic line** (Slack moved it to details in 2023; it keeps the header one line, like Tasks): the topic lives in Details.
- **No panel toggles here** (48b, 72a): the right panel opens from the bottom bar and switches in its own title row.

### 4.13 Right panel (a reply chain, Details)

- **Header:** the shared right-panel title row (44 px, view name 13 / 600, the dropdown).
- **A reply chain** (CH30 item 2, opened as an item with a back arrow): the first `MessageRow`, then `GroupHeader` "3 replies" with a hairline, the replies in order, the filled composer.
- **Geometry:** same type (15 / 22.5), but `PersonAvatar size="sm"` (24) and a 40 px inset at every density, because the panel is 320–340 px wide (§6 #14).
- **Hover toolbar in the panel:** 3 reactions · ☺+ · ⋯.

### 4.14 Surfaces and colour

| Layer | Dark (default black shade) | Light |
| --- | --- | --- |
| Frame | `--background` black | `--background` neutral-50 |
| Chat panels | `--card` (L 0.14), 1 px hairline edge, `rounded-lg` (the shell's panels) | white card |
| Floating (toolbar, menus, tooltips) | `--popover` (L 0.18) + hairline + `shadow-md` | white + shadow |
| Hover / pressed / selected | 5% / 9% foreground / 13% accent | same formulas |
| Text | foreground ≈19:1 on the card; secondary ≈8:1; tertiary ≈6:1 (audit measurements) | secondary 4.29:1 on light: a token issue, out of scope |
| Colour in a conversation | avatar hues (`bg-label-fill`), emoji, project dots, tag colours, the accent for `@you` / New / selection / Send. Nothing else | same |

**Against the competition:** Moduo's chat surface (L 0.14 under 0.985 text) is darker than Discord's Onyx chat (0.17, body text dimmed to 0.87) and Slack's dark (≈0.21), and its text is brighter than either. The shades (warm, cool, slate, plum, forest) re-tint everything for free because chat uses only translucent tokens, the same move as Discord's Ash / Dark / Onyx ladders.

### 4.15 Motion

- Hover fills, the toolbar, the gutter time and the add-reaction chip: opacity or colour over `--motion-fade` (100 ms), `--ease-out`. Nothing moves.
- Someone else's message arriving while you're at the bottom: `.motion-row` (height + opacity). Your own sent message appears at once.
- The "New" line fades out over `--motion-slow` once read.
- Reduced motion: opacity only (R6). No blur anywhere.

---

## 5. Three variants worth prototyping

Each should be built as a frame in the round-2 prototype on the round-2b shell, at **comfortable and dense**, on **mono and blue** accents (the `@you` mark behaves differently on each), with the same conversation content.

| | **A · Slack calm** | **B · Discord depth** | **C · Moduo hybrid** (recommended) |
| --- | --- | --- | --- |
| Avatar | 32 / 28 / 24, round | **40** (`lg`) / 32 / 24, round | 32 / 28 / 24, round |
| Content inset | 56 / 48 / 40 | **64** / 52 / 40 | 56 / 48 / 40 |
| Name | 15 / 600 | 15 / **500** (Discord's weight) | 15 / 600 |
| Body | 15 / 22.5 | 15 / 22.5 | 15 / 22.5 |
| Space before a group | 18 / 15 / 12 | **22 / 18 / 14** (Discord's 21; no token gives it exactly, so it would take a chat spacing token) | 18 / 15 / 12 |
| Row hover | rounded inset rows | **full-bleed** fill, square left edge | rounded inset rows |
| Day divider | **centred** label on a hairline, sticky | **centred** label on a hairline | left `GroupHeader` + hairline (Tasks' grammar) |
| Reactions | Chip xs, **`shape="full"`** (pills) | Chip xs, `shape="md"`, 24 at every density with 16 px emoji | Chip xs, `shape="md"`, density-bound |
| Composer | **two rows**: text, then a tools row (Attach · Aa · @ · Emoji … Send) | one row, filled | one row, filled (FeedComposer `filled`) |
| Hover toolbar | 3 reactions + verbs | 3 reactions + verbs | 3 reactions + verbs |
| New messages | accent line + "New" | accent line + "New" **+ a floating "12 new" bar at the top** | accent line + "New"; the floating chip only when the line is off-screen |
| Feels like | Slack's 2023 calm | Discord's spacious, avatar-led look | Tasks' language with Slack's and Discord's reading rhythm |

**Recommendation: C.**
- **It keeps everything Tasks decided** (rounded inset rows, sentence-case left-aligned group headers, Chip md, FeedComposer, NavRow) and **takes the four things that actually make Slack and Discord feel good**: reading-size text, hierarchy by weight, the two-speed rhythm, and one inset. None of the four costs a new colour.
- **A's centred pill dividers and two-row composer** would be the only centred headers and the only two-row field in Moduo; they're Slack habits, not why Slack looks good.
- **B's 40 px avatars** suit Discord's busy public servers with photo avatars. For 2–5 people whose avatars are mostly two initials on a hue, a 40 px disc reads heavy, and a 64 px inset in an ≈800 px centre panel spends width the text needs. Worth prototyping because Maciej named Discord, to see it side by side.

---

## 6. Where a Tasks rule or a round-1 decision would have to bend

Each row: the rule, what Slack and Discord do, and my recommendation. ★ = it changes something already decided.

| # | Rule or decision | Slack / Discord | What would bend | Recommendation |
| --- | --- | --- | --- | --- |
| 1 ★ | **CH27: "body text 14 px at every step"** | 15 / 16 px | Messages at `text-md` 15 / 22.5 | **Bend: 15 px at every density.** It's on the ladder (Tasks titles are 15), it's the size Maciej's two favourites sit at, and 14 is where v1's "looks bad" starts. Density changes space and avatars, not the reading size |
| 2 | **Avatar rungs are fixed** (16 / 24 / 32 / 40; only `icon` scales); rule 44 says density applies to everything | one size | A density-bound **`--avatar-row`** token (32 / 28 / 24) and a `size="row"` on Avatar: a token edit is a system edit (R10) | **Add it.** Fallback without a token: 32 / 32 / 24 |
| 3 | **People round, teams square** (calls 43, 95) | Slack: rounded squares; Discord: circles | Nothing, if kept | **Keep round.** Discord proves a round avatar looks as good; square stays the team signal |
| 4 | **The `@you` mark** (CH28; R5 lists "mention tint") | Slack: yellow highlight; Discord: yellow row tint + 2 px bar + blurple pill | A **solid** `bg-primary` mark instead of a 14% tint | **Solid.** On the default mono accent a 14–22% white tint sits within a few percent of other people's 9% neutral mention, so only a solid mark is found at a glance |
| 5 | **No row tint or bar for mentions** (CH28, decided) | Both rely on it | Nothing: it's decided | **Keep.** The rail count and Catch up carry the "find my mentions" job instead |
| 6 | **"New" line in the accent, no red** (CH28, brand) | red everywhere | Nothing | **Keep.** On mono it's a white line, still the only full-width accent mark |
| 7 | **Date grammar (rule 41)** has weekdays only for the coming week ("Mon" means next Monday) | "Friday, October 10th" / "October 10, 2025" | Add a **past** form: "Yesterday", then "Mon"–"Sat" for the last six days, then "Oct 9" | **Add it, app-wide.** Day headers, "Last reply Mon, 3:40 PM", Notes' and Email's history all need it |
| 8 | **No "how long ago" in the grammar** | Slack: "Last reply 2 hours ago" | Nothing if kept | **Keep the grammar:** "Last reply 3:40 PM" / "Mon, 3:40 PM" |
| 9 | **R4 puts `text-2xs` (11 px) on eyebrows only; rule 41 says times never truncate** | Discord's gutter time is 11 px; Slack drops "AM/PM" in the gutter | Gutter time at 11 px; at dense it's **hidden** (tooltip only) rather than shortened | **Allow 11 px for the gutter time;** hide it at dense |
| 10 | **FeedComposer is hairline-only, text 13 px** | filled or clearly bordered, body-size text | A `filled` look and a `size` on FeedComposerInput | **Add both to the kit;** Tasks' comment box can stay hairline |
| 11 | **NavRow sets every label to 14 / 500 muted** | bold white unread names | An `unread` prop (foreground + 600) | **Add it** (CH5 already decided "unread is weight") |
| 12 | **Accent budget (rule 46)**: "you reacted" isn't on the list | brand-blue / blurple | Nothing if kept | **Keep neutral** (`state-active`); your reactions are a fact about you, not a status |
| 13 ★ | **CH16: "the six fixed reactions are the one-click row on hover"** (CH16a, open, makes the row personal) | 3 quick reactions | 3 on hover (the first three of your row); all six at the top of the ☺ picker and the right-click menu | **Bend to 3.** Ten controls (≈280 px) don't fit the 320 px right panel and are wider than Slack's or Discord's whole bar |
| 14 | **Rule 44: density applies to everything** | thread panels use the same rows | The right panel's chain uses `sm` avatars and a 40 px inset at every density | **Bend for the panel only.** At 320 px, a 56 px inset leaves ≈230 px for text |
| 15 | **Rule 43: two initials** | — | Group-DM marks are two 11 px colour discs without letters | **Allow it in the 16 px rail slot only;** the header and Details show full avatars |
| 16 | **Monochrome text column** | blue links | Links stay `text-foreground` + underline | **Keep;** no bend, just a visible difference from Slack |
| 17 | **Three text levels (rule 38)** | Discord dims the body a step below the names (`--text-default` under `--text-strong`) | A fourth "reading" tone | **Keep three levels.** Weight already separates names; revisit only if long threads glare on black |
| 18 | **Presence dot** (CH28 neutral; CH28a still open) | green | Nothing if kept | **Neutral filled / ring.** Green measured 2.17:1 on light; neutral passes both themes |
| 19 | **Day header alignment** (GroupHeader left, sentence case) | centred over a hairline | Variants A and B test centred | **Keep left** in C; let the prototype show both |
| 20 | **`max-w-[…]` banned (R10)** | images capped at ≈360–400 px | A layout token `--media-max` | **Add it** (Notes will want it too) |

**Not tensions, for the record:** a chat-only `MessageRow` beside the kit's `Row` (allowed; re-plan §5 lists it as chat-only); the toolbar's `shadow-md` (FLOATING_SURFACE leaves the shadow to each primitive); 600 for names (brand weights 400 / 500 / 600; never 700); Geist only.

---

## 7. Sources

- Slack: [Change your message display (Clean / Compact)](https://slack.com/help/articles/213893898) · [Change the font in Slack](https://slack.com/help/articles/33702041349395) · [An overview of Slack's new design](https://slack.com/intl/en-au/help/articles/16764236868755-An-overview-of-Slacks-new-design) · [Show members' full names](https://slack.com/intl/en-gb/help/articles/115004686586-Show-members-full-names-in-your-workspace) · [Stanford's notes on the 2023 redesign](https://uit.stanford.edu/service/slack/redesign2023)
- Discord: shipped CSS read from the logged-out [discord.com/login](https://discord.com/login) (message, reaction, divider, composer and theme rules; resolved per theme in the page) · [Mobile Visual Refresh: what's changing](https://support.discord.com/hc/en-us/articles/42383370736023-Mobile-Visual-Refresh-What-s-Changing) · coverage of the March 2025 desktop refresh ([Beebom](https://beebom.com/discord-desktop-update-new-themes-game-overlay-rolling-out/amp/), [Yahoo Tech](https://tech.yahoo.com/general/article/discords-redesigned-pc-app-has-multiple-dark-modes-a-new-overlay-and-more-160019822.html)) · [community post on the grouping window](https://support.discord.com/hc/vi/community/posts/360030111231-Update-to-messages-layout-for-chats)
- Teams: [Change the spacing of your chat messages](https://support.microsoft.com/en-US/teams/chat/change-the-spacing-of-your-chat-messages-in-microsoft-teams) · [Chat density settings](https://support.microsoft.com/en-gb/office/customize-your-teams-chat-interface-with-chat-density-settings-c93fd71d-4a35-4712-961a-be76bad50925)
- Google Chat: [New density setting in Google Chat (Oct 2024)](https://workspaceupdates.googleblog.com/2024/10/new-density-setting-in-google-chat.html)
- Linear: [How we redesigned the Linear UI](https://linear.app/blog/how-we-redesigned-the-linear-ui) · [New Linear UI changelog, Mar 2024](https://linear.app/changelog/2024-03-20-new-linear-ui)
- Campfire: [basecamp/once-campfire](https://github.com/basecamp/once-campfire) (`app/assets/stylesheets/messages.css`, `app/javascript/models/message_formatter.js`)
- Zulip: live on [chat.zulip.org](https://chat.zulip.org/#narrow/channel/2-general) (public view) · [Font size help](https://zulip.com/help/font-size) · [zulip/zulip](https://github.com/zulip/zulip) (`web/styles/message_row.css`, `web/src/message_list_view.ts`)
- Telegram Desktop: [telegramdesktop/tdesktop](https://github.com/telegramdesktop/tdesktop) (`Telegram/SourceFiles/ui/chat/chat.style`, `history/history_item.cpp`)
- Element: [element-hq/element-web](https://github.com/element-hq/element-web) (`packages/shared-components/src/room/timeline/event-tile/EventTileView/EventTileView.module.css`)
- Mattermost: [mattermost/mattermost](https://github.com/mattermost/mattermost) (`webapp/channels/src/sass/components/_post.scss`, `webapp/channels/src/utils/constants.tsx`)
- Moduo: `.design/tasks-v3/REPLAN.md` §5 and group F, `specs/tasks-v3.md` §19, `src/styles/tokens.css`, `docs/DESIGN_RULES.md`, `src/components/ui/` (kit), `.design/brand/DECISIONS.md`, `.design/chat-v2/REPLAN.md`, `research/visual-audit.md`, `prototypes/round-1.html` (measured live)
