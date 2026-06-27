# Build order — the execution ledger

> **Status of record for "what's next."** One flat, dependency-respecting sequence of every execution block across all ready specs, with a checkbox each. This is the single entry point a fresh session reads to know what to build next — the per-block detail lives in each spec's *Execution blocks* table.
>
> **How `/execute` uses this:** if you name a block, it builds that one. If you don't (e.g. `/execute next`), it takes the **first unchecked block below whose dependencies are all ticked**, states which it picked and why, then builds it. On success it ticks the box here.
> **How `/wrap` uses this:** at session end it reconciles this file (ticks any block completed that session) and syncs each spec's `Status:` line.
> **Invariant:** every block's dependencies appear **above** it, so strict top-to-bottom is always a valid order. Items at the same depth with disjoint deps may be built in parallel/any order.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done (date + branch in the trailing note).

## Wave 0 — Connective Tissue (the spine) · [`specs/connective-tissue.md`](./connective-tissue.md)

- [x] **CT-1 — Registry + link substrate (DB + runtime)** · spine block 1 · deps: — · _done 2026-06-25 · `t/maciej/ct-1-link-substrate` (migration validated on real Postgres 17 via a rolled-back txn — all 15 AC1–AC5 checks green; prod left byte-clean. Deploy-ready; branching unavailable on Free plan so not applied to prod here — your deploy step.)_
- [x] **CT-2 — EntityHub roll-up + components** · spine block 2 · deps: CT-1 · _done 2026-06-25 · `t/maciej/ct-1-link-substrate` (built on CT-1; visual baselines + live render pending — Storybook preview.tsx load is broken in this worktree)_
- [x] **CT-3 — Universal drag-payload contract** · spine block 3 · deps: CT-1, CT-2 · _done 2026-06-25 · `t/maciej/ct-1-link-substrate` (contract + hooks + drop-to-link toast; AC7 keyboard "Link to…" half + the drag e2e + a live drag-source/target consumer deferred — keyboard needs CT-4's MentionPicker, wiring+e2e land with CT-4/CT-7 when live-verifiable)_
- [ ] **CT-4 — @mention / /ref resolver + EntityRefChip** · spine block 4 · deps: CT-1, CT-2
- [x] **CT-5 — Comments + notification/activity generalization** · spine block 5 · deps: CT-1 · _done 2026-06-26 · `claude/blissful-sinoussi-0a13fb` (migration `20260626130000_spine_comments_notifications.sql`: `comments`+`comments_op_add`, `notification_state`+`notifications_op_mark_read`/`_mark_all_read`, derived-feed RPC `notifications_list` + `spine_activity_targets_me` mention predicate. Pure-TS `spine/activity.ts`+`spine/notifications.ts` reducers (grouping/sentences) unit-tested. Runtime `spine.addComment`/`listNotifications`/`mark*` + NotificationCenter rewritten to grouped, human-readable, deep-linking cards — wired into `workspace-provider` MERGED with the legacy feed (graceful-degrade until the migration deploys). Migration deploy-ready but unapplied here (Supabase MCP wrong org); AC9/AC10 server round-trip = manual-test post-deploy.)_
- [ ] **CT-6 — Deterministic auto-suggest + strip** · spine block 6 · deps: CT-1, CT-2
- [ ] **CT-7 — Tasks adoption + MCP manifest + dashboard widget (DoD)** · spine block 7 · deps: CT-1, CT-2, CT-3, CT-5

## Wave 1 — Contacts (light CRM) · [`specs/contacts.md`](./contacts.md)

- [x] **CO-1 — Contacts schema + ops + route** · contacts block 1 · deps: CT-1 · _done 2026-06-26 · `claude/blissful-sinoussi-0a13fb` (migration `20260626120000_contacts_module.sql`: `contacts`+`companies` (RLS mirror Tasks), ops `contacts_op_create`/`_update`/`_set_status`/`_link`/`_unlink` + `companies_op_create`/`_update` (guard + write + `entities` upsert + activity, one txn; reuse Tasks permission lane at alpha). Runtime `contacts` namespace (web + tauri). Route `/crm`→`/contacts` + `"crm"`→`"contacts"` layout key + `/crm` redirect + `ContactsPage` scaffold + new `contact` Icon. Pure-TS `contacts/status.ts` (renamable, no stage machine) unit-tested. Migration deploy-ready but unapplied here; AC1/AC3 server round-trip = manual-test post-deploy.)_
- [ ] **CO-2 — Directory + ContactHub (the great moment)** · contacts block 2 · deps: CO-1, CT-2
- [ ] **CO-3 — CSV import (the adoption gate)** · contacts block 3 · deps: CO-1
- [ ] **CO-4 — Linking + suggestions + company union + follow-up** · contacts block 4 · deps: CO-2, CT-3, CT-4, CT-6
- [ ] **CO-5 — MCP manifest + "Needs attention" widget (DoD)** · contacts block 5 · deps: CO-1, CO-2, CT-7

---

## Running sessions & parallelism

**Each session = its own git worktree + a `t/<owner>/<kebab>` branch cut off the *latest* `maciej`** (never `main`/`develop`; `maciej` is hot → integrate with a merge commit, not a fast-forward — see [CONTRIBUTING.md](../CONTRIBUTING.md) + [docs/gotchas.md](../docs/gotchas.md)). In the session, run `/execute next` (auto-picks the first ready block above) or name one (`/execute CT-3`).

**A block is "ready" only when all its deps are *merged into the base the session branches from*.** So parallelism is **fan-out after each merge barrier**, not "start all 12 at once": land a block → merge it into `maciej` → start the next round's sessions off the updated `maciej`. A session whose base is missing its deps is building on sand (the stale-base trap — gotchas.md).

### Parallel lanes (derived from the deps above)

| Once merged into `maciej` | Become ready to run in parallel | Max width |
| --- | --- | --- |
| *(start)* | **CT-1** — the gate; everything waits on it | 1 |
| CT-1 | **CT-2** · **CT-5** · **CO-1** | 3 |
| CT-1, CT-2, CO-1 | **CT-3** · **CT-4** · **CT-6** · **CO-2** · **CO-3** | ~5 |
| CT-1–3, CT-5, CO-1–2 | **CT-7** · **CO-4** (needs CT-3/4/6 too) | 2 |
| CT-7, CO-1–2 | **CO-5** | 1 |

### Serialization points — dep-independent ≠ conflict-free

Two blocks with no dependency between them still **merge-conflict if they edit the same file.** These are shared and *will* collide if worked in parallel — sequence them, or expect a quick manual merge:

- **`supabase/migrations/*.sql`** — each block adds its own timestamped file (additive), but coordinate timestamps so the apply order stays sane; never let two sessions alter the *same* table at once. (CT-1, CT-5, CO-1, CO-3 all add migrations.)
- **`src/lib/module-registry.ts`** — every module's DoD registers a manifest here (CT-7, CO-5). A one-line array push — trivial to resolve, but expect it.
- **`src/lib/runtime.web.ts` / `runtime.tauri.ts`** — each block adds runtime methods → the **highest-contention** shared files; the most likely real conflict.
- **Shared chrome** — `SlashCommandPlugin` (CT-4), `NotificationCenter` (CT-5), `GlobalCommandPalette` — mostly disjoint across blocks, but check before parallelizing two that touch the same one.

**Rule of thumb:** parallelize blocks **in the same lane whose file footprints are disjoint** (e.g. CT-2 UI components ∥ CT-5 comments/notifications ∥ CO-1 schema+route — clean). Blocks that pile into the same migration / registry / runtime file should be sequenced or merged carefully. When in doubt, the lane table gives the *dependency*-safe set; this list gives the *file*-safe overlay.

---

**Not yet specced** (await their wave; add their blocks here when their spec passes the Definition-of-Ready gate): Calendar → Notes → Finance → Email, plus the Dashboard rebuild. Order and rationale in [docs/ROADMAP.md](../docs/ROADMAP.md). The Cmd-K Search/Capture modes and the Universal Inbox screen are deferred spine sub-features (see `specs/connective-tissue.md` → Out of scope).
