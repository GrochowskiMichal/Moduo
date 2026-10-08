# Moduo — Email Brief

> **Status:** Planned — Wave 5 (last module to ship; metadata sync lands early). Desktop-first hybrid; the most expensive module and the only territory the task/calendar/note pack structurally cannot reach.
> **Pairs with:** [PRODUCT_BRIEF.md](../../docs/PRODUCT_BRIEF.md) · [ROADMAP.md](../../docs/ROADMAP.md) · [data-layers.md §6](../../docs/data-layers.md) · siblings: Contacts, Tasks, Finance, Calendar, Notes.

---

## 1. What it is & job-to-be-done

A genuinely first-class, multi-account email client living **inside** Moduo — not an embed, not a tab that opens a webmail page. Ceiling: a full Spark replacement across up to 6 accounts, running **desktop-first** on the existing Rust IMAP/SMTP engine. Lightweight per-message metadata syncs to Supabase so email participates in the connective-tissue spine on every client (web included), even though body/management/send stay desktop at alpha.

JTBD, in the operator's words:
- *"My inbox **is** my to-do list, and I keep losing follow-ups in it."* — email is where work actually arrives; it has to spawn tracked work without a copy-paste tax.
- *"When a client emails me, I want to see they have an unpaid invoice **right there**, not go dig in another app."* — email is the moment a client becomes relevant; the contact/finance context must come to the inbox.
- *"I resent that Notion just opens my email in a new tab."* — a fake integration is worse than none. Email must feel native, fast, and the same place everything else lives.

The point of owning a real email engine is not "another mail app." It is that **`email→task`, `email→contact`, `email→invoice` are links no rival all-in-one can make** — none of Motion/Sunsama/Akiflow/Notion has a real email entity in their graph. This is the unique edge of the spine.

## 2. Depth ceiling & explicit non-goals

Ceiling: a daily-driver inbox the founder can switch to *from Spark today* — multi-account unified inbox, threaded reads, compose/reply/forward, snooze, star, basic folder/label moves, search. Never mediocre: this is the module most likely to fail the "weakest-leg" test because users have strong incumbent muscle memory, so reads and sends must feel instant.

| Non-goal (alpha) | Why |
| --- | --- |
| **Web mail backend** | A cloud relay (server-side IMAP/SMTP sync, OAuth app verification, token vault, security review) is the single most expensive thing we could build. Full web client is an explicit **post-alpha** decision, made once customers prove it matters — not us. |
| **Iframe / "opens in new tab" embed** | The exact failure users named in Notion. Email is an in-app pane on the Rust engine, full stop. |
| **Server-side rules engine / heavy filtering** | Snooze + convert + tag covers the operator loop; defer Sanebox-style automation. |
| **Calendar/scheduling-link features, send-later sequences, mail-merge** | Out of an inbox's job; Calendar owns scheduling. |
| **Real-time collaborative inbox / shared seats on one mailbox** | Multiplayer is shared-workspace **async** (§7 data-layers); accounts are per-user. |
| **Built-in AI triage/summarize** | AI is **MCP-only**. Claude reads `email_refs` and drives intent ops through the connector; no embedded model. |

## 3. The "one great moment"

**Convert an email into a task in one gesture, auto-linked to the sender's contact and the thread — without leaving the inbox.**

Press a key (or drag the message onto the Tasks drop zone): a task is created, pre-filled from subject/snippet, `entity_link`'d to the **thread** (`relation_kind: spawned_from`) and to the **contact** resolved from the sender address. The task lands in the user's default capture bucket; the email stays read in place; an undo toast confirms. The follow-up now lives in the task list where it won't rot in the inbox — and it carries its provenance both ways (open the task → jump back to the thread; open the contact → see the task under "Open work").

## 4. Must-have features

Each: one line · the insight · spine wiring.

