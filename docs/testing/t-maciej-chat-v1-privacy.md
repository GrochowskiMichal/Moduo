# Manual test checklist — Chat v1 privacy rules (`t/maciej/chat-v1-privacy`)

> Generated 2026-10-14 · branch `t/maciej/chat-v1-privacy` · **Live-verified:** partial — every rule proven on the local stack (`bun run db:test chat_privacy`, 52 checks, and a websocket probe with three throwaway accounts: a member joins a conversation's typing topic, an outsider cannot, a client's own broadcast never reaches anyone, and a server-written typing event arrives with the session's sender). Not yet seen in the running app with two browsers.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where. Needs a Duo/Team workspace with two members (A and B) and a third member C who is not in the private channel.

## Typing (one private topic per conversation, written by the server)
- [ ] **Do:** As A, open a private channel that B is in; as B (second browser) open the same channel and start typing → **Expect:** A sees "B is typing…" within a second or two, it clears a few seconds after B stops _(web)_
- [ ] **Do:** Same, but C (not in the private channel) has Chat open on another conversation → **Expect:** C never sees a typing line for that channel, and the browser's Realtime traffic (DevTools → WS) shows C joined to `chat:<workspace>` and `chat:typing:<C's open conversation>` only _(web)_
- [ ] **Do:** B types in a thread of that channel → **Expect:** A sees the typing line in the thread panel, not under the channel's composer _(web)_
- [ ] **Do:** B sends the message → **Expect:** the typing line disappears at once _(web)_
- [ ] **Do:** Switch conversations as A → **Expect:** the previous conversation's typing line is gone; the new one works _(web)_
- [ ] **Do:** Both browsers open → **Expect:** the online dots (presence) still show for everyone in the workspace _(web)_

## Activity feed and registry
- [ ] **Do:** As A, create a private channel with B and mention B in it; as C open the bell / notifications and the dashboard's activity → **Expect:** C sees nothing about that channel (no name, no excerpt); B sees the mention _(web)_
- [ ] **Do:** As A, create a public channel → **Expect:** C sees its "channel created" activity as before _(web)_
- [ ] **Do:** As A, mention B in a direct message → **Expect:** B gets the notification; C sees nothing about it _(web)_

## Settings → chat capabilities
- [ ] **Do:** As a member, open Settings → the chat capabilities panel → **Expect:** the role switches load as before _(web)_

## Announcement-only channels
- [ ] **Do:** As the channel's creator, switch "announcements only" on and off → **Expect:** works as before _(web)_
- [ ] **Do:** As someone with "Manage any channel" who is not in a private channel, try the switch through the API (`share_op_announce`) → **Expect:** "That channel is gone." _(web)_
- [ ] **Do:** Try it on a direct message through the API → **Expect:** "Direct messages can't be announcement-only." _(web)_

## Edge cases
- [ ] **Do:** Open Chat in an older build (a desktop app not yet updated) → **Expect:** presence still works; typing lines no longer show there until the build is updated _(desktop)_
- [ ] **Do:** As a Free-plan workspace member → **Expect:** nothing changes (chat stays off) _(web)_

## Migrations / data
- [ ] **Do:** `supabase/migrations/20261014090000_chat_privacy_rules.sql` on prod → **Expect:** `select to_regprocedure('public.chat_op_typing(uuid, uuid, boolean)')` is not null; `pg_policies` on `realtime.messages` shows `chat_realtime_read` (SELECT) and `chat_realtime_write` (INSERT, presence only); `has_function_privilege('anon', 'public.chat_op_typing(uuid, uuid, boolean)', 'EXECUTE')` is false _(prod)_
- [ ] **Do:** `bun run db:test chat_privacy` on the local stack → **Expect:** 52 checks pass _(local)_

## Known gaps / not-yet-testable
- The app-level pass (two browsers) waits for the web app to carry this branch; until then typing lines are off everywhere once the migration is on prod (clients no longer broadcast, and the old listener hears nothing).
- Older desktop builds keep presence and lose typing lines until updated.
