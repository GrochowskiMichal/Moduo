# Manual test checklist — CT-4 @mention / /ref resolver + EntityRefChip

> Generated 2026-06-27 · branch `claude/condescending-morse-84ad10` · **Live-verified:** no — Storybook render and a running app+Supabase are both unreachable in this worktree (see [gotchas.md](../gotchas.md)). The AC8 *logic* is proven by `src/features/spine/mention.test.ts` (9/9); everything below is the inline-behavior layer a human still needs to confirm.

Prereqs: sign in to the hosted test account (see memory `project-test-account-hosted`), open a **Note** (the only Lexical text surface today). The registry (`entities`) is populated by spine ops, so `@`/`/ref` will only find entities that already exist there — create a couple of links via CT-1/CT-3 first if the picker is empty.

## EntityRefChip (visual)
- [ ] **Do:** view a note containing a ref chip (insert one via `@`/`/ref` below) → **Expect:** a neutral, monochrome pill — type glyph (lucide) + label, `bg-muted`, NO color/hue per type → _(both)_
- [ ] **Do:** capture Storybook baselines for `Spine/EntityRefChip` (task/contact/note/linkable/removable/tombstoned) once Storybook render is fixed → **Expect:** `bun run e2e --update-snapshots` on the canonical env; diffs are stop-and-ask → _(web)_

## @mention (inline)
- [ ] **Do:** in a note body type `@` then a query → **Expect:** a popover menu opens at the caret listing matching **entities** (registry), keyboard-navigable (↑/↓), Esc closes → _(both)_
- [ ] **Do:** pick an entity → **Expect:** a neutral `EntityRefChip` appears inline + a trailing space; the entity's hub shows the note under the matching section (link `kind=mentions`, `origin=mention`) → _(both)_
- [ ] **Do:** open that entity's hub after a reload → **Expect:** the note link persists (server round-trip) → _(both)_
- [ ] **Do:** with no `onMentionPerson` seam wired (current state), type `@` → **Expect:** **people do NOT appear** as candidates (entities only) — `@person` is hidden until CT-5 wires the notification op → _(both)_

## /ref (slash) — `/task` `/note` `/contact`
- [ ] **Do:** type `/task` (or `/note`, `/contact`) → **Expect:** a "Refs" group appears in the slash menu alongside the existing commands → _(both)_
- [ ] **Do:** select it → **Expect:** an inline picker lists existing entities of that type (max 8); picking one inserts an `EntityRefChip` + writes a link `kind=references`, `origin=ref` → _(both)_
- [ ] **Do:** reload, open the linked entity's hub → **Expect:** the note appears (persisted reference link) → _(both)_

## Regression — existing notes slash menu (must be unchanged)
- [ ] **Do:** type `/` and use Paragraph / H1–H3 / lists / Quote / Code / Divider / Table / Embed Mindmap → **Expect:** every existing command works exactly as before (the CT-4 edits are additive) → _(both)_
- [ ] **Do:** open the table size picker and the embed-mindmap picker → **Expect:** unchanged behavior; Esc closes them; arrow/enter nav intact → _(both)_

## Edge cases
- [ ] **Do:** trigger a link write while offline / force the RPC to fail → **Expect:** an error toast "Couldn't link…" with **Retry**; the chip stays (link recoverable, never silently lost) → _(both)_
- [ ] **Do:** `@`/`/ref` with no matches → **Expect:** quiet "No matches." (no error tone) → _(both)_
- [ ] **Do:** click an inserted chip → **Expect:** a `moduo:entity:open` event fires (deep-link routing arrives with the hub consumer; today it's a no-op listener) → _(both)_
- [ ] **Do:** caret behavior around a chip (arrow/backspace) → **Expect:** caret skips over the chip (it's `contentEditable=false`), backspace removes it cleanly → _(both)_

## Migrations / data
- [ ] None. CT-4 adds no migration — it consumes CT-1's `entity_links` / `entities` ops + `links_op_create` and `workspace.listMembers` (all reads/writes already shipped).

## Known gaps / not-yet-testable
- **Person-mention notification** (`@person` → activity row → NotificationCenter): the resolver branch + `onMentionPerson` seam exist and are tested, but the activity-write op + the notes-editor wiring land with **CT-5**. Until then people are hidden in the `@` picker.
- **Create-and-link** (`/task Foo` no-match → "Create task 'Foo'"): the resolver branch + picker affordance + `onCreateEntity` seam exist and are tested, but concrete task creation (needs the full Tasks model) is wired with **CT-7** (Tasks adoption). The slash `/ref` picker currently lists existing entities only.
- **Live inline behavior** (menu positioning, keyboard nav, optimistic insert, Yjs/collab sync of the new node) is unverified in this worktree — confirm on a running desktop/web build with the hosted account.
- The `MentionPicker` (Popover+Command) component is built and tokens-clean but not yet mounted on a button surface (e.g. the CT-3 keyboard "Link to…" equivalent); that consumer lands with CT-3's deferred keyboard half / a hub action.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