1. **Email as a true in-app pane (3-pane: accounts → thread list → reader).**
   *Insight:* users explicitly resented Notion's iframe/new-tab email; a fake integration kills trust in the whole all-in-one.
   *Spine:* the reader is a normal Moduo surface — drop target, @-mention source, /ref-able; the message exposes an entity hub of its links inline.

2. **Unified multi-account inbox across up to 6 accounts (Gmail/Outlook/iCloud/custom IMAP).**
   *Insight:* the founder runs 6 accounts in Spark today; per-account silos are the thing being replaced.
   *Spine:* `account` is metadata on every `email_ref`; links and roll-ups are account-agnostic so a contact's history spans all mailboxes.

3. **Convert email → task, auto-linked to contact + thread (the great moment).**
   *Insight:* the inbox *is* the task list; the cost of moving a message into tracked work must be ~zero or follow-ups die.
   *Spine:* creates a `tasks_op_commit` + two `entity_links` (task↔thread `spawned_from`, task↔contact `re`) in one intent op; logged to `module_activity` with actor attribution.

4. **Email follow-up tracking — snooze → task/notification with back-link.**
   *Insight:* people lose follow-ups in the inbox; snooze in most clients just re-hides the mail. Here snooze creates a *real, scheduled* obligation.
   *Spine:* snooze writes a dated reminder that rides `module_activity` → grouped notification at the due time, deep-linking back to the thread; optionally materializes as a task.

5. **Contact context surfaced in the reader (last-touch, open invoice, open tasks).**
   *Insight:* the payoff of the all-in-one is seeing "this client has an unpaid invoice" at the moment they email you — not in a separate CRM.
   *Spine:* reader pulls the sender's Contact hub roll-up (Wave 1) by resolving sender email → contact; pure read of `entity_links`, grouped by relationship.

6. **Lightweight metadata sync to Supabase (`email_refs`).**
   *Insight:* email must link into the tissue on **every** client even though the client is desktop-only — and Finance's receipt-match needs message metadata to exist before the full email client ships.
   *Spine:* the keystone that lets email be an `entity_type` in `entity_links`, tags, comments, activity, and the dashboard widget. **Lands early** (ahead of Wave 5 UI).

7. **Feeds the Universal Inbox.**
   *Insight:* the spine's Universal Inbox gets its full payoff once real email lands; email is its highest-volume source.
   *Spine:* unread/snoozed `email_refs` surface as Universal Inbox rows alongside mentions, assignments, and overdue items — one place to triage everything.

8. **Compose / reply / forward + snooze / star / move (table-stakes, but fast).**
   *Insight:* a daily driver that's slower than Spark won't get adopted; sub-200ms interaction is a P0 bar.
   *Spine:* sends update `email_refs` (new thread entry) so a sent reply is link-addressable; compose accepts a contact via @-mention to prefill the recipient.

## 5. Key flows / interactions

| Flow | Interaction |
| --- | --- |
| **Triage** | Unified inbox list; `j/k` move, `e` archive, `s` snooze, `t` convert-to-task. Keyboard-first to match Spark muscle memory. |
| **Convert → task** | Hotkey or drag message onto Tasks drop target. Task pre-filled; auto-links thread + contact; undo toast. Never leaves the inbox. |
| **Snooze → follow-up** | Pick a date; thread hides; a reminder is scheduled; at due time a grouped notification (and optional task) deep-links back. |
| **Reader → contact** | Reader header shows the sender's Contact hub roll-up (last touch, open tasks, unpaid invoice). One click opens the full contact. |
| **Drag email → anywhere** | Email is a drag payload: onto a task (attach as context), onto a note (embed reference), onto a contact (force-link if auto-resolve missed). |
| **Compose** | `@contact` resolves a recipient; `/task` or `/note` inserts a ref into the body that becomes a typed link after send. |
| **Account setup** | Add account (provider preset or custom IMAP/SMTP). Desktop-only; web shows a "manage email on desktop" affordance while still rendering linked `email_refs`. |

## 6. Spine wiring

