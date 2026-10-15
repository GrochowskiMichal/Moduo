# CV-7c — Reactions widened (server + client, Tier 2)

> Branch `t/maciej/cv-7c-reactions` · head: see the branch · status: built, not landed
> Migration: `supabase/migrations/20261015200000_chat_v2_reactions.sql` · applied to the local stack: yes (by this builder, on its migration turn)

## Delivered against the row

- **One reaction key** for chat messages, task and note comments and the quick row: `reactions__key_ok(text)` (built on `reactions__key_pattern()`) on the server, `REACTION_KEY` / `isReactionKey` / `parseReactionKey` / `normalizeReactionKey` + `REACTION_KEY_SET` + `DEFAULT_QUICK_REACTIONS` / `MAX_REACTION_KINDS` / `MAX_QUICK_REACTIONS` in `@contracts`. A key is exactly one standard emoji: a flag, a #/* keycap, or one pictograph from the emoji blocks with optional variation selector, skin tone and tag sequence, joined only by U+200D; 1–32 code points. `COMMENT_REACTIONS` and its helpers are gone everywhere.
- **Comments:** `comment_reactions_reaction_check` is now `reactions__key_ok(reaction)`; the six stored words became their emoji through `comment_reactions__words_to_emoji()` (server only; lossless, a no-op the second time); `comments_op_react` (from its live body) takes any key, ≤ 20 kinds per comment, and maps the six old words from apps that haven't updated. Who may react is unchanged.
- **Chat:** `chat_op_react` (from its live body) asks the shared check; its 20-kind cap stays. `user_op_set_chat_prefs` (from its live body) checks quick-row keys with the same function. Grants re-stated by name on every redefined function.
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
| Lossless, idempotent rewrite | `chat_reactions.test.sql` · "rewrite: each word became its emoji…", "rewrite: a second run changes nothing" |
| Quick row: Settings → comment | `tests/reactions.spec.ts` · "CH16a — your quick row from Settings → Chat shows on a task comment; any emoji reacts" (not run green yet: see Verify before release) |
| AC14.2 (reaction component, three densities) | `src/components/ui/kit.test.ts` (story registered, uses `AtThreeDensities`); `tests/visual/kit.spec.ts` iterates the kit list (visual project not run in this block) |

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **A key is a closed set of emoji code points** · agent · "no letters, digits, spaces or control characters" alone let through invisible and direction marks and two emoji side by side; the set spells "exactly one emoji" in both languages with the same numbers · rejected: a deny-list of character classes (Postgres and JS classify differently).
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

- **CV-7b:** the picker plugs in as `onAnyEmoji` on `MessageVerbs` (hover toolbar ☺), `useCommentReactions({ onAnyEmoji })` (comments) and `QuickReactionRow`/`ReactionButton`. Pass only keys that pass `isReactionKey` (the server refuses the rest; e.g. 1️⃣ and two emoji side by side). `src/features/chat/emoji.ts`'s `QUICK_REACTIONS` (v1 `message-item.tsx`) was left alone to avoid a clash with the picker work: replace it with `DEFAULT_QUICK_REACTIONS`.
- **CV-6b:** `runtime.chat.myPrefs()` / `setMyPrefs({ noticeShowText, emailWhenAway, … })` already exist; `user_chat_prefs` is already in `READ_RPCS`; add your switches to `settings/sections/chat-section.tsx` or Notifications.
- **CV-20:** widen `reactions__key_pattern()` and `REACTION_KEY_SET`/`isReactionKey` together (the drift gate and the shared corpus hold them equal). `reactions__key_ok` is IMMUTABLE and backs a CHECK: "live in this workspace" must be checked in the ops, not the CHECK. `resolveQuickRow(saved, usable)` takes the workspace check; Settings saves the resolved row, so stop dropping a custom key missing in this workspace when you add them.
- **CV-15:** viewer permission rows beyond `chat_op_react`.
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

- **Release order:** the migration can go before the app (old apps' comment words map to emoji), but an old app **hides** emoji reactions on comments (its reader only knew the words) until it updates: ship the app (web promote + the desktop release) in the same train.
- Re-run `tests/reactions.spec.ts`: on 2026-10-15 the shared stack's dev person had no workspace (another session's data), so `devWorkspace()` failed before the spec began; `tests/chat-stream.spec.ts` passed.
- Run the visual kit spec (`bunx playwright test --project=visual tests/visual/kit.spec.ts`) for the Reactions story.
- Prod chat messages from v1 with non-emoji keys are left out when drawn (the reader shows only keys); count them on prod before release if v1 allowed text keys.
