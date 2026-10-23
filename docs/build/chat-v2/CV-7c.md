# CV-7c — Reactions widened (server + client, Tier 2)

> Branch `t/maciej/cv-7c-reactions` · head: see the branch · status: built, not landed
> Migration: `supabase/migrations/20261015200000_chat_v2_reactions.sql` (released as `20261017108000`) · applied to the local stack: yes (by this builder, on its migration turn)

## Delivered against the row

- **One reaction key** for chat messages, task and note comments and the quick row: `reactions__key_ok(text)` (built on `reactions__key_pattern()`) on the server, `REACTION_KEY` / `isReactionKey` / `parseReactionKey` / `normalizeReactionKey` + `REACTION_KEY_SET` + `DEFAULT_QUICK_REACTIONS` / `MAX_REACTION_KINDS` / `MAX_QUICK_REACTIONS` in `@contracts`. A key is exactly one standard emoji: a flag, a #/* keycap, or one pictograph from the emoji blocks with optional variation selector, skin tone and tag sequence, joined only by U+200D; 1–32 code points. `COMMENT_REACTIONS` and its helpers are gone everywhere.
- **Comments:** `comment_reactions_reaction_check` is now `reactions__key_ok(reaction)`; the six stored words became their emoji through `comment_reactions__words_to_emoji()` (server only; lossless, a no-op the second time); `comments_op_react` (from its live body) takes any key, ≤ 20 kinds per comment, and maps the six old words from apps that haven't updated. Who may react is unchanged.
- **Chat:** `chat_op_react` (from its live body) asks the shared check; its 20-kind cap stays. **A message you can't read gets the same answer as one that doesn't exist** ("That message no longer exists."), for a member of another conversation, an outsider, a key and a deleted conversation alike; the two-argument toggle form reads a message only after the same reader check.
- **Stored keys in one spelling:** `reactions__respell_stored()` (server only, kept so the test can run it twice) stores every key already held on comments and chat messages in the one spelling, merging two spellings one person holds (comments keep the row already in the one spelling, else the earliest; a message lists each person once). A key that isn't a key is left as it is, and a message holding anything but lists of people is left whole. `user_op_set_chat_prefs` (from its live body) checks quick-row keys with the same function. Grants re-stated by name on every redefined function. _(2026-10-23: `comment_reactions__words_to_emoji()` and `reactions__respell_stored()` were dropped by `20261023051042_drop_one_shot_backfills.sql` once prod showed both conversions complete; their test blocks went with them.)_
- **The reaction component** (`src/components/ui/reactions.tsx`, kit entry "Reactions", `Densities` story at three densities): `Reactions` (chips: emoji, count, yours on the active fill, who on hover), `QuickReactionRow` (your row, "Customize…", "Any emoji" when a picker is passed), `ReactionButton` (☺ → your row in a popover).
- **Used on** chat messages (`stream/rows.tsx`), task comments (`task-feed.tsx`, small swap) and note comments (`note-comments-panel.tsx`, new) via `spine/ui/comment-reactions.tsx`.
- **Your quick row:** `spine/hooks/use-quick-reactions.ts` (one copy per signed-in person, live across surfaces), `resolveQuickRow` (yours in order, unusable keys skipped, Moduo's six fill to six). The chat hover toolbar shows the first three; the ⋯/right-click menu shows all six plus "Customize…".
- **Settings → Chat** (new section in Personal): six slots, type or paste any emoji per slot (swap when it's already in another slot), move left/right, "Use Moduo's six".
- **Runtime:** `ChatRuntime.myPrefs()` / `setMyPrefs(patch)` typed to all five chat prefs (`UserChatPrefs`), `mapUserChatPrefs`; `user_chat_prefs` added to `READ_RPCS`.

## Acceptance criteria proven

| AC | Test or live check |
| --- | --- |
| AC10.9 (viewers react; reactions never notify) | `supabase/tests/chat_reactions.test.sql` · "chat: a viewer reacts with any emoji (AC10.9)", "chat/comment: reacting writes no notice…" |
| One key for chat and comments | `chat_reactions.test.sql` · the shared corpus + "key: chat, comments and the quick row ask the same check"; `vocabularies.test.ts` · "accept exactly what the server accepts" (same corpus); `drift-gates.test.ts` · "one reaction key…" (same code points) |
| Only readers react or see who reacted; no person from the caller | `chat_reactions.test.sql` · "chat/comment: who reacted stays with … readers", "ops: none takes a person from the caller", outsider/key refusals |
| ≤ 20 kinds | `chat_reactions.test.sql` · "chat/comment: a 21st kind is refused" |
| A hidden message answers as a missing one | `chat_reactions.test.sql` · "chat: a missing message is not there", "… one you can't read answers the same …", "… the toggle form answers the same"; `chat_ops.test.sql` react checks |
| One spelling, stored keys respelled | `chat_reactions.test.sql` · canonical corpus (Moduo's six and the words' emoji are fixed points), "respell: …" (twice = no-op), "rewrite: an old app takes a rewritten ✅ off with its word"; `reactions.test.ts` · "the picker's emoji … stored as they are" |
| Quick row keeps the latest save | `use-quick-reactions.test.ts` (load after a save, older save failing after a newer one) |
| Lossless, idempotent rewrite | `chat_reactions.test.sql` · "rewrite: each word became its emoji…", "rewrite: a second run changes nothing" |
| Quick row: Settings → comment | `tests/reactions.spec.ts` · "CH16a — your quick row from Settings → Chat shows on a task comment; any emoji reacts" (green with `tasks-detail.spec.ts` and `chat-stream.spec.ts`, 11 passed, 2026-10-15) |
| AC14.2 (reaction component, three densities) | `src/components/ui/kit.test.ts` (story registered, uses `AtThreeDensities`); `tests/visual/kit.spec.ts` iterates the kit list (visual project not run in this block) |

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **A key is a closed set of emoji code points** · agent · "no letters, digits, spaces or control characters" alone let through invisible and direction marks and two emoji side by side; the set spells "exactly one emoji" in both languages with the same numbers · rejected: a deny-list of character classes (Postgres and JS classify differently).
- **One spelling per emoji, as Emojibase writes it** · agent · ❤ and ❤️ (and ✅ and ✅️, keycaps with or without U+FE0F) were two chips; the ops store the fully-qualified form: a run of U+FE0F becomes one, U+FE0F after a text-default pictograph (`REACTION_KEY_SET.textDefault`, Unicode's Emoji_Presentation=No read from emoji-test.txt 18.0) or a keycap base, none after any other, none before a skin tone (`reactions__key_canonical`, mirrored by `canonicalReactionKey`; shared canonical corpus, spelling twice changes nothing; checked by hand on 2026-10-15, not in a committed test: every fully-qualified sequence in emoji-test.txt 18.0 is a fixed point and every minimally/unqualified one maps to its fully-qualified form, on both sides, the client under Bun) · rejected: storing what was sent; adding U+FE0F to every pictograph below U+1F000 (round 2: it turned ✅ into ✅️, splitting Moduo's own ✅).
- **The client checks a key numerically** · agent · each code point becomes a class letter by number and an ASCII pattern checks the grammar, so V8 (web) and JavaScriptCore (macOS desktop) agree · rejected: one astral character-class regex (engines differ).
- **A message you can't read answers as a missing one** · orchestrator (Chat v2 build) · no way to learn a message exists by reacting to it · rejected: "You're not a member of this conversation." for hidden messages.
- **Keycaps 0️⃣–9️⃣, #️⃣, *️⃣ are keys** · agent · standard emoji people vote with · rejected: refusing every key with a digit.
- **ℹ️ and other letter-like emoji are allowed** · agent · they are emoji as Emojibase writes them · rejected: the literal "no letters" rule.
- **Old words still work on comments** · agent · desktop bundles its UI, so old apps keep sending `thumbs_up` after the migration; they land as 👍 · rejected: refusing them (reactions break for everyone not yet updated).
- **The rewrite lives in a kept server-only function** · agent · the test calls it twice to prove lossless and idempotent · rejected: inline UPDATE (untestable after the fact).
- **The rewrite doesn't bump `comments.updated_at`** · agent · the six words read as the same reactions; open panels don't need a refresh · rejected: touching every reacted comment.
- **Groups order by first use** (comments) and server order (messages) · agent · stable while people react · rejected: quick-row order (reorders as you change your row).
- **Settings → Chat slots take typed/pasted emoji** · agent · the full picker is CV-7b's; ⌃⌘Space opens the OS keyboard · rejected: waiting for the picker.
- **"Customize…" sits in the ⋯ menu's reaction row, not in the floating toolbar** · agent · the toolbar has three slots and verbs; the menu shows the whole row · rejected: a fourth toolbar button.
- **Prefs on `ChatRuntime` (`myPrefs` / `setMyPrefs`, all five fields)** · agent · one place for CV-6b's switches too · rejected: a reactions-only accessor.

## Gotchas (area: supabase, tooling)

- The Write/Edit tools turn `\uXXXX` in file text into the literal character. Spell code points as numbers (`chr(n)`, `String.fromCodePoint(n)`) in SQL and TS.
- `comments.test.sql`'s 9 grant failures on the local stack are snapshot leftovers on functions this block doesn't touch; `comments_op_react`'s own grant check passes once this migration re-states it.

## For later blocks

- **CV-7b:** the picker plugs in as `onAnyEmoji` on `MessageVerbs` (hover toolbar ☺), `useCommentReactions({ onAnyEmoji })` (comments) and `QuickReactionRow`/`ReactionButton`. Pass only keys that pass `isReactionKey` (the server refuses the rest, e.g. two emoji side by side), spelled by `canonicalReactionKey`. `src/features/chat/emoji.ts`'s `QUICK_REACTIONS` (v1 `message-item.tsx`) was left alone to avoid a clash with the picker work: replace it with `DEFAULT_QUICK_REACTIONS`.
- **CV-6b:** `runtime.chat.myPrefs()` / `setMyPrefs({ noticeShowText, emailWhenAway, … })` already exist; `user_chat_prefs` is already in `READ_RPCS`; add your switches to `settings/sections/chat-section.tsx` or Notifications.
- **CV-20:** widen `reactions__key_pattern()` and `REACTION_KEY_SET`/`isReactionKey` together (the drift gate and the shared corpus hold them equal). `reactions__key_ok` is IMMUTABLE and backs a CHECK: "live in this workspace" must be checked in the ops, not the CHECK. `resolveQuickRow(saved, usable)` takes the workspace check; Settings saves the resolved row, so stop dropping a custom key missing in this workspace when you add them.
- **CV-15:** viewer permission rows beyond `chat_op_react`.
- **Later polish (code review, not needed for this block):** the chat hover/menu quick buttons are still drawn in `message-actions.tsx` (labelled "React 👍", no pressed state) rather than through `QuickReactionRow`; the app doesn't stop a 21st kind before the server does (toast); the quick row is fetched once per session (a change on another device shows after a reload); `chat/timeline.ts` has its own "only emoji" rule for jumbo messages that differs from the reaction key at the edges.
- **Stamp re-cut:** the migration name is pinned in `drift-gates.test.ts` and in a comment in `vocabularies.ts`; update both when the stamp is re-cut.

## Manual checklist (step → expect → surface)

- [ ] Hover a chat message → 👍 ✅ 👀 · Reply · Task · ⋯ → Chat stream
- [ ] Right-click a message → all six on top, "Customize…" under them → opens Settings → Chat
- [ ] Settings → Chat → click slot 1, paste 🎉, "Use it" → slot 1 is 🎉; hover a message → 🎉 first → Settings, Chat
- [ ] Type "party" in a slot → "That isn't an emoji.", "Use it" disabled → Settings
- [ ] Task comment → ☺ → your row; pick one → chip with count, hover says "You" → Task detail
- [ ] Note comment → ☺ and chips work the same → Notes comments panel
- [ ] "Use Moduo's six" → back to 👍 ✅ 👀 🙏 ❤️ 😄 → Settings → Chat
- [ ] Chips at Comfortable / Compact / Dense → Storybook `components-ui-reactions--densities`

## Verify before release

- **Release order:** the migration and the app ship on the same train. The migration can go first (old apps' comment words map to emoji, and they can take them off with the word), but an app from before CV-7c shows **no** comment reactions once the rewrite runs (its reader only knew the six words): promote web and cut the desktop release together, and raise the minimum build (`src/lib/min-build.ts`) so old desktop builds update. The data step gives respelled chat messages a new `updated_at` (as a reaction does).
- **Chat v1 reaction keys:** keys spelled another way (⭐️, ✅️, ❤) are respelled and merged by the migration's data step. Keys that aren't keys at all (v1 text keys, if any) are left: they are not drawn, still count toward the 20 kinds, and can't be taken off. Count those on prod before release; if any, clear them in a data step.
- Run the visual kit spec (`bunx playwright test --project=visual tests/visual/kit.spec.ts`) for the Reactions story.
