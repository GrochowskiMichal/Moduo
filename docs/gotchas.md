# Gotchas / footguns

Things that have bitten us, so they don't bite again. **Read before debugging; append when something costs you more than a few minutes.** Each entry: the trap, why it happens, what to do instead.

---

## Repo / build

- **Never import a bare `{ runtime }`.** Always resolve via `getRuntime()`. The bare export was an always-null const footgun; grep `./runtime` when auditing lib exports. → [data-layers.md](./data-layers.md)
- **redb is paused — never make it load-bearing** for a new feature. New models are Supabase-first; redb is kept only for the future offline/"lite" version and not-yet-migrated legacy modules. → [data-layers.md](./data-layers.md)
- **The local done-check is `bun run verify`** (typecheck + lint:tw + lint:css + unit tests) — it mirrors CI's gate. CI does **not** run the e2e / visual-snapshot / billing suites (those stay local/manual), so a green PR doesn't cover them.
- **Visual-snapshot PNG baselines are NOT generated in CI** and are platform-suffixed (`*-visual-darwin.png`). Capture is a deliberate human `bun run e2e --update-snapshots` run on the canonical env. A visual diff means **stop and ask**, never auto-accept/regenerate.
- **macOS Liquid Glass app icon has been lost in merges twice.** It lives in-repo at `scripts/icons/source/Moduo.icon`; regenerate with `bun run icon:liquid` (needs full Xcode for `actool`). Don't let a merge drop it.

## Supabase / migrations

- **A new migration is NOT applied by `bun run verify`.** `verify` only runs typecheck/lint/unit-tests; it never touches Postgres. A green PR with a new `supabase/migrations/*.sql` means the SQL *parsed in your head*, not that it deployed — server invariants (RLS, RPCs, FKs, generated columns) are unproven until the migration is applied to a Supabase instance and exercised by an authenticated round-trip (the manual-test layer). Apply the migration and regenerate `src/types/supabase.ts` before any code *depends* on the new tables/RPCs. Don't apply to the shared/prod project without authorization.
- **The Supabase JS client is untyped (`SupabaseClient`, no `Database` generic).** So `supabaseClient.from("a_table_that_doesnt_exist_yet")` and `.rpc("an_unmigrated_fn", …)` both **typecheck fine** — TS can't catch a table/RPC-name typo or an arg-shape mismatch against an unmigrated schema. New runtime methods for new tables pass `verify` even if the migration is wrong or unapplied; the only real check is the live round-trip. (Mappers take `r: any`, so column renames are silent too.)
- **Direction-agnostic link dedupe must use a collation that matches JS.** `entity_links.pair_key` (the unordered `least/greatest(type:id)` key) compares with `COLLATE "C"` (byte order) so it provably matches the TS `deriveLinkKey` (JS `<=` code-unit order). Plain `least/greatest` on `text` uses the DB's *default* collation (a locale on standard Supabase), which can order non-ASCII tokens differently than JS → the server-side and client-side dedupe keys silently disagree. Keep `spine_pair_key()` (SQL) and `deriveLinkKey()` (TS) in lockstep. → [src/lib/entity-links.ts](../src/lib/entity-links.ts)
- **A plpgsql function returning a composite type returns an all-NULL *row*, not SQL NULL, after a `SELECT … INTO` that finds nothing.** `RETURN v_row;` when `v_row` is unset serializes (via PostgREST) as `{id:null,…}`, not `null` — callers expecting `null` get a truthy object. Guard with `IF v_row.id IS NULL THEN RETURN NULL; END IF;` (see `links_op_delete`).

## Git / branching

- **`maciej` is a hot branch — merge-commit into it, never fast-forward.** Before editing in a worktree, **check the worktree's base vs `maciej`** (`git rev-list --left-right --count HEAD...maciej`) — sessions have started on a weeks-stale `main` base and edited stale copies of `CLAUDE.md` / `DESIGN_SYSTEM.md` / `tokens.css`. Cut `t/<owner>/<kebab>` off `maciej`, not `main`. A `SessionStart` hook (`.claude/hooks/session-start.sh`) now runs this check automatically and warns on a stale base at session start — but only takes effect once it's merged into `maciej`. → [CONTRIBUTING.md](../CONTRIBUTING.md)

