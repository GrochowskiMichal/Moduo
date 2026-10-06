# Spec: Chat — real-time messaging for Duo / Team

> Status: **v1 built** 2026-10-06 (`t/mike/chat`) · Owner: mike · Related: [ROADMAP](../docs/ROADMAP.md) *Communication module* + Q14 · [decisions 2026-10-02](../docs/decisions.md) · [`specs/moduo-meet.md`](./moduo-meet.md) (calls — separate track) · [module contract](../docs/moduo-module-contract.md)
>
> Built directly from the designer's ask ("end to end … production ready … world-class UI/UX") without a `/s1` grilling round. Every product call below is an **assumption made by the agent** and is listed so the designer can overturn it — see *Assumptions to confirm*.

## Scope (v1)

A new **Chat** tab (`/chat`, ⌘7) with Slack/Discord-class messaging that lives next to the work:

- **Conversations:** public channels, private channels, 1:1 DMs, group DMs (≤ 9 people), notes-to-self DM. `#general` is created per workspace and joined on first visit.
- **Messages:** markup (bold, italic, strike, inline + block code, quotes, autolinks), edit, delete (soft — "This message was deleted."), emoji reactions (≤ 20 per message), pins, threads (replies + facepile + "last reply" summary), jumbo emoji, optimistic send with retry/discard on failure, idempotent sends (`client_id`).
- **Moduo moat:** type `#` to link any registry entity (task, note, contact, event…) as a live `EntityRefChip` that deep-links; *Create task from message*; chat notifications use the existing bell + deep links.
- **Real time:** messages, edits, reactions, thread counts, channel changes, membership — via Realtime `postgres_changes` (RLS-filtered); typing + presence via a private broadcast/presence channel. Reconnect / long sleep → resync (realtime is latency, not truth).
- **Unread:** per-channel read mark, "New" divider at the mark you opened with, unread weight + mention pills in the rail, *Mark unread*, nav-tab dot.
- **Quiet bar** (PRODUCT_BRIEF §7): notifications only for @you, @channel, and replies in threads you're in. Per-conversation level: *Every new message / Mentions only / Mute*. Nav badge = DM unread + channel mentions (+ all unread for channels set to "every message"), muted never counts.
- **Navigation:** sidebar (Starred · Channels · DMs, collapsible), ⌘J switcher, ⌥↑/↓ conversations, ⌥⇧↑/↓ unread only, ↑ edit last, Esc closes panels/edits, Browse channels (incl. archived), search across every conversation you can read.
- **Gate:** the workspace **owner's** plan ranks ≥ Duo (Duo, Team, Founder). Members inherit it. Other workspaces show an explainer + *Upgrade to Duo* (owner) or an "ask the owner" note (member).

**Out of scope (v1):** voice/video calls (→ Moduo Meet), file uploads/attachments, message forwarding, scheduled messages, custom emoji, link unfurls, guest accounts.

## Data model (migration `20261006150000_chat_module`, `20261006151000_chat_edit_mention_scope`)

| Table | Purpose |
| --- | --- |
| `chat_channels` | `kind ∈ {channel, dm}`, unique lower(name) per workspace, `dm_key` (sorted member ids) unique per workspace, topic, private flag, archive, `last_message_at` |
| `chat_members` | per-user state: `notify_level ∈ {all, mentions, none}`, `starred`, `last_read_at` |
| `chat_messages` | top-level + replies (`parent_id`), mentions `uuid[]`, **denormalized** `reactions jsonb` and thread rollups (`reply_count`, `last_reply_at`, `reply_user_ids`), pins, soft delete, `client_id` |

- Reactions/rollups live on the row so **every live change is one UPDATE on one table** → one Realtime stream with RLS. Deletes are soft for the same reason (a DELETE event bypasses RLS).
- Clients only `SELECT` (RLS `chat_can_read_channel`). Every write is a `chat_op_*` SECURITY DEFINER op that re-checks membership + the plan gate. `anon` has nothing.
- Activity: `chat.mention` / `chat.reply` (with `notify_user_ids`, `excerpt`, `channel_name`) feed the bell; `chat.channel_create/_archive/_unarchive` for lifecycle. Plain messages are **not** activity rows (the message is its own record).
- Contracts: `CHAT_CHANNEL_KINDS`, `CHAT_NOTIFY_LEVELS`, `CHAT_PLAN_TIERS` / `planHasChat` in `@contracts/vocabularies`.

## Code map

- Server: `supabase/migrations/2026100615*`.
- Runtime seam: `ModuoRuntime.chat` → `src/lib/runtime.chat.web.ts` (web + desktop share it).
- Pure logic (unit-tested): `src/features/chat/{markup,timeline,mappers,emoji,search}.ts`.
- Realtime: `src/features/chat/realtime.ts` (ref-counted shared link per workspace).
- State: `hooks/use-chat-module.ts` (page), `hooks/use-chat-badge.ts` (app chrome).
- UI: `src/features/chat/ui/*`, page `src/routes/pages/chat-page.tsx`, story `chat.stories.tsx`.

## Assumptions to confirm (designer)

1. **Tab placement:** Chat is the 7th tab (after Contacts, ⌘7) so nobody's ⌘1–⌘6 changes. Alternative: next to Email.
2. **Locked tab is visible** to Free/Pro as an upgrade surface (vs hidden).
3. **Everyone in the workspace can chat**, including `viewer` role.
4. **Any member can add people** to a channel they're in (Slack default); only the creator / workspace owner / admin can rename, archive, or remove others.
5. **Private can't be changed later** (simpler + no accidental exposure).
6. **DMs don't hit the bell** — they show on the Chat tab badge; @mentions and thread replies do hit the bell.
7. **Message deletes** are permanent for everyone (with a confirm toast); admins can delete anyone's.
8. **Plain-text-with-markup composer** (Slack "markup mode") rather than a Lexical rich editor.

## Agents (MCP) — migration `20261006160000_chat_agent_access`

- Chat has its **own key scope** (`scopes.chat`), **none by default**. Settings → API keys → *Chat: No chat / Read public channels / Read + post*.
- Tools: `chat_list_channels`, `chat_read` (channel or one thread), `chat_search` (view) · `chat_post` (edit).
- **Apps only ever see public, non-archived channels.** DMs and private channels are invisible to every key.
- A post is attributed to the key: `author_kind = 'api_key'`, `author_label` = key name, rendered with a bot glyph + "App" badge. `<@USER_ID>` mentions notify like a person's would (activity actor = `api_key`).
- Only `chat_op_agent_post` is agent-callable (service_role); the in-app ops resolve `auth.uid()` and are deliberately not exposed.
- Verified over HTTP against the deployed connector 2026-10-06 (temporary key + channel, removed after).

## Home widget

- **Conversations** widget (S/M/L): what needs you first (DM unread, mentions, "every message" channels), then most recent; live via the shared realtime link; non-Duo workspaces get a one-line note.

## Next

- Attachments (Storage bucket + previews), link unfurls.
- Calls: reuse the Moduo Meet engine (`specs/moduo-meet.md`) for huddles from a conversation header.
- Optional: `entity_links` rows when a message references an entity, so the entity's hub shows "Discussed in #channel".
