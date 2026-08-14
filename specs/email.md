# Spec: Email module (Spark replacement, desktop-first hybrid)

> Status: **Shipped** — EM-1…EM-11 all landed 2026-07-04 → 2026-07-07 (Wave 5 complete). Planned 2026-07-04. **[`specs/BUILD_ORDER.md`](./BUILD_ORDER.md) is the status of record**; this spec is the design/AC reference. Test checklists: [`docs/testing/email-em1-em3.md`](../docs/testing/email-em1-em3.md) … [`email-em11.md`](../docs/testing/email-em11.md). · Owner: maciej · Related briefs: [.design/email/BRIEF.md](../.design/email/BRIEF.md), [.design/email/DESIGN_BRIEF.md](../.design/email/DESIGN_BRIEF.md) · Architecture: [docs/data-layers.md §6](../docs/data-layers.md)
>
> **Scope call (2026-07-04 pm, designer):** Email is the **next build**, ahead of the Dashboard/Mindmap reworks (partial reversal of the same-day morning call; Finance stays post-alpha). Bar: **full Spark parity before the designer switches** — the module ships whole, then dogfood starts.

## Scope

A first-class multi-account email client inside Moduo (desktop app), replacing Spark for the founder: unified conversation inbox across custom-IMAP + Gmail + iCloud accounts, Done-driven triage, snooze, follow-up tracking, full compose (reply/forward, signatures, templates, undo send, attachments), rule-based smart inbox, hybrid search — wired into the spine (convert→task auto-linked to contact+thread, tags, hubs, notifications, MCP, widget). Desktop-first per the recorded architecture: the Rust IMAP/SMTP engine + redb cache own bodies/folders/flags/send (the sanctioned redb exception); **Supabase receives only "tissue" email metadata** — emails deliberately linked/converted/snoozed/followed-up/tagged. Web renders the tissue view read-only. No cloud mail relay at v1 (a locked non-goal — see Out of scope).

## Product behavior & UX

The interaction spec lives in [.design/email/DESIGN_BRIEF.md](../.design/email/DESIGN_BRIEF.md); the contract-level flow:

