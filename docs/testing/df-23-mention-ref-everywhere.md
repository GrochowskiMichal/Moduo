# Manual test checklist — DF-23 @mention + /ref beyond Notes

> Generated 2026-07-11 · branch `t/maciej/df-23-mention-ref-everywhere` · **Live-verified:** partial — task description + calendar event notes fully verified end-to-end on the hosted account (web); email compose is desktop-only and could not be sent on hosted web (editor/plugins unit-covered).

Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Task description — the gesture
- [ ] **Do:** Open a task's detail panel (right rail). Look at the description field. → **Expect:** A rich-text editor (not a grey textarea) with placeholder **"Add a description…  @ or / to link"**. _(both)_
- [ ] **Do:** Click into the description, type `@`. → **Expect:** A menu opens listing real workspace entities (contacts, companies, notes, events, tasks) as you keep typing to filter. _(both)_
- [ ] **Do:** Type `@` then a name (e.g. `@Acme`), pick a result (↑/↓ + Enter, or click). → **Expect:** The `@Acme` text is replaced by an inline **chip** (type glyph + name), and a trailing space; the menu closes. _(both)_
- [ ] **Do:** Type `/` instead of `@` and pick an entity. → **Expect:** Same chip inserts (this is the `/ref` gesture — a "references" link rather than a "mentions" one). _(both)_
- [ ] **Do:** Click the inserted chip. → **Expect:** The app navigates to that entity (a contact/company opens Contacts, a task opens Tasks, a note opens Notes, an event opens Calendar). _(both)_
- [ ] **Do:** After inserting a chip, click elsewhere (blur), then re-select the task later. → **Expect:** The chip is still there in the description and is still clickable (it persisted). _(both)_
- [ ] **Do:** Open the task's **Focus/Execute** view (the big single-task card). → **Expect:** A description with a chip renders the chip inline (clickable), plain descriptions render as before. _(both)_

## Calendar event notes — the gesture
- [ ] **Do:** Open a **native Moduo** event's detail (create one if needed — external/synced events stay read-only). Look at the Notes field. → **Expect:** A rich editor with placeholder **"Notes…  @ or / to link"**. _(both)_
- [ ] **Do:** Type `@` (or `/`) in the notes and pick an entity. → **Expect:** An inline chip inserts; clicking it deep-links to that entity. _(both)_
- [ ] **Do:** After adding a mention, look at the event's **Linked** section (and the mentioned entity's own linked list). → **Expect:** The event ↔ entity link now shows in both places. _(both)_
- [ ] **Do:** Open an **external** (Google/ICS-synced) event's notes. → **Expect:** Notes render read-only as plain text exactly as before (no editor, no mangling of any `<` characters). _(both)_

## Email compose — the gesture (desktop)
- [ ] **Do:** On desktop, open Compose (new / reply). In the message body type `@` (or `/`) and pick an entity. → **Expect:** An inline chip inserts and deep-links while composing. _(desktop)_
- [ ] **Do:** Send the message, then look at the sent copy / the recipient's view. → **Expect:** The chip appears as plain text (the entity's name) — **no** Moduo internal ids leak into the sent HTML. _(desktop)_

## Edge cases
- [ ] **Do:** Type an email address in a description/notes/body (e.g. `mail me at sam@acme.com`). → **Expect:** The `@` in the address does **not** open the mention menu (only a `@` at the start or after a space triggers it). _(both)_
- [ ] **Do:** Type a date or fraction like `7/11` or a URL `https://x.co`. → **Expect:** The `/` does **not** open the ref menu mid-word. _(both)_
- [ ] **Do:** In a description, type `@` then a nonsense string that matches nothing. → **Expect:** The menu shows "No matches." and inserting nothing leaves your text intact. _(both)_
- [ ] **Do:** Open a task/event that already had a plain-text description containing a literal `<` (e.g. "compare x < y"). → **Expect:** It renders verbatim (the `<` shows literally, is not swallowed as markup). _(both)_
- [ ] **Do:** Focus a description that has existing content, then click away **without editing**. → **Expect:** No "updated just now" bump / no new activity row appears (a no-op blur must not write). _(both)_
- [ ] **Do:** Clear a description entirely and blur. → **Expect:** It saves as empty and the placeholder returns. _(both)_

## Migrations / data
- [ ] **Do:** (No DB migration this block.) Confirm a task/event edited to add a mention still loads fine on a second device / after reload. → **Expect:** Rich description round-trips; the `entity_link` row exists (visible via the entity's linked list). _(both)_

## Known gaps / not-yet-testable
- **Email compose end-to-end send** was not live-verified — email send is desktop/Tauri-only and the hosted web account can't send. The compose editor, mention/ref plugins, `EntityRefNode`, and the id-strip-on-send helper are covered by unit tests and share the exact components proven live on the task/calendar surfaces.
- **People `@`-mentions** are intentionally out of scope on these surfaces — `@`/`​/ref` resolve to **entities** only (contacts/companies/notes/events/tasks). Person-mentions-with-notifications need a per-surface op seam (a later notifications block).
- **Create-and-link from `/ref`** (typing `/newthing` to create a contact/company inline) is a Notes-only richness; the generic `/ref` here links existing entities only.
- Two `entity_link`s created during live-verify on the test task "Verify cloud consolidation end-to-end" could not be removed (entity_links deletes are RPC-gated by RLS); its description was restored to empty. Harmless test-workspace noise.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
