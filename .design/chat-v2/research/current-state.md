> Raw research report from the Chat re-plan, 2026-10-13 (branch t/maciej/chat-replan). Nothing here is decided.

# Chat v1: the honest current state

Chat v1 was built on 2026-10-06 by Mike (`specs/chat.md`), straight from the ask, without a planning round. Every product call in it was the agent's assumption.

This report reads the code first (`src/features/chat/**`, `src/routes/pages/chat-page.tsx`, `src/lib/runtime.chat.web.ts`, the chat migrations, the MCP chat module). Then it checks the code against the local stack with three people: the owner (dev), a member (Tess Mate) and a viewer (Third Member), in a new workspace "Chat replan research" seeded through the real chat ops. Lines marked **Live:** were seen in the running app or the local database. Everything else comes from reading code.

_Status: written in sections while the research ran. Sections without a "Live:" line are code-only._

## 0. Shape in one paragraph

Chat is three tables: `chat_channels`, `chat_members` (per-person read mark, notify level, star) and `chat_messages` (top-level messages and thread replies in one table). Reactions and thread rollups are stored on the message row (`supabase/migrations/20261006150000_chat_module.sql:103-124`), so every live change is one row update. The app only reads tables directly. Every write is a `chat_op_*` database function (`src/lib/runtime.chat.web.ts:154-294`). The page keeps everything in React state in one 990-line hook (`src/features/chat/hooks/use-chat-module.ts`). Live updates come from a shared Supabase Realtime link per workspace (`src/features/chat/realtime.ts`). There is no local cache, no offline queue and no use of the Tasks v3 shared store. Later migrations added per-role chat abilities (`workspace_chat_caps`), channel managers and an announcement switch (`20261006210000_perm_sharing.sql:415-465, 918-998, 1196-1213`), but the app barely knows about them (see §1, Members).

(Section 1, the feature table, is near the end because it leans on the live walk-through. Sections 2–7 come first.)

## 2. Module-contract checklist

The contract (`docs/moduo-module-contract.md`, "A module isn't done until") against Chat:

| Contract item | Chat v1 | Evidence |
| --- | --- | --- |
| Every write is a named op | **Yes**, with one oddity | Clients have SELECT only (`20261006150000_chat_module.sql:153-155`). All writes are `chat_op_*`. The announcement switch is `share_op_announce`, outside the chat namespace (`20261006210000_perm_sharing.sql:1196`). |
| Ops check the module permission (`chat.view/edit`) | **Partly** | Ops check workspace membership and the plan only (`chat_op__guard`, `20261006150000_chat_module.sql:171-181`). Role rules come from table triggers (`perm_enforce_write('chat')` and `share_chat_message_guard`), so they apply to sends, deletes and channel creation, but not to pins, reactions, joins or member changes. |
| Every op writes an attributed `module_activity` row | **No** | Only `chat.channel_create`, `chat.channel_archive/_unarchive`, `chat.mention`, `chat.reply` write rows (`20261006150000_chat_module.sql:264, 365, 521`). Edit, delete, react, pin, rename, topic, join, leave, add/remove member and the announcement switch write nothing. Plain messages are deliberately not logged (the message is its own record). Moderation leaves no trail: an admin deleting someone's message or removing a person is invisible afterwards. |
| The activity trail renders in the module | **No** | There is no channel history or "about" trail. The lifecycle rows only reach the bell (`src/features/spine/activity.ts:151-166`). |
| Manifest entry in the registry | **Yes** | `src/features/chat/ops-manifest.ts`, listed in `src/lib/module-registry.ts:21`. One agent op (`chat.agent_post`) and three read resources. |
| Search registry (`entities`) | **No** | No chat migration calls `entities_op_*`. Channels and messages are invisible to ⌘K search, `@` pickers and References. |
| Spine links (`entity_links`) from messages | **No** | A `#` link lives only in the message text (`<moduo:task:ID|Label>`, `src/features/chat/markup.ts:6`). The task never learns it was discussed. `specs/chat.md` §Next lists this as optional. |
| Erasure on account deletion | **Yes** | `20261008013000_account_erase_workspace_data.sql:300-360, 453-459`: DMs and private channels with nobody else left are deleted, sole managers are replaced, messages stay without a name (author set to null by the auth cascade). The DM's member list (`dm_key`) keeps the deleted person's id; the app shows "Former member". |
| Lossless export | **No** | The workspace export covers tasks, notes, contacts, calendar, habits and attachments only (`src/features/settings/advanced.ts:15-21`). Chat is not exported. |
| Attachments | **None in v1** | Out of scope in `specs/chat.md`. No upload path, no paste of images. |
| Agents (MCP) | **Yes, narrow** | `supabase/functions/moduo-mcp/modules/chat.ts`: list channels, read, search (public channels only), post as an "App". Own key scope `chat`, none by default. **Not live-tested**: the local edge runtime is stopped. |