1. **Connect accounts** (desktop Settings→Email or the module's empty state). Preset chips: **Gmail** (two paths side by side: "Sign in with Google" OAuth button + "Use an app password" with a hint link; personal @gmail.com accepts both), **iCloud** (app-specific password hint), **Custom IMAP** (host/port fields, hints; validates by connecting). Credentials go to the OS keychain, never the cloud, never redb-cleartext. Account rows show status (`active` / `reauth_required` / `error`) with a Reconnect affordance; the OAuth path labels its testing-mode 7-day re-login honestly.
2. **Unified inbox** (`/email`, main nav "Email", ⌘-number, unread badge). One row per **conversation** across all visible accounts, newest first, with account attribution (hue dot, CAL-6 pattern). Sections (smart inbox): **Personal / Notifications / Newsletters**, rule-based, with per-sender "Always put …" override in the row/reader menu. Per-account filter in the left rail (accounts + folder tree, counts).
3. **Read**: selecting a row opens the conversation in the reader — message stack, older collapsed, HTML bodies in the sandboxed iframe (remote images load by default), attachments listed with download/save. Sub-200ms for cached bodies; prefetch rides the existing engine.
4. **Triage, keyboard-first**: `j/k` move, `Enter` open, `e` **Done** (archive: Gmail = leaves the label, stays in All Mail; others = move to Archive), `p` pin/star, `s` snooze, `t` convert→task, `m` move-to-folder (all server folders listed), `#` delete→Trash. Every action optimistic with an undo toast; offline/failed ops queue in the engine outbox and retry.
5. **Snooze**: pick a time (presets + custom) → the thread leaves the inbox (moved to `Moduo/Snoozed` on the server; local-hide fallback where folder creation is refused) → at due time it returns to the inbox and a quiet grouped notification deep-links to it. Snoozed section in the rail.
6. **Follow-up tracking**: on a sent thread (or at send time), "Remind me if no reply by …" → if a reply arrives, the reminder clears silently; at due with no reply, a notification deep-links the thread, with a one-tap "make it a task". Follow-ups section in the rail.
7. **Convert → task (the great moment)**: `t` or drag the row/reader onto the Tasks drop target → task created instantly, title from subject, description carries snippet + a back-link; `entity_links`: task **spawned-from** email_thread, email_thread **references** the sender's contact (when resolved). The email **stays put**; toast = "Task created · Undo · Also mark done". The task's detail panel opens in the right panel (notes NO-5 pattern) so scheduling happens without leaving the inbox.
8. **Contact context**: the reader header resolves sender→contact (by email, across a contact's addresses) and shows the compact contact panel in the right panel: last touch, open tasks, linked items, tags. Unknown sender → quiet "Add as contact" (never auto-created).
9. **Compose**: reply / reply-all / forward from the reader (proper In-Reply-To/References), or ⌘N new. Fields: from-account picker, to/cc/bcc with contact autocomplete (@-mention machinery), subject. Body = Lexical rich text → HTML + plain multipart. Per-account **signature** auto-appended (editable in Settings). **Templates** insertable from a menu (personal, cloud-synced). Attach files. Send = 10s **undo window** (mail leaves after the timer; Undo reopens compose); sent copy lands in the account's Sent folder.
10. **Search** (`/` or the toolbar): instant local results over synced envelopes + cached bodies as you type; a "Search entire mailbox on <account>" escalation runs server-side IMAP search per account with honest progress/timeout/unsupported states.
11. **Web** (`/email` on web): read-only tissue view — Snoozed, Follow-ups due, Recently linked email cards — each with the linked entities and a quiet "Continue on desktop" affordance. Email cards in hubs/notifications render everywhere.

**States**: empty (no accounts → connect CTA; empty inbox → calm inbox-zero state), loading (skeleton rows), error (per-account error rows + banner, never a blank module), reauth (row-level Reconnect), offline (reads from cache, ops queue with "will sync" affordance), view-only member (web tissue view only — email accounts are per-user; nobody else ever sees your inbox).

## Edge cases

- **Custom hosting refuses `CREATE Moduo/Snoozed`** → snooze degrades to local-hide (still leaves Moduo's inbox, resurfaces on time; other clients still show it) — recorded per-account, no error spam.
- **Server without UIDPLUS / APPEND quirks** → plain EXPUNGE is safe (we never batch-set `\Deleted`); failed copy-to-Sent is non-fatal (send succeeded; warn once).
- **Gmail label semantics** → archive = expunge from INBOX label (stays in All Mail); a message under two labels shows per-folder; search-result merge dedupes by Message-ID.
- **OAuth token expiry (testing mode, 7 days)** → refresh fails with `invalid_grant` → account flips `reauth_required`, badge on the account row + Settings; one click re-runs the flow. Never a silent dead account.
- **IMAP SEARCH quirks** (charset, slow shared hostings) → UTF-8 attempt → ASCII fallback → honest `unsupported`/`timeout` states in the UI; local results always remain.
- **Reply arrives while thread is snoozed** → thread un-snoozes immediately (new activity beats the timer) and returns to the inbox unread.
- **Follow-up thread gets a reply from another of your own accounts** → still counts as a reply only if from the counterpart, not your own address (self-replies don't clear).
- **Undo-send race (app quit within the 10s)** → the mail does **not** send (JS timer owns it); compose draft is preserved locally and surfaced on next open.
- **Second desktop** → accounts/creds are per-machine (keychain); the account registry row shows "connected on another device" rather than error-flapping (CAL-8a lesson g).
- **Deploy gap** (migration not yet applied) → desktop client works fully standalone (engine is local); tissue actions (convert/snooze refs, tags) degrade with the 42703-style guard + honest toast; nothing corrupts.
- **Thread with malformed/missing References** → threading falls back subject+refs heuristics; a mis-grouped thread never blocks triage (actions apply to the selected messages' UIDs).
- **Huge attachment / body over cache caps** → bodies stay LRU-capped; attachments stream to disk and are never stored in redb.
- **Deleted/archived elsewhere mid-action** → op outbox surfaces the failure once, list resyncs; no retry storm.

## Acceptance criteria

- **AC1 — Connect (password paths)**: the connect dialog offers Gmail / iCloud / Custom IMAP presets with credential hints; connecting validates against the server, stores the secret in the OS keychain (legacy redb-cleartext secrets migrate lazily and are removed), and the account syncs. Disconnect removes the keychain secret.
- **AC2 — Connect (Google OAuth)**: "Sign in with Google" completes the PKCE flow, connects Gmail via XOAUTH2 (IMAP+SMTP), auto-refreshes access tokens, and surfaces expiry as a `reauth_required` Reconnect — labeled with the testing-mode caveat.
- **AC3 — Unified conversation inbox**: one row per thread across all accounts (References-root threading; 3+ message chains stay one thread), account attribution, per-account filter, unread badge on the nav item.
- **AC4 — Reader**: conversation stack with collapsed older messages; HTML renders sandboxed with remote images on; cached message opens feel instant; attachments list with save-to-disk that produces the correct decoded file.
- **AC5 — Triage**: Done/pin/move/delete + `j/k/e/p/m/#` work from list and reader, optimistically with undo toasts; the change is visible in webmail (server-side); offline actions queue and flush on reconnect.
- **AC6 — Snooze**: snoozing hides the thread (server move where possible, local-hide fallback), the rail shows Snoozed; at due time the thread returns and a grouped notification deep-links it; un-snooze works; an early reply un-snoozes.
- **AC7 — Follow-ups**: a sent thread can carry "remind me if no reply by X"; a counterpart reply clears it silently; at due, a notification deep-links the thread and offers "make it a task"; the rail shows Follow-ups.
- **AC8 — Convert→task (great moment)**: `t`/drag creates the task pre-filled and linked (task spawned-from email_thread; email_thread references the resolved contact), the email stays, the toast offers Undo + "Also mark done", and the task detail opens in the right panel. Undo removes task + links + ref.
- **AC9 — Contact context**: the reader resolves sender→existing contact and shows last-touch/open-tasks/links in the right panel; unknown senders get one-click "Add as contact"; no auto-creation ever.
- **AC10 — Compose**: reply/reply-all/forward thread correctly in recipients' clients (In-Reply-To/References); cc/bcc; rich-text body sends as HTML+plain multipart; the account's signature auto-appends; templates insert; files attach and arrive intact; a copy lands in Sent (no Gmail duplicates); SMTP goes over TLS/STARTTLS only.
- **AC11 — Undo send**: send starts a 10s hold with an Undo toast; Undo reopens compose with everything intact; app-quit inside the window results in no send + a preserved draft.
- **AC12 — Search**: local search returns matches over senders/subjects/cached bodies as you type; the per-account server escalation returns full-mailbox hits on Gmail (X-GM-RAW) and standard servers (SEARCH TEXT w/ charset fallback), reporting `timeout`/`unsupported` honestly.
- **AC13 — Smart inbox**: threads classify into Personal / Notifications / Newsletters by deterministic header/sender rules; a per-sender override re-files the sender everywhere, persists, and syncs; classification never delays the list render.
- **AC14 — Tissue privacy**: only convert/snooze/follow-up/link/tag actions create `email_refs` rows (+ `email_thread` entities); plain reading/triage writes nothing to Supabase; refs are workspace-visible, accounts owner-visible only.
- **AC15 — Web read-only**: `/email` on web lists Snoozed / Follow-ups due / Recently linked cards with linked entities and "Continue on desktop"; email chips in hubs and notifications deep-link correctly on both platforms.
- **AC16 — Notification posture**: new mail never notifies (badges only); snooze-due and follow-up-due produce quiet grouped notifications riding `module_activity`.
- **AC17 — MCP**: the email manifest registers on its own `email` permission lane (api-key branch from day one); connector tools cover metadata reads (refs list/get/search) + writes (convert_to_task/snooze/link/tag); no body read, no send. A keyed write round-trips.
- **AC18 — Widget**: "Inbox & follow-ups" shows unread-per-account (desktop-pushed counts), snoozed-due-today, follow-ups awaiting reply; rows deep-link via `moduo:entity:open`; wired into all four widget-registry spots.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `src-tauri` `secrets.rs` unit · keychain migration | AC1 | A legacy cleartext redb secret is read once, moved into the keychain, and wiped from redb. |
| `src-tauri` `smtp.rs` unit · transport + builder | AC10 | Port 465→TLS, 587→STARTTLS (never plaintext); built messages carry correct In-Reply-To/References/multipart/attachment shape. |
| `src-tauri` `oauth.rs`/`connection.rs` unit · XOAUTH2 | AC2 | The SASL string is correctly formed and the refresh decision (expired vs cached vs invalid_grant→reauth) is right. |
| `src-tauri` `parsing.rs` unit · threading v2 | AC3 | An A←B←C chain yields ONE thread id (the current code's split-chain bug is pinned fixed); trimmed-References merge works. |
| `src-tauri` `ops.rs` unit · plan_op matrix | AC5, AC6 | For each provider × op (archive/move/delete/snooze), the planned IMAP steps are exactly right (Gmail expunge-from-label, generic copy+expunge, delimiter-aware snooze path). |
| `src-tauri` `ops.rs` unit · snooze due/restore | AC6 | Due selection picks the right records; local-strategy restore just unhides. |
| `src-tauri` `search.rs` unit · query escaping | AC12 | Server-search queries escape/fold correctly; unsupported content maps to the honest state. |
| `src-tauri/tests/imap_live.rs` (`#[ignore]`, creds file) · live round-trips | AC1, AC5, AC6, AC10, AC12 | Against the disposable mailbox: connect, archive→gone, move→present, snooze folder create→restore, APPEND-to-Sent, server search. |
| `src/features/email/classify.test.ts` · smart-inbox rules | AC13 | List-Unsubscribe→Newsletters, bulk/no-reply→Notifications, known contact→Personal, override wins, unknown defaults sane. |
| `src/features/email/refs.test.ts` · tissue-ref shaping | AC14 | Only tissue actions produce ref payloads; snippet/subject truncation; snooze/follow-up state transitions. |
| `src/features/email/convert.test.ts` · convert args | AC8 | Task title/description prefill, spawned-from + references link args, undo plan (task+links+ref), contact-resolution by any address. |
| `src/features/email/followup.test.ts` · reply-clears | AC7 | A counterpart reply clears the follow-up; a self-reply doesn't; due selection correct. |
| `src/features/email/threads.test.ts` · inbox shaping | AC3 | Rows group per thread across accounts/folders, sort newest-first, unread/pin rollups correct. |
| `src/features/email/search.test.ts` · result merge | AC12 | Local+server results merge, dedupe by Message-ID, per-account attribution kept. |
| `src/features/email/undo-send.test.ts` · hold timer | AC11 | Send fires only after the window; cancel restores the draft; quit-inside-window sends nothing. |
| `src/features/email/ops-manifest.test.ts` · manifest | AC17 | Manifest registers on the `email` lane with the declared ops/resources (central conformance test picks it up). |
| `src/features/email/widget.test.ts` · widget shaper | AC18 | Unread counts, snoozed-due-today, awaiting-follow-up select correctly; empty states calm. |
| Storybook stories · inbox/reader/compose/connect states | AC3, AC4, AC9, AC10 | Every UI state (empty/loading/error/reauth/offline) renders tokens-only. |
| e2e/manual (`docs/testing/` checklist per block) · full flows | AC1–AC18 | The designer's pass: real accounts, real triage day, convert/snooze/follow-up round-trips, web tissue view, MCP keyed round-trip (MCP-1 fold-in). |

## Assumptions & technical decisions

1. **Engine reuse + found bugs**: build on the existing Rust engine (~3.4k LOC — IMAP sync, IDLE supervisor, body cache, flags outbox). Three defects fixed as part of the work, not around it: SMTP `builder_dangerous` (cleartext — EM-1), no OAuth token refresh anywhere (written new in EM-2; the calendar PKCE flow is extracted to a shared `oauth_flow.rs`), threading splits >2-message chains (References-root keying + merge pass, EM-4).
2. **Sync depth**: envelope window extended from 50/folder to a deliberate depth (~90 days or 1,000 UIDs per folder, whichever smaller; constants in one place). Bodies stay on-demand + prefetch, LRU 2,500/200MB per account. Local-search completeness statements follow this window.
3. **Secrets**: OS keychain only (`keyring` v3, CAL-8 pattern), `StoredMailSecret` enum (password | oauth tokens), lazy migration from redb on first read (keychain may be locked at startup — a sweep would drop secrets).
4. **Auth**: Gmail personal = app password AND OAuth XOAUTH2 (verified 2026: personal @gmail.com accepts app passwords w/ 2SV; **Workspace does not** — OAuth mandatory there since 2025-03; the designer's accounts are personal). OAuth app = external, testing mode at first (7-day refresh expiry → first-class `reauth_required` path). Outlook deferred: OAuth-only provider, no designer account. Scope `https://mail.google.com/` (the only scope Gmail IMAP/SMTP accepts).
5. **Ops**: optimistic-local + queued-remote via a generalized op outbox (flags-outbox pattern); pure `plan_op` planner → thin executor (unit-testable without a fake IMAP server — a convincing fake was evaluated and rejected as high-cost/low-yield; live `#[ignore]` tests against the disposable mailbox instead). Gmail archive = `\Deleted`+expunge from the label (no COPY); generic = copy-to-Archive+expunge. UIDPLUS used when advertised.
6. **Snooze**: server-side `Moduo/Snoozed` folder (hierarchy delimiter from LIST, never hardcoded), create-if-missing, per-account local-hide fallback on refusal. Restore = Rust 60s interval task (the only long-lived context without a relay); restore locates by Message-ID search (no COPYUID in imap 2.4.1). The restore/due event writes the activity row (targets the owner) → notification; the widget derives due state at read from `email_refs` — **no pg_cron dependency**.
7. **Attachments**: full-message fetch through mailparse (BODYSTRUCTURE section-walking rejected: 3× code for marginal desktop bandwidth savings); metadata cached, **bytes never in redb**; save streams to disk; small inline `cid:` parts (<2MB) returned as data for the HTML view; send-side via lettre multipart from file paths.
8. **Send**: one Rust send path (`email_send_message` with full `MailSendSpec`); JS owns the 10s undo timer (a Rust persistent queue would only matter in the quit-race, where not-sending is preferable); copy-to-Sent via APPEND except Gmail (auto-saves; APPEND would duplicate); Message-ID generated client-side for Sent-matching + follow-ups.
9. **Search**: local = envelope scan + an 8KB-truncated lowercase body-text sidecar redb table (co-pruned with the body LRU; worst-case ~20MB bounded scan — an inverted index is unwarranted at this corpus cap). Server = `X-GM-RAW` in All Mail for Gmail; `UID SEARCH CHARSET UTF-8 TEXT` → ASCII fallback → honest `unsupported` elsewhere; 30s-capped timeout; hits upsert into the store so bodies work.
10. **Supabase schema (one migration)**: `email_accounts` (registry: workspace, owner, provider, address, status, signature_html, unread_count, last_sync_at — **owner-scoped RLS**; no secrets ever) + `email_refs` (tissue refs: account, message_key, thread_key, from_addr/name, subject, snippet, sent_at, is_snoozed/snooze_until, follow_up_at, workspace-readable RLS) + `email_module_permission` **with the api-key branch from day one** (`scopes->>'email'`; the CAL-7 gotcha) + `permissions_email` on members + intent ops (`email_op_account_upsert/_remove`, `email_op_ref_upsert`, `email_op_convert_to_task`, `email_op_snooze/_unsnooze`, `email_op_follow_up/_clear_follow_up`, `email_op_link`) — each guard→write→`entities_op_upsert`→activity in one txn. Entity type **`email_thread`** (registry label = subject); existing relation kinds reused (`spawned-from`, `references`, `attachment`) — **no enum migration**; `tag_links.entity_type='email_thread'` rides the open string (FX-2 pattern). `entity-open.ts` routes `email`/`email_thread` → `/email` with thread selection.
11. **Convert→task** is ONE intent op (`email_op_convert_to_task`): ref upsert + entity + task create + both links + activity, atomic; sender→contact resolution = lookup across contacts' addresses (no hard FK; Q-E3 honored — never auto-create).
12. **Smart inbox**: pure TS classifier over headers (Rust envelope fetch extends HEADER.FIELDS with LIST-UNSUBSCRIBE / PRECEDENCE / AUTO-SUBMITTED) + known-contact signal + per-sender overrides; overrides + templates sync via the user-preferences pattern (user-scoped, not workspace); signatures live on `email_accounts`.
13. **Compose editor**: Lexical (in-repo) with a bounded toolbar → HTML + derived plain text; no md doors here (email is HTML-native).
14. **UI**: full rebuild of `src/features/email/ui/` on `FeaturePanelsShell` (existing UI predates the design system); right-panel switcher (lifted component) with **Detail** (EntityHub for the thread) / **Contact** (sender context) / transient **Task** (post-convert) variants; tokens-only, shadcn, DESIGN_RULES R1–R10.
15. **Unread badge/widget counts**: new `email_get_unread_counts` (IMAP STATUS, true server counts); desktop pushes per-account counts to `email_accounts.unread_count` on sync ticks; web reads them (stale-tolerant, labeled with sync age).
16. **Live verification**: hosted test account for cloud surfaces; **designer-provided disposable IMAP mailbox** for engine round-trips (creds in a gitignored env file, `MODUO_TEST_IMAP_CREDS_PATH`); Gmail OAuth path is a manual smoke (headless-incompatible).
17. **redb exception**: bodies/folders/flags/queues stay in redb per data-layers §6 — sanctioned; nothing new becomes load-bearing on redb beyond the mail cache itself.

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| 1 | **EM-1 — Engine security core** | Keychain secret store + lazy migration off redb-cleartext; SMTP transport fix (TLS/STARTTLS); `build_message` (reply headers, cc/bcc, HTML+plain multipart, Sent-APPEND w/ Gmail skip); `email_send_message` command; live-test harness (`imap_live.rs` + creds file convention) | AC1(secrets), AC10(transport) | — |
| 2 | **EM-2 — Gmail OAuth + connect UX** | `oauth_flow.rs` extraction (calendar re-imports); XOAUTH2 IMAP+SMTP; token refresh + `reauth_required` surfacing; connect dialog rebuild (presets, app-password hints, OAuth button w/ honest caveat); iCloud preset; Settings account rows | AC1, AC2 | EM-1 |
| 3 | **EM-3 — Cloud substrate (no UI)** | Migration: `email_accounts` + `email_refs` + `email` permission lane (api-key branch) + intent ops + entities registration; runtime `email` namespace (web+tauri); `entity-open` email routing; deploy-gap degrade | AC14(schema), AC17(lane) | — (∥ EM-1/2) |
| 4 | **EM-4 — Threading + inbox shell** | References-root threading + merge pass + `email_get_thread` + sync-depth extension (Rust); 3-pane rebuild on `FeaturePanelsShell`: unified conversation inbox, account rail w/ folders+counts, reader stack, nav entry + unread badge, all UI states | AC3, AC4(read) | EM-1 |
| 5 | **EM-5 — Triage** | `email_list_folders` + archive/move/delete ops + op outbox (Rust); Done/pin/move/delete UI, `j/k/e/p/m/#`, undo toasts, offline queueing surfaced | AC5 | EM-4 |
| 6 | **EM-6 — Snooze + follow-ups** | Snooze ops + `Moduo/Snoozed` + restore scheduler + local-hide fallback (Rust); snooze/follow-up UI + rail sections; `email_refs` state writes; due notifications; reply-clears logic | AC6, AC7, AC16 | EM-3, EM-5 |
| 7 | **EM-7 — Compose + attachments** | Attachment metadata/save/inline + send-side multipart (Rust); compose surface: reply/reply-all/forward, cc/bcc, Lexical body, signatures, templates, attach, undo-send timer | AC10, AC11, AC4(attachments) | EM-1, EM-4 |
| 8 | **EM-8 — The great moment + spine** | `email_op_convert_to_task` (atomic) + `t`/drag gestures + right-panel Task variant; contact resolution + Contact panel + add-as-contact; drag-email-anywhere (CT-3); tags on threads; EntityHub Detail variant; @contact recipient autocomplete | AC8, AC9, AC14 | EM-3, EM-4 |
| 9 | **EM-9 — Search** | Local search + sidecar table (Rust) + server escalation command; search UI w/ instant results + per-account escalation + honest states | AC12 | EM-4 |
| 10 | **EM-10 — Smart inbox** | HEADER.FIELDS extension (Rust); pure classifier + sections UI + per-sender overrides (cloud-synced) | AC13 | EM-4 |
| 11 | **EM-11 — DoD** | MCP manifest + connector module (metadata reads, convert/snooze/link/tag writes); "Inbox & follow-ups" widget (all 4 registry spots); web read-only tissue surface; unread-count push; testing checklist | AC15, AC17, AC18 | EM-3, EM-6 |

Parallel lanes: EM-3 ∥ EM-1→EM-2. After EM-4 merges: EM-5, EM-7, EM-9, EM-10 are dep-independent (EM-7/9/10 parallel-safe; the usual `runtime.*`/migration serialization points apply — EM-3 owns the migration alone). Cut order if overrunning: OAuth button (EM-2 ships app-password-only) → templates (EM-7 slims) → server escalation (EM-9 local-only) → smart inbox (EM-10 last).

## Out of scope

- **Cloud mail relay / full web client** — post-alpha decision; web is the read-only tissue view. (Locked; the relay is "the most expensive thing we could build".)
- **Scheduled send** — cut entirely (designer: no caveat-shipping); returns on demand, likely with the relay decision.
- **Outlook / Microsoft 365** — post-v1 (OAuth-only provider; registration pass shared with the future verification round). Schema/provider enums leave room.
- **Send-as aliases** (+ per-alias signatures) — fast-follow; schema shouldn't preclude.
- **Folder create/rename/delete** — webmail's job at v1 (move-to only).
- **Server-side rules/filters, mail-merge, sequences, shared inboxes, built-in AI triage** — brief non-goals stand; AI is MCP-only.
- **MCP body read / send** — metadata + intent ops only at v1 (Q-E6).
- **Universal Inbox screen** — still a deferred spine feature; the widget + notifications cover the v1 need.
- **Finance hooks** (receipt_for, invoice context) — return with Finance post-alpha.

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** filled and unambiguous (designer interview 2026-07-04, ~35 ratified decisions).
- [x] **Every AC has at least one test** with a plain-English note.
- [x] **Open questions is empty** — provider/auth reality researched (incl. the 2025 Google basic-auth turndown split), engine defects identified with fixes planned, all product calls ratified.
- [x] **Data model named and Supabase-first** for the cloud half (`email_accounts`, `email_refs`, ops, one migration — EM-3); the redb desktop cache is the **recorded deliberate exception** (data-layers §6).
- [x] **Spine wiring enumerated** (links kinds reused / tags / drag / @contact / notifications / activity / entity-open), **MCP tools listed**, **widget defined** — per the module contract.
- [x] **Execution blocks** decomposed (EM-1…EM-11), sequenced, context-sized, each self-contained.
- [x] **Design constraints acknowledged** — tokens-only rebuild, shadcn primitives, DESIGN_RULES; the old email UI is replaced, not patched.
- [x] **Manual-test surfaces identified** — per-block `docs/testing/` checklists; engine round-trips on the disposable mailbox; Gmail OAuth manual smoke; MCP keyed write folded into MCP-1.

**Ready to execute.**

## Open questions

- [ ] (none)
