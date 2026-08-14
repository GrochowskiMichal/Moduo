# Manual test — Notes NO-6/7/8 (multiplayer · right panel · find & interchange)

> **✅ Migration status (reconciled 2026-08-14 · DOC-1): every migration this checklist depends on is APPLIED to prod.** OPS-1 + OPS-2 (2026-07-29) applied and verified every migration file in the repo against the live catalog. Any "unapplied" / "deploy-gated" / "**[post-deploy]**" wording below describes the state when this doc was written — **the 17 `[post-deploy]` rows are runnable now, not blocked**, and `/notes` is not in degraded/read-only mode. Status of record: [`specs/BUILD_ORDER.md`](../../specs/BUILD_ORDER.md).

Branch: `claude/compassionate-pasteur-d42b7d` · Wave 3 (Notes) blocks **NO-6, NO-7, NO-8**.

> **Deploy note.** The Notes migration (`20260703120000_notes_module.sql`, NO-1) is still **deploy-gated / unapplied on prod**. Until it lands, `/notes` runs in **degraded** mode (read-only banner) against the real project, and the flows below that need the migration (search, comments-on-notes, import, mentions) are verified either against the deployed migration or with stubbed RPCs. Rows marked **[post-deploy]** need the migration applied first.

Legend: web = browser · desktop = Tauri · both = either.

## NO-6 — Multiplayer: realtime + presence

- [ ] **Presence appears** — open the same note in two browser sessions (two accounts, or two profiles) in one workspace → each shows the other's initials avatar top-right of the editor. _(both)_
- [ ] **Presence clears on close** — in session B, navigate away from the note (or close the tab) → session A's facepile drops B within a couple seconds. _(both)_
- [ ] **Two tabs of one person = one avatar** — open the note in two tabs of the SAME account → the OTHER viewer sees a single avatar for you, not two. _(web)_
- [ ] **Overflow** — with 4+ other viewers, the facepile shows 3 avatars + a `+N` chip whose tooltip lists the hidden names. _(both)_
- [ ] **Near-live edits** — type in session A → the text appears in session B within a fraction of a second (no refocus needed). _(both)_ **[needs the deployed migration or the doc-push path reachable]**
- [ ] **Realtime-down degrades, not breaks** — with Realtime unreachable, editing still saves; the other session catches up on refocus (no error, no data loss). _(both)_
- [ ] **Offline dot** — kill the network mid-edit → the cloud-off dot shows; edits persist and sync on reconnect. _(both)_

## NO-7 — Right panel + spine payoffs

- [ ] **Switcher tabs** — open a note → the right panel shows **Detail · Comments · Outline**; clicking each swaps the body. _(both)_
- [ ] **Variant persists** — pick Outline, reload → Outline is still active (per user+workspace). _(both)_
- [ ] **Detail: tags** — add a tag on the Detail tab → it persists across reload and appears in the shared workspace tag pool. _(both)_ **[post-deploy]**
- [ ] **Detail: linked hub + activity** — link a task/contact to the note (`/task`, `@`, or a drag from another surface) → it appears grouped in the Detail hub; the activity trail lists recent touches. _(both)_ **[post-deploy]**
- [ ] **Detail: suggestions** — when the note shares a signal with another entity, the suggestion strip offers a link; Accept links it, Dismiss remembers the no. _(both)_ **[post-deploy]**
- [ ] **Comments: post + render** — Comments tab → type a comment → Comment → it appears in the thread. _(both)_ **[post-deploy]**
- [ ] **Comments: quote-comment** — select text in the note, click the Quote button in the composer → the selection attaches as a quote chip → post → the comment renders with the quote. _(both)_ **[post-deploy]**
- [ ] **Comments: quote scroll-find** — click a rendered quote → the editor scrolls to that text. Edit the text away, click again → a quiet "that text isn't in the note anymore" toast (no scroll), quote stays as a record. _(both)_ **[post-deploy]**
- [ ] **Comments: @mention notifies** — @-mention a teammate in a comment → they get a notification; a bystander whose name is a prefix (e.g. "Ann" vs mentioned "Anna") is NOT notified. _(both)_ **[post-deploy]**
- [ ] **Comments: view-only can comment** — as a view-only member, the editor is read-only but the Comments composer works. _(both)_ **[post-deploy]**
- [ ] **Outline** — add `#`/`##`/`###` headings → they list (indented by level) on the Outline tab; a click scrolls the editor to that heading. _(both)_
- [ ] **Task-detail variant** — click a task line's meta/details → a **Task** tab appears and activates (the Tasks detail panel); switching to another tab closes it; switching notes clears it. _(both)_ **[post-deploy]**
- [ ] **Calendar unaffected** — open `/calendar`, confirm its right-panel switcher (Tasks | Detail) still works (the switcher was lifted to the app shell). _(both)_

## NO-8 — Find & interchange

- [ ] **Search title + body** — type in the sidebar search box → matches on both titles and body text show, with a snippet line under body matches. _(both)_ **[post-deploy]**
- [ ] **Search flags/excludes** — an archived match is labelled "Archived"; a trashed note never appears. _(both)_ **[post-deploy]**
- [ ] **Search clear restores tree** — clear the box (X or empty) → the normal sidebar sections + drag reordering come back. _(both)_
- [ ] **Per-note .md export** — a note's ⋯ menu → Export as Markdown → downloads `<title>.md` with the note's markdown (open note = freshest). _(both)_ **[post-deploy for non-open notes]**
- [ ] **Subtree .zip export** — a parent note's ⋯ → Export subtree as .zip → downloads a zip where child notes nest under folders named for their parents. _(both)_ **[post-deploy]**
- [ ] **Import .md files** — Import button (sidebar header) → drop/choose `.md` files → preview lists them → Import → they appear in the tree; opening one shows its content. _(both)_ **[post-deploy]**
- [ ] **Import Notion .zip** — Import → a Notion-export `.zip` → preview shows the folder→parent nesting (hash suffixes stripped from titles) → Import → the tree is recreated. _(both)_ **[post-deploy]**
- [ ] **Import isolates junk** — a zip with an image / empty `.md` → the preview/toast reports N skipped; the rest import fine. _(both)_ **[post-deploy]**
- [ ] **Imported note renders** — right after import, click an imported note → its body appears in the editor (materialized on first open, same session). _(both)_ **[post-deploy]**

## Known gaps / not verified here

- **Migration unapplied on prod** — all **[post-deploy]** rows above need `20260703120000_notes_module.sql` applied first; until then `/notes` is read-only degraded. `bun run verify` is green (699 tests): typecheck + lint + all pure logic (realtime coalesce/presence, quote round-trip + scroll-find, outline extract, search shaping, import planner, zip entries) is unit-covered.
- **Realtime two-tab** — proven by design + unit tests; the live two-session merge/presence needs the deployed app + two sessions (this env can't drive two independent Realtime contexts).
- **Import cross-device materialization** — an imported note opened on a *different* device before it's ever materialized shows empty in the editor until a client materializes it (the content is in `body_md`, so it's searchable/exportable meanwhile). Same-session import→open renders. Documented limitation (assumption-10 fallback).
- **Comments starting with `>`** — a comment whose text legitimately begins with a `>` blockquote line renders as a quote chip (the no-schema quote convention). Cosmetic; the body text is preserved.
- **Deferred (NOT built this session, per the spec cut-order):** the "Notes" rail variant inside Contacts/Calendar, and drag-into-editor/drag-onto-row. Cursors (NO-6 stretch) also deferred.
