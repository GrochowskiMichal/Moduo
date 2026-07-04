# Manual test checklist — Notes NO-9 (Publish to web) + NO-10 (DoD: MCP + widget)

> Generated 2026-07-04 · branch `claude/hungry-euler-447bb8` · **Live-verified:** no — the NO-1 notes migration is still **unapplied to prod**, so every server-touching path below (publish ops, the public renderer, the notes MCP tools, the recent-notes read) is manual **post-deploy**. Pure logic + wiring are unit-tested (718 green) and validator-confirmed; rendering is deploy-gap-safe (degrades to empty/quiet).
>
> **Prereqs:** (1) apply migration `20260703120000_notes_module.sql` to the target project (it is deploy-GATED — apply only after the Wave-3 notes code is live); (2) **deploy two edge functions**: `notes-public` (deploy with `verify_jwt = false` — it's a public page) and a redeploy of `moduo-mcp` (picks up the new `notes` connector module); (3) a workspace API key with the `notes` scope set to `edit` for the MCP checks.

## Publish to web — the header control (NO-9, web)
- [ ] **Do:** Open a note in `/notes`, click **Publish** (Globe, top-right of the editor) → **Expect:** popover flips to "Live on the web" with a public URL, Copy, "Open public page", and Unpublish. _(web)_
- [ ] **Do:** Click **Copy** → **Expect:** "Copied" checkmark; the clipboard holds `…/functions/v1/notes-public?token=…`. _(web)_
- [ ] **Do:** With the note published, reload the page and reopen it → **Expect:** the button reads **Published** (secondary/filled, primary Globe); the note appears in the sidebar **Published** section. _(web)_
- [ ] **Do:** Publish a note that has child pages → **Expect:** the popover says "…and its N nested page(s)". _(web)_
- [ ] **Do:** Click **Unpublish** → **Expect:** button returns to **Publish** (ghost); the note leaves the Published section; the previously-copied link now 404s (see below). _(web)_
- [ ] **Do:** As a **view-only** member, open a note → **Expect:** the Publish control still shows state but the publish/unpublish actions are absent/disabled (no publish affordance for viewers). _(web)_

## Public page — the edge renderer (NO-9)
- [ ] **Do:** Open the copied public URL in a fresh browser / incognito (no login) → **Expect:** a clean read-only page: the note title + its markdown body, a left nav listing the subtree, no app chrome, footer "Published with Moduo". _(web, public)_
- [ ] **Do:** View source / check headers → **Expect:** `<meta name="robots" content="noindex, nofollow">` and an `x-robots-tag: noindex` response header. _(web)_
- [ ] **Do:** In the public nav, click a child page → **Expect:** it loads under `?token=…&note=<childId>`; only pages inside the published subtree are listed/reachable. _(web)_
- [ ] **Do:** Trash (or archive) a **child** of the published root, then reload the public page → **Expect:** that child disappears from the public nav/subtree immediately. _(web)_
- [ ] **Do:** Unpublish the note, then reload the public URL → **Expect:** **404** "This link is no longer available." (revocation is instant — the token is cleared). _(web)_
- [ ] **Do:** Publish a note, then **Archive** it (or archive its parent) → **Expect:** an info toast "Archived — the public link was turned off"; the note leaves the Published section; reloading its public URL 404s (archive revokes the token across the whole archived subtree). _(web)_
- [ ] **Do:** Unarchive that note → **Expect:** it does NOT come back online — the Publish button reads "Publish" again (re-publishing is explicit). _(web)_
- [ ] **Do:** Manually change the URL's `?note=<id>` to a note id NOT in the published subtree → **Expect:** 404 (no unpublished sibling body leaks). _(web)_

## MCP connector — notes tools (NO-10, post-redeploy)
- [ ] **Do:** With a `notes:view` key, call `notes_list` and `notes_get` (a note id) → **Expect:** the tree (id/title/parent/icon/published) and the note's `markdown` (`body_md`). _(MCP)_
- [ ] **Do:** `notes_search` with a query that matches a note's body → **Expect:** matching rows with a snippet. _(MCP)_
- [ ] **Do:** With a `notes:edit` key, `notes_create` `{ title, markdown, parent_id? }` → **Expect:** a new note (returns its id); it appears in `notes_list`/search and in the app tree; open it in the app editor → the markdown materializes on first open. _(MCP → web)_
- [ ] **Do:** `notes_append` / `notes_update` on that note (before opening it in the editor) → **Expect:** `notes_get` reflects the new body. _(MCP)_ · **Known gap:** if the note was **already opened** in the editor (non-empty CRDT), the editor won't show the connector body change until re-materialized — read/search/publish still reflect it.
- [ ] **Do:** `notes_create` with a bogus `parent_id` → **Expect:** a clear "Parent note not found in this workspace" error (not a silently-orphaned note). _(MCP)_
- [ ] **Do:** `notes_link` a note to a task/contact, then `notes_move`, `notes_archive`, `notes_trash` → **Expect:** each reflects in the app (link on the hub; reparent; archived/trashed). _(MCP → web)_
- [ ] **Do (the api-key gotcha):** confirm every `notes:edit` **write** above actually succeeds with a scoped key (not just reads) → **Expect:** no "no edit access" — `notes_module_permission` already carries the `module_api_key_id()` branch. _(MCP)_

## Dashboard — Recent-notes widget (NO-10, web)
- [ ] **Do:** On the dashboard, unlock the board and add the **"Recent Notes"** widget from the left panel → **Expect:** it lands on the grid. _(web)_
- [ ] **Do:** With notes in the workspace → **Expect:** rows show the most-recently-touched notes first, each with title + a one-line snippet + a relative "touched" label; a published note shows a small Globe. _(web)_
- [ ] **Do:** Click a widget row → **Expect:** it deep-links to that note (`/notes?id=…`, the note opens). _(web)_
- [ ] **Do:** In a fresh/empty workspace → **Expect:** the quiet empty state "No notes yet. Press ⌘⇧N to capture one." _(web)_

## Edge cases
- [ ] **Do:** Before the migration is applied, open `/notes` and the dashboard → **Expect:** no crash — the recent-notes widget shows empty (42703 degrade), the Publish control renders (publishing surfaces an honest error toast if attempted). _(web)_
- [ ] **Do:** Publish a note whose body contains literal `<script>alert(1)</script>` and a `[link](javascript:alert(1))` → **Expect:** on the public page the `<script>` renders as escaped text (no execution) and the link renders as a plain label (no `javascript:` href). _(web, security)_

## Migrations / data
- [ ] **Do:** Confirm `20260703120000_notes_module.sql` is applied (the `notes.published_at`/`publish_token` columns + `notes_op_publish`/`_unpublish` exist) → **Expect:** publish round-trip works. _(server)_
- [ ] **Do:** Confirm `notes-public` is deployed with `verify_jwt = false` and `moduo-mcp` is redeployed → **Expect:** the public page loads without an auth header; the notes MCP tools appear in `tools/list`. _(server)_

## Known gaps / not-yet-testable (this session, in-worktree)
- **All server round-trips are post-deploy** — the migration is unapplied here and the Supabase edge deploy is a separate step; nothing above was live-run.
- **Editor materialization of connector-written bodies for already-opened notes** — the documented cross-device gap (assumption 10); connector writes hit `body_md`, not the CRDT. Never-opened notes are clean.
- **Archive-unpublish** rides a second migration (`20260704120000_notes_archive_unpublishes.sql`) — apply it AFTER `20260703120000` or archiving a published note won't revoke the link (client still clears local state + toasts).
- **Live drag / two-tab / real markdown rendering fidelity** — not exercised; covered by unit tests + the validator's read.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up".*
