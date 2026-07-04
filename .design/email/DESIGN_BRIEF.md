# Email — Design Brief (build spec)

> **Status:** DoR-ready 2026-07-04 (planning interview with Maciej; execution contract in [specs/email.md](../../specs/email.md)).
> **Pairs with:** [BRIEF.md](./BRIEF.md) (product intent — still authoritative for JTBD/ceiling/spine wiring) · [docs/data-layers.md §6](../../docs/data-layers.md) (desktop-first hybrid) · siblings: `.design/calendar/DESIGN_BRIEF.md` (rail/attribution patterns), `.design/notes/DESIGN_BRIEF.md` (right-panel + task-line patterns this module reuses).

## 1. Deltas that supersede BRIEF.md (designer-ratified 2026-07-04)

1. **Sequence**: Email is the next build (ahead of Dashboard/Mindmap reworks) — no longer post-alpha. Finance stays post-alpha.
2. **Lazy tissue refs replace the full metadata mirror.** `email_refs` rows exist ONLY for emails deliberately pulled into the tissue (converted / linked / snoozed / followed-up / tagged). The whole-inbox mirror (BRIEF §7, designed for Universal Inbox + Finance receipt-match — both deferred) is dropped: privacy in the shared workspace beats it.
3. **Finance hooks dropped** (unpaid-invoice context, `receipt_for`) — return with Finance.
4. **Scheduled send CUT entirely** (no relay, no caveat-shipping). Undo send (10s local hold) stays.
5. **Outlook deferred post-v1** (OAuth-only provider; not in the designer's accounts). v1 providers: custom IMAP · Gmail personal (app password + OAuth button) · iCloud (app password).
6. **Snooze strategy**: server-side `Moduo/Snoozed` folder move (delimiter-aware, create-if-missing) with per-account local-hide fallback — not local-only hiding.
7. **"Done" is the triage centerpiece** (Spark's model, the designer's words: "can't imagine using email any other way") — archive gesture, `e`, inbox-zero-first design.
8. **Universal Inbox stays deferred**; the dashboard widget + notifications carry the v1 need.

## 2. The triage model (the module's soul)

**Inbox zero via Done.** The inbox is a work queue, not an archive. Every row supports, keyboard-first:

| Key | Action | Semantics |
| --- | --- | --- |
| `j` / `k` | move selection | list navigation, wraps sections |
| `Enter` | open | reader focus; `Esc` back |
| `e` | **Done** | archive — Gmail: leaves INBOX label (stays in All Mail); others: move to Archive folder |
| `p` | pin / star | `\Flagged`; pinned float within their section |
| `s` | snooze | picker: presets (Later today · Tomorrow · Next week · Weekend) + custom datetime |
| `t` | **convert → task** | the great moment (§4) |
| `m` | move to folder | popover listing ALL server folders (LIST-derived, delimiter-aware) |
| `#` | delete | provider Trash |
| `/` | search | §6 |

Every action is optimistic with an 8s undo toast; failures queue in the engine op outbox and retry with honest per-account error surfacing (never a blank module, never a retry storm).

## 3. Layout — 3-pane on `FeaturePanelsShell`

**Left rail (accounts + destinations):**
- **Unified** row (default) with total unread; per-account rows below with hue dot (CAL-6 attribution pattern), unread count, status glyph (`reauth_required` → Reconnect chip, error → quiet warning).
- Sections under the account list: **Snoozed** (count) · **Follow-ups** (count) · folder tree per account (collapsed by default; standard five + all server folders on expand).
- Bottom: Connect account.

**Center (list):** conversation rows — sender(s), subject, snippet, time, account hue dot, unread weight, pin glyph, attachment glyph, thread count chip. Smart-inbox section headers (**Personal / Notifications / Newsletters**, §5) with quiet counts; Pinned float to the top of their section. Multi-select with `x` + bulk Done/move/snooze.

**Right (reader):** conversation stack, newest expanded, older collapsed to sender+snippet rows (click expands). Message chrome: sender chip (→ §4 contact context), recipients line (expandable), time, per-message actions (reply/reply-all/forward/star). HTML bodies render in the sandboxed iframe (remote images **load by default**; a later global privacy setting may flip this). Attachments strip: chips with type icon, name, size → click saves via OS dialog; inline `cid:` images render in place.

**Right panel (the app-wide switcher, lifted component):** variants —
- **Detail** — spine `EntityHub` for the thread (links/tags/suggestions/activity) once the thread is in the tissue; pre-tissue it shows the quiet "Link to…" affordances.
- **Contact** — sender context: name/company/status, last touch, open tasks, linked items, tags; "Add as contact" for unknown senders (one click, prefilled from the From header; **never auto-created**).
- **Task** (transient) — the Tasks `TaskDetailPanel` mounts right after a convert (notes NO-5 pattern) so scheduling happens in place.

**Nav:** main sidebar item **"Email"**, unread badge, ⌘-number, palette entries (Open Email · New message · Connect email account). Web: the same nav item opens the read-only tissue view (§7).

## 4. The great moment — convert → task

`t` on a row/reader, or drag the row onto the Tasks nav/drop target (CT-3 payload):

1. Task created instantly — title = subject (cleaned of Re:/Fwd:), description = snippet + a `moduo://` back-link line; lands in the Inbox bucket.
2. Links written atomically with the ref: task **spawned-from** `email_thread`; `email_thread` **references** the sender's contact when resolvable (lookup across all contact addresses).
3. The email **stays** in the inbox. Toast: "Task created · Undo · Also mark done" — Undo removes task+links+ref; "Also mark done" chains the archive.
4. The right panel flips to the **Task** variant — schedule/annotate without leaving the inbox.

Sender resolution is silent; when it fails, the task still links the thread and the Contact panel offers "Add as contact" (linking then happens on add).

## 5. Smart inbox (rule-based, no ML)

Deterministic classifier, explainable, never blocking render:

- **Newsletters** — `List-Unsubscribe` present, bulk precedence.
- **Notifications** — `Precedence: bulk/auto`, `Auto-Submitted`, no-reply sender patterns.
- **Personal** — sender resolves to a contact or a prior correspondent (you've replied to them); default for the unmatched-but-human.
- **Override** — row/reader menu: "Always put <sender> in <section>" — per-sender, cloud-synced (user-scoped), wins over rules, teaches the inbox.

Sections are visual grouping only — j/k walks through them; Done/snooze/etc. work identically everywhere. If classification quality disappoints during dogfood, a tuning pass is sanctioned before any ML conversation.

## 6. Search

- **Local, instant**: as-you-type over synced envelopes (sender/subject/recipients/preview) + cached body text; results grouped by account, deduped by Message-ID.
- **Server escalation, explicit**: a footer row "Search entire mailbox on <account>" per account — Gmail via X-GM-RAW (full Gmail syntax), others via IMAP SEARCH with honest `searching… / timed out / not supported by this server` states. Escalation results merge in, marked with a server glyph.

## 7. Web (read-only tissue view)

`/email` on web renders what the cloud knows: **Snoozed** (with due times) · **Follow-ups due** · **Recently linked** email cards — each card: from/subject/snippet/date, its linked entities (chips), and "Continue on desktop". Email chips in hubs, notifications, and widgets render on both platforms and deep-link (`moduo:entity:open` → `/email` with thread selection on desktop; on web, the card view). No fake panes, no disabled compose buttons — the surface only shows what it can honestly do.

## 8. Connect & settings

Connect dialog (CAL-8b pattern): preset chips **Gmail · iCloud · Custom IMAP**, each with credential hints —
- **Gmail**: two side-by-side paths: "Sign in with Google" (OAuth; small print: *early-access app — Google asks you to re-approve every 7 days* until verification) and "Use an app password" (link to Google's app-password page; requires 2-Step Verification). Personal @gmail.com only at v1 (Workspace requires OAuth + admin steps — post-v1 with Outlook).
- **iCloud**: app-specific password hint (appleid.apple.com), IMAP preset baked in.
- **Custom IMAP**: host/port/TLS fields with sane defaults, validated by a real connect.

Settings → Email: account rows (status, Reconnect, Disconnect w/ keychain cleanup), per-account **signature** (rich-text editor), **templates** manager (personal), sync info. Secrets live in the OS keychain only.

## 9. States & edge behavior (summary — full list in the spec)

Empty = calm connect CTA / inbox-zero moment (not a sad-empty). Loading = skeleton rows. Per-account errors stay row-scoped. Offline = cached reads + queued ops with a quiet "will sync" note. Reauth = row chip + Settings badge, one-click re-flow. Deploy-gap = desktop mail fully functional, tissue actions degrade with an honest toast. Snoozed thread receiving a reply un-snoozes immediately. Self-replies never clear follow-ups.

## 10. Design-system notes

Tokens-only rebuild (the existing `src/features/email/ui/` predates the system — replaced, not patched). shadcn primitives throughout; row density follows the Tasks/Contacts list rung; account hues ride the bounded tag-color palette (`data-label` pattern, no raw hex); unread weight = type weight not color alone; icon-only actions carry Tooltips; all shortcuts overlay-guarded. Reader iframe is the one sanctioned non-token surface (foreign HTML), sandboxed.
