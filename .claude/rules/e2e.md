---
paths: ["e2e/**", "scripts/agent/e2e.sh", "scripts/agent/e2e-env.ts", ".claude/skills/product-lab/**"]
incident: "Specs failed on the shared dev workspace's leftovers: a second workspace opened instead of the pinned one (TV-U4), a 40-project menu cut off its items (TV-U2), and parallel Focus runs collided (TV-F7)"
expires: 2027-01-31
---

# Playwright e2e and visual specs

Compiled from the UI and build-ci gotchas (HV-14b, HV-14c). Run e2e through `scripts/agent/e2e.sh` (its own port, the machine-wide lock); setup is in [docs/local-dev.md](../../docs/local-dev.md).

## The shared dev workspace
- Always pin the workspace: `signInPage(page, dev, ws.id)` (`e2e/tests/support/local-stack.ts`); other lanes give `dev@moduo.local` more workspaces. It marks Tasks' welcome seen unless you pass `{ welcome: true }`.
- Specs soft-delete what they create. Long lists hold hundreds of earlier runs' rows and draw only what's on screen: deep-link (`/tasks?id=`), search, or pick from a long menu by typing its name, never by scrolling to a title.
- A new project gets a workspace-wide grant and the owner sees every project: test "a project you can't see" as a member.
- Focus specs run serially and end leftover runs first (`endFocusRuns`).
- Seeding: `notes_op_create` keeps a note untitled whatever `p_title` says (assert on its id); a `calendar_events` row inserted directly needs `description: ""`, or `mapKnownRows` drops it.

## Waits and locators
- A skeleton that shares the view's `data-slot` passes a bare visibility wait: wait for `:not([aria-busy="true"])` or the first real content, with the 20 s first-load wait for store-dependent content.
- Wait for a smooth scroll to stop (two equal reads of a box) before reading a mark's box; bring an off-screen mark in first.
- Chromium joins a flex row's label and count with a space in the accessible name (jsdom doesn't): match `/^Website\s*,/`. `getByLabel` also matches `aria-label`. Match a "N new" chip as `^\d+ new$`. Locate Board columns by `section[data-board-column="…"]`, not by text (the detail panel says "To do" too).
- Sonner hands focus back when its last toast leaves: wait for toasts to go before checking focus.
- Playwright's real mouse drives dnd-kit: move a few px past the 6 px activation, wait ~100 ms over the target, release (`e2e/tests/tasks-dnd.spec.ts`).

## Visual and perf specs
- Baselines are a deliberate human capture; a snapshot diff means stop and ask, never auto-accept.
- Measure insets with scrollbars on (`ignoreDefaultArgs: ["--hide-scrollbars"]`); headless can't show trackpad swipe chaining.
- A perf harness drives real input and starts its clock at the input's first event in the page.

## Running specs and the product lab
- Run e2e on the shared local stack only through `scripts/agent/e2e.sh`, never a bare `bunx playwright test`: it takes the machine-wide lock, adds `--project=e2e`, refuses a cloud `.env.local`, and the config starts this worktree's own server.
- The `e2e` project runs `workers: 1`: specs share one workspace and read each other's rows. Rerun a red parallel run with `--workers=1` before chasing it. A suite that finds zero tests passes, so check `playwright test --list`.
- A bare `bun run e2e` also runs the visual project and writes a baseline for every screenshot without one: delete those, never commit them unreviewed.
- Playwright can want a newer browser build than this Mac has ("Executable doesn't exist … chromium_headless_shell-<n>"). Don't download mid-block: use a local, uncommitted config with `use.channel: "chrome"`.
- The perf spec needs the local stack and its 10,000-task fixture (`bun run perf`); CI runs neither, and medians compare only on one machine.
- Run one `/product-lab` at a time per Mac: each run re-seeds the `lab*@moduo.local` people and soft-deletes their previous workspaces. Its preview server takes `LAB_PORT` when two lanes need the build.