| Spine system | Email's participation |
| --- | --- |
| **Links / attachments** | `email_thread` and `email_message` are first-class `entity_type`s in `entity_links`. Typed kinds: `spawned_from` (task from email), `re` (email↔contact), `attachment` (email attached to task/note as context), `receipt_for` (email↔transaction — Finance). |
| **@mentions** | Compose accepts `@contact`/`@member`; resolving an inbound sender to a workspace member or contact powers the reader context panel. |
| **/refs** | `/task`, `/note`, `/contact` usable in compose; on send they persist as typed `entity_links` from the new `email_ref`. |
| **Notifications** | Snooze due-time, "you were @mentioned in a thread-derived comment," and follow-up reminders ride `module_activity`; **quiet/grouped/digest-default** — no per-email push. |
| **Activity** | Every intent op (convert, snooze, link, send) appends actor-attributed events to `module_activity`; visible on the linked task/contact timeline. |
| **Tags** | `tag_links` already polymorphic; add `entity_type='email_thread'`. Tag a thread → it shows in tag roll-ups across modules. |
| **MCP tools** | Read: `email_list_refs`, `email_get_thread_meta`, `email_search_refs`. Write (intent ops): `email_op_convert_to_task`, `email_op_snooze`, `email_op_link`, `email_op_tag`. Registered in `module-registry.ts`. *(Body/send actions stay desktop; MCP operates on metadata + links, not full message bodies, at alpha.)* |
| **Dashboard widget** | "Inbox & follow-ups" — unread count per account, snoozed-due-today, and emails awaiting a follow-up task; rows deep-link into the desktop pane (or show the linked entity on web). |

## 7. Data model sketch (Supabase-first)

Bodies, folders, flags, and send stay in **redb + the Rust engine** (desktop). Only metadata syncs:

```
email_accounts
  id            uuid pk
  workspace_id  uuid  fk -> workspaces   (RLS scope)
  owner_id      uuid  fk -> auth.users   (accounts are per-user)
  provider      text  (gmail|outlook|icloud|custom)
  address       text
  status        text  (active|reauth_required|error)
  last_sync_at  timestamptz
  -- NO secrets here: IMAP/SMTP creds + OAuth tokens stay desktop-side.

email_refs                         -- the lightweight metadata mirror
  id            uuid pk
  workspace_id  uuid  fk -> workspaces
  account_id    uuid  fk -> email_accounts
  message_key   text                 -- stable provider/IMAP message id
  thread_key    text                 -- groups messages into a thread
  from_addr     text
  from_name     text
  subject       text
  snippet       text                 -- short preview only, NOT the body
  sent_at       timestamptz
  is_read       bool
  is_snoozed    bool
  snooze_until  timestamptz
  inserted_by   uuid                 -- actor attribution (user|api_key)
  unique (workspace_id, account_id, message_key)
  index (workspace_id, thread_key), (workspace_id, from_addr)
```

Spine tables (shared, not email-owned), with email as a polymorphic participant:

```
entity_links   (from_type, from_id, relation_kind, to_type, to_id, workspace_id, created_by)
               e.g. ('task', t1, 'spawned_from', 'email_thread', thr1)
                    ('email_thread', thr1, 're', 'contact', c1)
                    ('email_message', m1, 'receipt_for', 'transaction', tx1)
tag_links      (entity_type='email_thread', entity_id, tag_id)            -- existing, polymorphic
module_activity(module='email', op, actor_id, entity_type, entity_id, payload, at)  -- existing
```

Notes on polymorphism: `email_thread`/`email_message` join the central `(entity_type, entity_id)` addressing scheme. Sender→contact resolution is a lookup on `from_addr` against the Contacts module (a contact may have multiple emails), producing the `re` link; the resolution rule, not a hard FK, keeps integrity (see open Q on polymorphic integrity in data-layers §"Open architectural questions").

## 8. Module-specific open questions

