# Manual test checklist — CV-2a Message ops v2

> Generated 2026-10-15 · branch `t/maciej/cv-fold-2`, folded from the record [`CV-2a`](../../build/chat-v2/CV-2a.md) (block branch `t/maciej/cv-2a-message-ops`) · **Live-verified:** no. The block is server-only; its ops were proven by `chat_ops.test.sql` and `chat_wrappers.test.sql`, and v1's screens reach them through the wrappers until CV-8a.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Server checks (terminal, local stack up)

- [ ] **Do:** with the migration `20261017103000_chat_v2_core_ops.sql` applied, run `bun run db:test chat` → **Expect:** every chat file passes, among them `chat_ops` (messages half, 143 checks), `chat_wrappers` (23) and `chat_send_limits` (54, against the redefined ops) _(terminal)_

## In v1's Chat (through the wrappers, until CV-8a)

- [ ] **Do:** send `hi @Anna _soon_` → **Expect:** it posts; `select format_version, body, mentioned_user_ids from chat_messages order by created_at desc limit 1` shows `2`, `hi moduo://person/… *soon*` and Anna's id _(Chat + psql)_
- [ ] **Do:** edit that message, react 👍 twice (on, then off), pin it, then delete it → **Expect:** each works; `module_activity` has one row per change, with ids only and no message text _(Chat + psql)_
- [ ] **Do:** delete a message and, within 10 seconds, run `select chat_op_restore('<id>')` as its author → **Expect:** it is back; delete it again and wait a minute → its body is blank _(psql)_
- [ ] **Do:** as a member whose role can't "Mention everyone", send `@channel hi` → **Expect:** it posts, and nobody gets a bell row _(Chat + bell)_

## Edge cases

- [ ] **Do:** send the same message id twice (`chat_op_send` with one `p_id`) → **Expect:** one message, and the second call returns the stored row; another person using that id gets "That message id is already used." _(psql)_
- [ ] **Do:** send a body of 8,001 characters → **Expect:** it is refused with the count and nothing is stored _(Chat or psql)_
- [ ] **Do:** reply to a reply → **Expect:** the new message joins the root's chain and the root's "N replies" counts it _(Chat)_
- [ ] **Do:** as a viewer, try to send, edit, delete and pin; then react → **Expect:** the first four are refused, the reaction works (also while the plan is paused) _(Chat or psql)_
- [ ] **Do:** archive a conversation, then try to send, edit, react and pin in it → **Expect:** all four are refused; deleting a message (and its Undo) still works _(Chat or psql)_
- [ ] **Do:** pin a 101st message in one conversation → **Expect:** it is refused (100 live pins at most) _(psql)_

## Verify before release

- [ ] **Do:** read the release order → **Expect:** foundation, then convert_v1, then the v1 hotfix (already on prod), then this file; the job `chat-blank-deleted` is scheduled on prod after it _(release plan)_
- [ ] **Do:** open v1's Chat on a build without the v2 client and look at a message with a mention and at a bell row → **Expect:** the mention reads `moduo://person/…` and the bell shows the stored-form excerpt, until the v2 client (CV-3, CV-7a) and CV-11 ship with the release; old desktop builds keep sending through the wrappers until `min_build` passes them (CV-23) _(web, desktop)_
- [ ] **Do:** after applying on prod, check who owns the redefined functions and who can execute the new helpers → **Expect:** `postgres` owns the redefined functions, and the new helpers are executable by the ops' owner _(prod)_
- [ ] **Do:** when this migration's stamp is re-cut, check that `MIGRATION` in `src/features/chat/privacy-rules.test.ts` points at the new name, and that the file still sorts after `20261014155205_chat_send_limits.sql` → **Expect:** `privacy-rules.test.ts` passes _(terminal)_

## Migrations / data

- [ ] **Do:** after the migration, `\d chat_messages` → **Expect:** `format_version` defaults to 2 and `deleted_by` exists; `chat_convert.test.sql` puts v1's default back inside its own transaction, so it still passes _(psql)_
- [ ] **Do:** `select * from cron.job where jobname = 'chat-blank-deleted'` → **Expect:** one job, every minute, if the stack runs pg_cron _(psql)_

## Known gaps / not-yet-testable

- **Team mentions** are stored but not expanded; CV-5 builds the fan-out and replaces the bell block at the end of `chat_op_send`.
- **A removed person** (not one who left) can post until CV-2b's `chat_op_remove_member` stamps `removed_by`; the removed-person rule can't be tried before then.
- **App posts** (`chat_op_agent_post`) share the workspace's apps budget until CV-21 writes `api_key_id`; an app's reply doesn't yet move `last_message_at` or `reply_user_ids`.
- **A v1 emphasis typed while editing** a v2 message stays literal on v1's screens (a transition loss).
- **An API key's own sending budget** (the eleventh post in 10 seconds is refused, apart from its person's budget) is proven only by `chat_ops.test.sql`; there is no screen to try it on.
- **The client halves** (the store's page boundary for AC1.4, `min_build` for AC12.9) belong to CV-3 and CV-23.

---
*Convention defined in [AGENTS.md](../../../AGENTS.md) → "Working posture" (Wrap). The record holds the numbers: [CV-2a](../../build/chat-v2/CV-2a.md).*