## Claude Code / skills

- **Global skills are shared with Junction.** `~/.agents/skills/*` and `~/.claude/skills/impeccable/` are loaded by *every* project. Do **not** edit them for Moduo work — Moduo-specific skills/commands live **repo-local** in `.claude/skills/` and `.claude/commands/`. → `.claude/skills/`

## Lexical / editor

- **A Lexical node can't be constructed outside an editor context.** `new SomeNode()` / `$createSomeNode()` calls `$setNodeKey`, which throws `Unable to find an active editor` if run in a bare test. To unit-test a node (serialize round-trip, `isInline`, etc.), wrap it in a headless editor: `createEditor({ nodes: [SomeNode], onError })` then `editor.update(cb, { discrete: true })` and assert via captured outer variables (see [`src/features/spine/editor/entity-ref-node.test.ts`](../src/features/spine/editor/entity-ref-node.test.ts)). `getType()` is static and needs no context.
- **A cmdk (`Command`) picker embedded in a Lexical editor steals focus, so Lexical command handlers (Escape/arrows) stop firing.** `KEY_ESCAPE_COMMAND` registered on the editor never sees the key once the picker's `CommandInput` autofocuses; handle Escape on the picker container's `onKeyDown` instead, and own open/close from select/escape/click-away — NOT from the update-listener's selection-null (opening the picker clears the editor selection and would instantly re-close the menu). → [`src/features/spine/editor/entity-mention-plugin.tsx`](../src/features/spine/editor/entity-mention-plugin.tsx)
- **No Supabase-backed rich-text surface exists at alpha.** The only Lexical editor is Notes, which is Yjs/redb and whose notes are **not** registry (`entities`) rows — so it can't be a valid `entity_links` source. The CT-4 `@mention`/`/ref` plugin is therefore built but **unmounted**; it needs a registry-resident `focus` (comments CT-5 / a task description CT-7) before it can persist links. Don't wire spine link-writes into the Notes editor expecting them to round-trip. → [data-layers.md](./data-layers.md)

## Storybook / live-verify

- **Storybook renders nothing in this worktree — `Failed to fetch dynamically imported module: /.storybook/preview.tsx`.** Every story (existing `components-tag-chip--default` included, not just new ones) fails to render at runtime with this error, so interactive/screenshot live-verify of any component is currently blocked here. The Storybook *bundler* still starts and compiles stories cleanly (`sb dev` reports "started" with no errors) — so a clean Storybook boot confirms stories *compile*, but not that they *render*. Likely the worktree/preview-binding issue (see [[feedback-live-verify-in-worktree]] in memory). Until it's fixed, verify components via typecheck + unit tests on the pure logic + the validator pass; visual-snapshot baselines remain a deliberate human capture.
- **The Supabase MCP in this environment is connected to the "Ringdove" org (projects `flowboard`, `lunavale-web`), NOT Moduo's project (`wtoonrvuqumihpkbvwvs`).** So migrations/RPCs can't be applied or round-trip-tested against the real Moduo DB from here, and there's no local Docker for a `supabase` stack. SQL can only be syntax-checked locally (e.g. `pgsql-parser`); applying + the AC round-trip needs the MCP reconnected to the Moduo Supabase account or someone with that access.

## UI / design

- **"The app looks huge on web" was browser zoom**, not fonts or density. Check the browser zoom level before chasing a density/type-scale bug.
- **dnd-kit drags aren't simulable with synchronous synthetic events.** Its rAF collision-detection loop drops same-tick pointer events (why earlier sessions called drag "unsimulable"). To live-verify a drag, dispatch pointer events with **per-frame delays** between move steps. → [build-log.md](./build-log.md)
- **Don't hardcode visual values.** If a needed color/size/radius/shadow/duration isn't a token, add it to `src/styles/tokens.css` — never inline it. Motion goes through the motion tokens so `prefers-reduced-motion` keeps working. → [DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md)
