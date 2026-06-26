# Manual test checklist — CT-4 @mention / /ref resolver + EntityRefChip

> Generated 2026-06-26 · branch `claude/admiring-curran-c0a851` · **Live-verified:** partial — pure logic is unit-proven and the gates are green; the interactive @mention/`/ref` UX is **not yet mountable** (no Supabase-backed rich-text surface exists at alpha — see Known gaps), so its live checks are deferred to CT-5/CT-7.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Gates (runnable now)
- [ ] **Do:** `bun run verify` → **Expect:** typecheck + lint:tw + lint:css + tests all pass (166 tests, 15 new). _(both)_
- [ ] **Do:** `bunx vitest run src/features/spine/mention.test.ts src/features/spine/editor/entity-ref-node.test.ts` → **Expect:** 15 passing — resolver branches (`@`→mentions, `/ref`→references, person→route, no-match→create) + the node serialize round-trip. _(both)_

## Resolver / persist logic (proven by unit tests; re-confirm if you touch it)
- [ ] **Do:** `@`-mention an entity (in the resolver) → **Expect:** writes `entity_link` `relation_kind=mentions`, `origin=mention`, source = the edited entity, target = the picked entity, seeding the registry label/icon. _(both)_
- [ ] **Do:** `/task` / `/note` / `/contact` pick an entity → **Expect:** writes `relation_kind=references`, `origin=ref`, scoped to that entity type. _(both)_
- [ ] **Do:** `@`-mention a workspace member → **Expect:** routes to `onMentionPerson` (no link row written by CT-4); the activity-row/notification write lands with CT-5. _(both)_
- [ ] **Do:** `/task Foo` with no match → **Expect:** offers "Create task 'Foo'", and `persistMention` creates the entity via the supplied `createEntity` then links it; with no creator it rejects rather than writing a dangling link. _(both)_

## EntityRefChip (visual — once Storybook renders)
- [ ] **Do:** open Storybook stories `Spine/EntityRefChip` (Task / Contact / Note / Removable / Tombstoned / InProse) → **Expect:** neutral monochrome chip, **type glyph distinguishes the type (no hue)**, label truncates; tombstoned reads "Deleted <type>" dimmed + struck; InProse sits on the text baseline among words. _(web)_
- [ ] **Do:** capture visual baselines → **Expect:** `bun run storybook` then `bunx playwright test --project=visual --update-snapshots` (deliberate human capture — a visual diff is stop-and-ask, never auto-accepted). _(web)_

## MentionPicker + plugin (deferred — testable once mounted in a live surface)
- [ ] **Do:** in a registry-resident editor, type `@` → **Expect:** picker opens at the caret, lists registry entities + workspace members; typing filters via `searchEntities` (tombstones excluded). _(both)_
- [ ] **Do:** type `/task` → **Expect:** picker scopes to tasks and offers "Create task '…'" on no match. _(both)_
- [ ] **Do:** pick an item → **Expect:** trigger token is removed, a neutral chip is inserted inline, the link persists; the chip survives reload (serialized node). _(both)_
- [ ] **Do:** press Escape / click away with the picker open → **Expect:** picker closes, editor refocuses, typed text is preserved. _(both)_

## Edge cases
- [ ] **Do:** pick "Create …" on a display-only surface (no link source) → **Expect:** typed token is left untouched (no silent text deletion), no chip inserted. _(both)_
- [ ] **Do:** link write fails / permission-denied → **Expect:** quiet danger toast, no chip inserted (never an unlinked chip). _(both)_
- [ ] **Do:** chip whose target was later deleted → **Expect:** renders dimmed "Deleted <type>" (same dimming the hub uses). _(both)_

## Migrations / data
- [ ] None. CT-4 adds no migration; it reuses the CT-1 `entity_links` / `entities` ops and the existing `searchEntities` read.

## Known gaps / not-yet-testable
- **No live mount.** The only Lexical editor (Notes) is Yjs/redb and its notes are **not** registry entities, so it can't be a valid `entity_links` source. The `EntityMentionPlugin` ships ready-but-unmounted; it wires into its first valid `focus` source (comments CT-5 / a task description CT-7). Until then the interactive picker/plugin/chip-insert flow can't be exercised end-to-end.
- **Person → activity row.** CT-4 only *routes* `@member` via `onMentionPerson`; the actual person-targeted activity-row/notification write is CT-5. AC8's notification half is unsatisfied until CT-5 wires the handler.
- **Storybook renders nothing in this worktree** (`Failed to fetch dynamically imported module: /.storybook/preview.tsx`), so the chip stories compile but can't be rendered/screenshotted here; visual baselines remain a deliberate human capture.
- **Supabase round-trip unavailable here** — the MCP is connected to the wrong org, so the actual link writes can't be exercised against the Moduo DB from this environment (the resolver/persist arg shapes are unit-asserted against `runtime.types.ts`).

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
