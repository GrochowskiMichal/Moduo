# Manual test checklist — CV-6a Device notices (server)

> Generated 2026-10-15 · branch `t/maciej/cv-checkpoint-3`, folded from the record [`CV-6a`](../../build/chat-v2/CV-6a.md) (block branch `t/maciej/cv-6a-device-notices-server`) · **Live-verified:** no. Server-only; proven by `chat_notices.test.sql` and `templates/chat-waiting.test.ts`. The browser items need a subscribed browser and the Vault secret set.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Server checks (terminal, local stack up)

- [ ] **Do:** with `20261017107000_chat_v2_device_notices.sql` applied, run `bun run db:test chat` → **Expect:** every chat file passes, among them `chat_notices` _(terminal)_

## Browser and email

- [ ] **Do:** A sends B a direct message with a browser subscribed and Vault set → **Expect:** after about 8 s B's browser shows "A · Workspace" with the text _(browser)_
- [ ] **Do:** B turns "Show message text" off (the SQL op for now), then A sends another → **Expect:** the next notice has no text _(browser)_
- [ ] **Do:** three quick messages → **Expect:** one notice reading "3 messages: …" _(browser)_
- [ ] **Do:** with B's apps closed for over an hour and an unread DM over an hour old → **Expect:** one "A messaged you in …" email in Mailpit; a second DM within the hour → no second email _(Mailpit)_

## Edge cases

- [ ] **Do:** delete or edit a message with an unsent notice → **Expect:** a delete drops it and blanks the words of the rest; an edit redraws the words _(psql)_
- [ ] **Do:** a person on Nothing, a person who can't read the conversation, and the sender → **Expect:** none gets a notice _(psql)_

## Verify before release

- [ ] **Do:** release order → **Expect:** `email-worker` (the `chat_waiting` template) and `push-send` deploy before this migration _(release)_
- [ ] **Do:** probe prod's `email_outbox_kind_check` before applying → **Expect:** every kind on prod is in the list the migration re-states _(prod)_
- [ ] **Do:** watch Edge invocations in a busy workspace, and send latency of `@channel` in a 100+ member channel → **Expect:** one push-send call per notice (up to about 20 s wait) and an acceptable send latency _(prod)_

## Known gaps / not-yet-testable

- The five switches (Direct messages, Mentions and replies, Announcements, Every message, each key's) don't yet turn off the server's notice or the email (CV-18 or its owner; see CV-6b).
- `notice__gate` sends everything until CV-18 gives it rules; `user_clients` is not in the export (CV-22).

---
*Convention defined in [AGENTS.md](../../../AGENTS.md) → "Working posture" (Wrap). The record holds the numbers: [CV-6a](../../build/chat-v2/CV-6a.md).*
