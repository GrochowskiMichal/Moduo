# Manual test checklist — CV-1 Foundation and conversion

> Generated 2026-10-15 · branch `t/maciej/cv-fold-2`, folded from the record [`CV-1`](../../build/chat-v2/CV-1.md) (block branch `t/maciej/cv-1-foundation`) · **Live-verified:** no. The block is server-only and was proven by `bun run db:test chat` and a rolled-back round trip over the research workspace; v1's screens are the only place to see it, and CV-8a replaces them.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Server checks (terminal, local stack up)

- [ ] **Do:** run `bun run db:test chat` → **Expect:** every chat file passes; CV-1's are `chat_v1_to_v2` (2; the converter's 68 pairs, moved from the retired `chat_convert`), `chat_erasure` (9), `chat_foundation` (48), `chat_privacy` (60) and `chat_realtime` (19) _(terminal)_

## In v1's Chat (until CV-8a replaces it)

- [ ] **Do:** as a member of a Duo workspace open Chat and send a message with `_italic_` → **Expect:** it posts; then `select format_version, body_text from chat_messages order by created_at desc limit 1` shows the words without the `_` (and `format_version` 1 with CV-1 alone, 2 once CV-2a's migration is applied: the v1 send wrapper writes v2 from then on) _(Chat + psql)_
- [ ] **Do:** switch the workspace owner to Free and reload Chat → **Expect:** history still loads, and sending is refused with a message about the plan _(Chat)_
- [ ] **Do:** put two people in one public channel and a third who only reads it; the first two type → **Expect:** the two see "… is typing", the third doesn't _(Chat composer line)_

## The conversion's result (research workspace "Chat replan research", already converted on the local stack)

- [ ] **Do:** count the workspace's messages still at version 1 (`select count(*) from chat_messages where workspace_id = '669be464-0b9a-4d84-8537-544ac04dba5f' and format_version = 1`) → **Expect:** 0 _(psql)_
- [ ] **Do:** list the General conversations: `select workspace_id, name from chat_channels where is_default` → **Expect:** at most one row per workspace, each a public, unarchived channel named "general" _(psql)_
- [ ] **Do:** look for any bell row whose excerpt still holds a v1 token (`<@`, `<!channel>`, `<moduo:`) → **Expect:** none; every chat excerpt carries `payload.format_version = 2` _(psql)_
- [ ] **Do:** for a notes-to-self conversation that had messages, open Notes → **Expect:** one note with each message under a bold date-and-time line, readable only by that person; the conversation itself is deleted _(Notes)_

## Edge cases

- ~~**Do:** run the conversion again~~ Retired: `20261023230000_drop_legacy_chat_fns.sql` drops `chat__convert_v1`.
- [ ] **Do:** someone who left a public channel keeps it open as a reader while a member types in it → **Expect:** they see no typing line _(Chat composer line)_

## Verify before release

- [ ] **Do:** on prod, read-only, search v1 message bodies for U+0001 and U+0002 → **Expect:** none (the converter uses them as internal markers, so the conversion refuses a body that holds one) _(prod, read-only)_
- [ ] **Do:** on prod, read-only, run `chat__v1_to_v2` over every v1 body and look for any that grows past 8,000 characters → **Expect:** none; write down how many bodies the conversion would change (re-run `check_v1_to_v2.ts` over prod's v1 messages) _(prod, read-only)_
- [ ] **Do:** check that `unaccent` is in prod's `pg_available_extensions` → **Expect:** it is listed _(prod)_
- [ ] **Do:** check that the foundation's redefinition of `spine__visible_to` (which comes from Tasks v3's `20261013110000_notifications_v3.sql`) applies as prod's migration role, and that the redefined functions end up owned by `postgres` → **Expect:** it applies and the owners are `postgres` _(prod)_
- [ ] **Do:** read the release plan → **Expect:** it applies foundation, then convert_v1, then CV-2a's ops back to back, and the v2 client ships in the same release (v1's notes to self can't open a converted, deleted DM; typing becomes members-only for every conversation, a behaviour change against the live privacy rules) _(release plan)_
- [ ] **Do:** plan the deploy-time Realtime burst → **Expect:** the backfill touches every message and membership row, so v1 subscribers receive one update event per row; the foundation's table rewrite for `search_tsv` and the backfill fit the quiet hour's `lock_timeout` (0.8 seconds per 100,000 rows locally) _(release plan)_
- [ ] **Do:** at prod's size, check how long the conversion takes → **Expect:** a time that fits the release window (3,111 rows took 0.5 seconds locally); it runs `chat__v1_to_v2` over every v1 body three times (the `body_text` backfill, the 8,000-character pre-check, step 1) and rewrites `chat_messages` three times, so consider computing the converted bodies once into a temp table _(prod rehearsal)_
- [ ] **Do:** open any chat bell row from a converted message → **Expect:** it reads a person's name, not `moduo://person/<id>`; this is true only once CV-11 draws the excerpts (AC13.7) _(bell, after CV-11)_

## Migrations / data

- [ ] **Do:** in psql check what `20261017100000_chat_v2_foundation.sql` added (`\d chat_catchup`, `\d chat_chain_mutes`, and the new columns on `chat_messages`, `chat_channels` and `chat_members`) → **Expect:** both new tables exist and are empty, with the columns the record lists; the file stamps are provisional and get re-cut at the release _(psql)_

## Known gaps / not-yet-testable

- **The export of `chat_catchup` and `chat_chain_mutes`:** neither is exported, and no chat export exists yet. CV-22 builds it (`src/features/chat/export.test.ts`).
- **The bell redraw (AC13.7):** converted excerpts show the stored form until CV-11 draws them with the stored-form parser.
- **The rolled-back round trip** ran over the research workspace plus a hand-made set of 79 messages; prod's real v1 data hasn't been through it (see the release items above).
- **A v1 emphasis typed while editing a v2 message** stays literal on v1's screens; that is a transition loss, not a bug.

---
*Convention defined in [AGENTS.md](../../../AGENTS.md) → "Working posture" (Wrap). The record holds the numbers: [CV-1](../../build/chat-v2/CV-1.md).*
