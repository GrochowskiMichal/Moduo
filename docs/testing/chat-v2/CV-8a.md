# Manual test checklist — CV-8a Sidebar, toolbar and states; v1's screens retired

> Generated 2026-10-16 · branch `t/maciej/cv-checkpoint-4`, folded from the record [`CV-8a`](../../build/chat-v2/CV-8a.md) (block branch `t/maciej/cv-8a-sidebar-states`, landed `44cdafdd`) · **Live-verified:** by the block's tests (`shell.test.ts`, `store.test.ts`, `tests/visual/chat-states.spec.ts`, `tests/chat-shell.spec.ts`); the steps below are the human pass. No migration.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## In the app

- [ ] **Do:** open Chat in a two-person workspace → **Expect:** General opens; the left panel reads Catch up · hairline · Channels · Direct messages; no `#` anywhere _(web)_
- [ ] **Do:** new workspace, first open → **Expect:** General shows "Everyone in … is here." and the welcome line; send a message and the welcome goes _(web)_
- [ ] **Do:** pin a conversation from ⋯ → **Expect:** a Pinned section appears above Channels; unpin and it goes _(web)_
- [ ] **Do:** have someone post in a channel set to Mentions and replies → **Expect:** its name turns bold with no number; an @mention of you adds a number _(web)_
- [ ] **Do:** collapse Direct messages, reload → **Expect:** still collapsed _(web)_
- [ ] **Do:** archive a channel as its manager → **Expect:** the composer becomes the archived line with Unarchive; the channel is under the hairline ⋯ › Archived channels _(web)_
- [ ] **Do:** as a viewer, open General → **Expect:** messages readable, reactions work, "You can read this conversation but not post in it" _(web)_
- [ ] **Do:** make a channel announcements-only; as a member → **Expect:** "Only managers post here · Reply privately"; Reply privately opens a DM with the managers _(web)_
- [ ] **Do:** remove someone from the workspace; open your DM with them → **Expect:** "<name> left the workspace"; their messages keep their name with "former member" _(web)_
- [ ] **Do:** lapse the plan (local: drop the grant) → **Expect:** every conversation still opens; the owner sees "Choose a plan", a member sees "<owner> can turn it back on." _(web)_
- [ ] **Do:** go offline with Chat open → **Expect:** "You're offline · reading from this device" above the composer _(web)_
- [ ] **Do:** open a `/chat?c=<another workspace's conversation>` link → **Expect:** no toast; the app switches workspace if it's yours _(web)_
- [ ] **Do:** one-person workspace with no messages → **Expect:** no Chat tab _(web)_

## Verify before release

- [ ] **Do:** open a paused workspace from the device copy → **Expect:** a composer that works until the plan check answers (a send then reads "Not sent · Retry"); keep `paused` in the device copy if it shows up _(web)_
- [ ] **Do:** a custom role with chat view-only and `read_only` false → **Expect:** the viewer line while the server lets it post (the UI errs strict); CV-15's role editor should keep them aligned _(web)_
- [ ] **Do:** the welcome's disappearance → **Expect:** proven after a reload; live it follows the channel's `last_message_at` _(web)_
- [ ] **Do:** a workspace whose member list fails to load → **Expect:** the Chat tab shows (treated as loading) _(web)_

## Known gaps / not-yet-testable

- Presence is off while paused (CV-17 later moved it off the plan); `global-css.test.ts` no longer names a chat pane in its gutter check.

---
*Convention defined in [AGENTS.md](../../../AGENTS.md) → "Working posture" (Wrap). The record holds the numbers: [CV-8a](../../build/chat-v2/CV-8a.md).*