| # | Question | Recommendation |
| --- | --- | --- |
| Q-E1 | **How much metadata to sync?** | `id / thread_key / from / subject / sent_at / account / snippet` + `is_read/is_snoozed`. Enough to render Universal Inbox rows, resolve contacts, and match receipts — **no body, no recipients-list, no attachments** in Supabase at alpha (privacy + cost + scope). |
| Q-E2 | **When to land the sync?** | **Early — ahead of the Wave 5 UI.** Finance's receipt auto-match (Wave 4) needs `email_refs` to exist. Ship the Rust→Supabase metadata writer + `email_refs` table as a Wave-4 dependency; build the full in-app pane in Wave 5. |
| Q-E3 | **Sender → contact resolution: auto-create contacts?** | **Don't auto-create.** Resolve to existing contacts only; offer a one-click "add as contact" in the reader. Auto-creating from every sender floods Contacts with junk and rots the roll-ups (the exact failure mode Contacts exists to prevent). |
| Q-E4 | **What does the web client show for email?** | Read-only: linked `email_refs` render as cards/rows in entity hubs and Universal Inbox; actions that need the engine (open full body, reply, send) show "continue on desktop." Honest, not a fake pane. |
| Q-E5 | **Snooze: task vs. silent reminder?** | Default to a **silent dated reminder** (notification only); offer "also create a task." Forcing a task on every snooze clutters the list; the back-link matters more than the object. |
| Q-E6 | **MCP scope for email** | Metadata + intent ops only (convert/snooze/link/tag). **No body read, no send via MCP** at alpha — keeps the security surface small and the engine desktop-bound. Revisit with the web-client decision. |
| Q-E7 | **Receipt-match ownership (with Finance)** | Finance owns the matcher; Email owns exposing `email_refs` + a `receipt_for` link kind. Match runs over `from_addr`/`subject`/`sent_at`/`snippet`; confirmation is a one-tap link, not silent auto-attach. |

## 9. Dependencies & sequencing notes

- **Hard deps:** the **spine core** (Wave 0 — `entity_links`, tags, activity, notifications, drag contract) and **Contacts** (Wave 1 — needed for sender resolution and the reader context panel + the great moment's auto-link target).
- **Reuses, doesn't rebuild:** the existing **Rust IMAP/SMTP engine** (`src-tauri/src/commands/email.rs`, `email/` submodules, `email_sync/`) and the existing React pane scaffolding in `src/features/email/`. This module's *new* work is the metadata mirror, the spine wiring, and the convert/snooze intent ops — not a mail engine from scratch.
- **Split shipment:** `email_refs` metadata sync is a **Wave-4 prerequisite** (Finance receipt-match, Q-E2); the first-class in-app pane + convert-to-task + follow-up tracking land in **Wave 5**.
- **Sequenced last among modules** because it's the most expensive and least differentiated *in isolation* — its value is entirely the links it makes, which require the earlier modules (Contacts, Finance, Tasks) to already exist as link targets.
- **Definition-of-done:** in-app pane (no iframe) · `email_refs` syncing · convert→task auto-linked to contact+thread · snooze→reminder/task with back-link · feeds Universal Inbox · MCP tools registered in `module-registry.ts` · dashboard widget live.

Grounding files (absolute paths): `/Users/maciej/Documents/Coding/moduohyb/.claude/worktrees/quizzical-faraday-86739c/docs/data-layers.md` (§6 email hybrid flow), `/Users/maciej/Documents/Coding/moduohyb/.claude/worktrees/quizzical-faraday-86739c/docs/ROADMAP.md` (Wave 5 + Q8 early-sync dep), `/Users/maciej/Documents/Coding/moduohyb/.claude/worktrees/quizzical-faraday-86739c/src/features/email/` (existing pane + `model/email-types.ts`), `/Users/maciej/Documents/Coding/moduohyb/.claude/worktrees/quizzical-faraday-86739c/src-tauri/src/commands/email.rs` + `src-tauri/src/email_sync/` (Rust engine to reuse).
