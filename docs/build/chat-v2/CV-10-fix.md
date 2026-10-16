# CV-10-fix — "Mentioned in" rows are Chat's

> Branch `t/maciej/cv-10-fix-mention-rows` (from `t/maciej/chat-v2-build` at `ae50c2d6`) · status: **done**: verify green, validator rounds 1–2 (no BLOCKER/MAJOR), `/code-review high` and a security review run
> Migration: `supabase/migrations/20261016145000_chat_v2_mention_rows.sql` (released as `20261017112000`), **applied to the local stack** (as `supabase_admin`, one transaction; applied twice to confirm it reruns cleanly). `bun run db:test chat`, `tasks_ops`, `ops_parity` and `mcp_tools` pass.

## Delivered

- **Rules (server):**
  - Only Chat's send and edit write a "Mentioned in" row (`chat__link_mentions`). `links_op_create`, `contacts_op_link` and `email_op_link` refuse relation `mentions` or origin `ref` when either end is a conversation or a message. Every other kind and type works as before; plain references with a chat end stay open.
  - The rows are history: `links_op_delete` and `contacts_op_unlink` refuse to remove them, and `links_op_set_kind` neither retypes one nor makes one.
  - Type names are compared case- and space-insensitively.
- **Lines:** `chat_conversations_for_item` counts only Chat's rows: the conversation as the source, relation `mentions`, origin `ref`.
- **Once (data):**
  - A live mention row with a chat end in any other shape becomes a plain `references`/`manual` link. It is closed only when the pair already has a reference.
  - Other live rows with a chat end lose origin `ref`.
  - Registry labels: messages carry none. Conversations carry their channel's name, or none for a direct message, a group message or a purged channel.
- **App:**
  - A conversation or message picked with `@` or `/ref` stays a chip with no link written (`executeMention`, task capture).
  - The kind menus (Linked, drop toast) don't offer Mentions with a chat end.
  - "Mark as duplicate" leaves Chat's rows on the duplicate.
  - One shared helper decides all of this: `isChatEnd` / `isChatOwnedLink` in `src/lib/entity-links.ts`.
- **moduo-mcp:** the existing reach and scope checks already refuse chat ends. New tests prove it for every MCP tool that writes or removes links.

## Tests

| Rule | Test |
| --- | --- |
| Create, delete and set-kind refusals; ordinary links unchanged; Contacts and Email; type spelling | `supabase/tests/chat_links.test.sql` § CV-10-fix |
| Lines count only Chat's rows | same file (forged rows in both directions give no line; a send does) |
| Data steps | same file (registry-wide checks), plus a rolled-back dry run with legacy rows (retyped, duplicate closed) |
| MCP | `supabase/functions/moduo-mcp/key-scopes.test.ts` "an agent never writes a chat link" |
| App | `mention-actions.test.ts`, `kind-constraints.test.ts`, `capture-create.test.ts`, `src/lib/entity-links.test.ts` |

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **The rule also covers `links_op_set_kind`, `contacts_op_link`, `contacts_op_unlink` and `email_op_link`.** Why: the pair key ignores direction, so a row made by another op takes the slot Chat's own row needs. Rejected: guarding `links_op_*` only.
- **A conversation picked in a note or task editor stays a chip with no link.** Why: the server refuses the mention. Rejected: quietly writing a plain reference instead (a product call; see below).
- **Stray old mention rows become plain references rather than being deleted.** Why: they were links people made on purpose. Rejected: soft-deleting them all. No activity row is written for this one-time step.
- **No table trigger.** Why: Chat's own server-side paths (CV-13's "conversation of" link) must still be able to write.

## For later blocks

- CV-13: keep any new chat link kind off `mentions` and origin `ref`; `isChatOwnedLink` is the app-side test.
- ❓ for Maciej: should `@conversation` in a note or task write a plain reference link instead of staying text?

## Manual checklist

- [ ] In a note, `@` a channel → chip shows, no error toast → Notes
- [ ] Send a message with a task chip → the task's Linked shows "Mentioned in …"; the link can't be removed from the task → Tasks
- [ ] Mark a mentioned task as a duplicate → it completes; its "Mentioned in" line stays on it → Tasks

## Verify before release

- Prod: run the migration after CV-10's; the data steps touch only rows with a chat end and the chat registry rows.
- moduo-mcp needs no redeploy for this block.