## 3. Tasks v3 shared pieces: do they exist, and does Chat use them?

Bottom line: Chat uses only `EmptyState`, the raw `Avatar` primitive and a few old spine helpers. It is not registered in any of the v3 registries.

| Shared piece | Exists in code? | Chat uses it? |
| --- | --- | --- |
| Right-panel registry `src/lib/panel-registry.ts` | Yes. `PanelModule` is `"tasks" \| "calendar" \| "email" \| "notes" \| "contacts"` (`:34`). Each module supplies a `panel-views.ts`. | **No.** No chat entry and no `features/chat/panel-views.ts`. Chat has its own local `"details" \| "search"` panel state (`src/routes/pages/chat-page.tsx:49`). Threads live in the URL (`?t=`). |
| "← item" stack in `src/components/app/right-panel.tsx` | Yes. `usePanelStack()` (`:76`) gives `push/back/clear`; References open items in the panel through `ReferenceHost.openInPanel` (`src/features/spine/references/context.tsx:22`). | **No.** A linked task in a message opens the Tasks page instead (`src/features/chat/ui/message-body.tsx:95` dispatches `ENTITY_OPEN_EVENT`). |
| Capture registry `src/lib/capture-registry.ts` | Yes. `CaptureModule` includes `"chat"` (`:24`), but only task, notes, calendar and contacts capture types are registered. | **No.** "Create task from message" calls the older `createCapturedEntity` (`chat-page.tsx:311-329`). No capture shell, no link back to the message, and the toast's "Open" goes to `/tasks`, not the new task. |
| References (RF-1) `src/features/spine/references/*` | Yes: chip/card/hover kinds for task, email, contact, company, note, event, project, tag; "Private item" / "Deleted …" states; stored as `moduo://type/id` without a title. | **No.** Chat renders the old `EntityRefChip` (`message-body.tsx:8, 88`) and stores the title inside the token. |
| Grammar `src/features/spine/grammar.ts` | Yes. `@` = people and things, `#` = tags, `/` = commands (`:17-19`), task handles like `MOD-142` (`:231`). | **No, and it conflicts.** Chat's composer uses `#` for "any Moduo item" (`src/features/chat/ui/composer.tsx:5-7`). `docs/decisions/spine.md` (2026-10-08) says `@` covers people, items and channels, and `#` is tags. |
| DS-6 kit (`src/components/ui/`: Row, NavRow, GroupHeader, MetaCount, Chip, EmptyState, Feed, Avatar, ItemCard, PropertyRow, CollectionHeader) | Yes, all exist (`kit.ts`). | **Only `EmptyState` and the raw `Avatar`.** The rail is hand-built, not `NavRow`. `src/features/chat/ui/person-avatar.tsx` re-implements `PersonAvatar`/initials next to the kit's own. |
| Shared store (TV-D11a/b) `src/lib/sync/` (`store.ts`, `cache.ts`, `delta-cursor.ts`, `react.ts`) | Yes. IndexedDB copy, delta reads per table cursor, realtime merge, offline outbox. Generic in shape, but only Tasks tables are registered and the outbox only takes task captures and status changes. | **No.** Chat holds everything in React state, refetches on every open and resync, and has no outbox. |
| Lexical title editor (TV-U14) `src/features/tasks/capture/title-editor.tsx`, `token-node.tsx`; reusable `src/features/spine/editor/mention-menu-plugin.tsx` and `entity-text-editor.tsx` | Yes. `@ # /` typeahead with tokens. | **No.** Chat's composer is a plain `<textarea>` (`composer.tsx:466`) with its own `@`, `#` and `:` pickers. |
| Comments + six fixed reactions (TV-U13) | Comments exist (`src/features/spine/comments.ts`, `src/features/spine/ui/comments-panel.tsx`). The six reactions (👍 ✅ 👀 🙏 ❤️ 😄, never notifying) are plan only (`specs/tasks-v3.md:103`, TV-U13 unchecked). | **No.** Chat allows any emoji, up to 20 per message, stored on the row (`20261006150000_chat_module.sql:112, 609`). Quick row is 👍 ❤️ 😂 (`src/features/chat/emoji.ts:156`). |
| Bottom bar "mode" pattern | **Not built yet.** `src/components/app/global-bottom-bar.tsx:41` has three fixed buttons; the mode row is planned as TV-U12. | No. |

Docs drift: `specs/BUILD_ORDER.md:302` still says chat is "Planned — not yet specced", and `specs/tasks-v3.md` never mentions chat.

(Sections 4–7 follow.)
