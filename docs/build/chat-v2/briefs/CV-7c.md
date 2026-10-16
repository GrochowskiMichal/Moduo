# CV-7c: Reactions widened (server + client, Tier 2)

> Read `docs/agents/chat-v2-build.md` first. Branch `t/maciej/cv-7c-reactions`; record `docs/build/chat-v2/CV-7c.md`. Quotes are verbatim from `specs/chat-v2.md`; CH… and §6 #n point at `.design/chat-v2/REPLAN.md`, round-3 §… at `.design/chat-v2/research/round-3-database.md`; `#n` is a spec Assumption.

## 1. The row

| # | Block | Delivers | Covers | Depends on |
| --- | --- | --- | --- | --- |
| 7c | **CV-7c** Reactions widened *(server + client, Tier 2)* | the reactions migration (the shared key and check, `chat_op_react`, `comment_reactions`' CHECK and data, `comments_op_react` from its live body, the quick row preference); the reaction component with the personal row on messages **and on task and note comments** (`task-feed.tsx`, `spine/reactions.ts`, `use-comment-thread.ts`, the runtime seam); Settings → Chat → quick reactions; `chat_reactions.test.sql` | AC10.9, AC14.2 (the reaction component) | 7a, 6a |

**Depends on:** CV-7a (the stream's hover toolbar), CV-6a (`user_op_set_chat_prefs`, where the quick row is saved). CV-7c touches Tasks' comment UI: coordinate with any open Tasks block on `task-feed.tsx`.

## 2. What to build

**§6 Reactions and emoji** (prototype frame 5)
- **Your own quick row** (six by default: 👍 ✅ 👀 🙏 ❤️ 😄), set in Settings → Chat or from "Customize…" at the end of the hover row; the hover shows the first three; any emoji behind ☺; the full picker (Frimousse, native emoji) with the workspace's custom emoji first. **The same row and picker apply to task and note comments** (CH16a, CH49). Reactions never notify. Viewers react (CH60). Up to 20 kinds per message.

**Edge cases this block handles** (§Edge cases)
- A viewer → reads, reacts, receives direct messages, can't post or start one; the composer shows a line, not a box; Catch up's `R` opens nothing to type into.

## 3. Acceptance criteria

**AC10 — Channels and permissions**
- **AC10.9** viewers react and receive, never post.

**AC14 — North star**
- **AC14.2** the kit additions of §17 exist with stories at three densities

**Tests that prove them** (file · name · AC · plain English)

- `supabase/tests/chat_reactions.test.sql` · "one key for chat and comments" · proves AC10.9 · Any emoji or a live `:custom:` of that workspace; ≤ 20 kinds; the six comment words became emoji; viewers react; reactions never write a notice.
- `tests/visual/kit.spec.ts` · "Chat's kit additions" · proves AC14.2 · Avatar sizes by density, the filled composer, NavRow's unread weight, the media cap, the presence badge, the recent-past dates and the reaction component each have a story at three densities.

## 4. Decisions that bind it

- **One reaction key** (round-3 §2.8, #18, #29): in `@contracts`, `REACTION_KEY` plus `DEFAULT_QUICK_REACTIONS` (the six, in order: 👍 ✅ 👀 🙏 ❤️ 😄), mirrored by one SQL check `reactions__key_ok(text)`: a standard emoji as Emojibase writes it (1–32 characters, no letters, digits, spaces or control characters). The `:name:` form for a live custom emoji arrives with CV-20 (its migration widens this check); agents write emoji, so no shortcodes as keys.
- **Chat:** `chat_messages.reactions` keeps its jsonb shape `{key: [user ids]}`, ≤ 20 kinds per message; `chat_op_react(message, key, on)` takes explicit on/off (idempotent, not a toggle), never notifies, readers including viewers may react (CH60). CV-2a already redefined the op; this block applies the shared key check and the cap.
- **Comments** (same migration): the CHECK `comment_reactions_reaction_check` (six words) becomes `reactions__key_ok(reaction)`; the six stored words become their emoji (`thumbs_up` → 👍, `check` → ✅, `eyes` → 👀, `pray` → 🙏, `heart` → ❤️, `smile` → 😄); `comments_op_react` (**live body**) accepts any key, ≤ 20 kinds per comment; `comment_reactions` stays a child table with hard deletes (it isn't published, its changes ride the comment's `updated_at`); who may react on a comment is unchanged. `COMMENT_REACTIONS` gives way to the shared key: `vocabularies.ts`, `vocabularies.test.ts` and `drift-gates.test.ts` (it pins the old CHECK and `p_reaction NOT IN`) change with it.
- **Your quick row** (CH16a): `user_preferences.reaction_row` (≤ 6 keys; null = Moduo's six), saved through `user_op_set_chat_prefs` (CV-6a made the column and op); one row per person for every workspace; a custom key missing in this workspace is skipped and the next default fills in; the hover shows the first three. Set from "Customize…" at the end of the hover row or Settings → Chat (a new section: `src/features/settings/settings-modal.tsx`, `settings-events.ts`).
- **The reaction component** (#32): one component with the personal row, used on chat messages **and on task and note comments**; the full picker is CV-7b's; story at three densities.

## 5. Files

New: `supabase/migrations/<stamp>_chat_v2_reactions.sql` (#35); `supabase/tests/chat_reactions.test.sql`; a Settings → Chat section. Touch: `vocabularies.ts` (+ tests), `src/features/spine/reactions.ts` (+ `reactions.test.ts`; its glyph tables are keyed by the old words), `src/features/tasks/ui/task-feed.tsx`, `src/features/spine/hooks/use-comment-thread.ts`, `src/lib/runtime.types.ts` and `runtime.web.ts` (`reactToComment`, `CommentReactionMark`), `src/lib/runtime.chat.web.ts`.

## 6. From earlier blocks

CV-7a: the stream and its hover toolbar. CV-6a: `user_op_set_chat_prefs`, `user_chat_prefs()`, the `reaction_row` column. CV-2a: `chat_op_react(message, key, on)`. TV-U13's `comment_reactions` (`20261013100000_comment_reactions_edits.sql`) is landed.

## 7. Watch out

- **Hot:** `src/features/tasks/ui/task-feed.tsx` (Tasks' comment UI): coordinate with any open Tasks block; keep changes small and additive. Also `src/lib/runtime.chat.web.ts`.
- Round-3 §5 risk 2: `comments_op_react` has been redefined by other blocks; read its live body. The data change (six words to emoji) must be idempotent.
- **Tier 2** (migrations, RLS, contracts, moduo-mcp, src/lib/runtime*): one `/code-review high` and one security scan of the diff at the end; scan findings go only into the hand-back.
- **Migration:** stamp provisional (re-cut on apply day, chat's order kept); redefine from live bodies (`pg_get_functiondef`); re-state grants by name (`DROP` + `CREATE` resets them); re-assert the Realtime publication if you publish a table; apply only on your migration turn, then `bun run db:test chat`; never `local:reset` or `migration up` (runbook, `docs/gotchas/supabase.md`).
- **Public repo:** describe no security weakness in any file; tell the orchestrator in the hand-back.

## 8. Out of scope for this block

Custom emoji, the picker's workspace section and `:name:` keys (CV-20); the picker itself (CV-7b); the hover toolbar (CV-7a); the viewer-can-react permission rows beyond `chat_op_react` (CV-15 completes AC10.9).
