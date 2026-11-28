# Spec: Native desktop app on GPUI — foundation (NF)

> Status: **Approved** (Mike, 2026-11-28) · Owner: mike · Related: `docs/DESIGN_RULES.md`, `docs/DESIGN_SYSTEM.md`, `specs/native-tasks.md` (next)

## Scope

Moduo's desktop app is ported from the Tauri webview to a native Rust app on GPUI, built as a **separate app** in `apps/native` that installs beside the Tauri one and talks to the same Supabase backend. The React app stays as it is and remains the web app; `apps/desktop` keeps shipping until the native app reaches parity (Mike, 2026-11-27: desktop only, macOS first, Notes gets a native editor). In-place replacement is not possible: a Tauri window is a webview GPUI cannot draw into, and a webview inside a GPUI window draws over everything beneath it.

This spec delivers the foundation: the Cargo workspace and its gates, the design tokens in Rust, every primitive the shell and Tasks need (one by one, in dependency order, each shown in a gallery app), and the shell: sign-in, workspace, top bar, panels, hotkeys, sign-out. When it is done a person can sign in to the native app and land on an empty Tasks frame.

The whole port, in order. Each row is its own spec, written when the one before it is under way:

| # | Spec | Delivers |
| --- | --- | --- |
| 1 | `native-foundation` (this) | workspace, tokens, primitives, gallery, shell, sign-in |
| 2 | `native-tasks` | Rust data core (contracts, sync kernel, store, commands), Tasks surface by surface, the measurement gate |
| 3 | Editor spike | the text-editing engine every later module needs: a custom GPUI element over `EntityInputHandler` against `NativeView` + `NSTextView`, on `yrs`; runs beside spec 2 |
| 4 | Settings (minimum) | account, appearance, cloud preference sync |
| 5 | Spine | capture, command palette, global search, references, notifications |
| 6 | Calendar | |
| 7 | Email | the Rust mail engine moves into a shared crate; message HTML in a native web view pane |
| 8 | Chat | |
| 9 | Contacts, Home | |
| 10 | Focus, Soundspace, Mindmap | |
| 11 | Notes | the native editor, wire-compatible with what web Lexical writes |
| 12 | Distribution | bundle, sign, notarize, updater, release workflow |
| 13 | Cutover | move people over, retire `apps/desktop` |

## Product behavior & UX

The React app is the reference: every surface keeps its layout, wording, states and keys. Differences a person sees in this spec:

- It is a second app, **Moduo Native**, with its own icon in the Dock and its own sign-in. Both apps can be open at once on the same account.
- Only modules that are ported appear in the top bar. After this spec that is one tab, Tasks, showing an empty three-panel frame.

Main flow:

1. Launch. The window (1280×840, never smaller than 1024×700, native title bar) appears only once it has something to draw. With a stored session it shows "Checking your session…" and goes to step 4.
2. Sign in. One field for the email and "Send code". Sign-up stays invite-only: an unknown email gets the same refusal copy as the web app.
3. Code. Six digits, "Resend" with a countdown, the web app's error copy for a wrong or expired code.
4. Workspace. The last selected workspace opens, otherwise the first. With no workspace, one screen asks for a name and creates it. While the list loads: "Loading workspace...".
5. The app. Top bar: workspace switcher on the left, module tabs in the centre, sync status and the avatar menu on the right. Content: left rail, centre, right panel, each resizable, sizes and open state remembered per device. Bottom bar: the two panel toggles.
6. Log out, from the avatar menu: the sign-in screen shows first, then the session ends.

States: signed out, restoring, sending code, waiting for the code, wrong code, loading workspaces, no workspace, offline with a session (the app opens on what the device remembers), offline without one (sign-in says it cannot reach Moduo), below the minimum build ("Update Moduo" strip, saving refused), Keychain locked (treated as signed out).

The gallery is a second window for the builder and the designer: every primitive, every variant and state, at the three densities, with switches for theme, shade, accent, radius, font and motion.

## Edge cases

- The Keychain is locked or refuses access at launch: signed out, no crash, no repeated prompt.
- The refresh token is dead (revoked elsewhere): the app goes to sign-in and keeps anything still waiting to sync.
- The account was deleted elsewhere while a session is cached: the first profile read says so; the app signs out.
- The workspace list comes back empty while the device remembers workspaces: the remembered list wins (a request without its token reads as empty).
- The remembered workspace no longer exists: the first workspace opens.
- Two launches at once: the second brings the first window forward.
- The window is narrower than a popover or menu needs: the overlay flips side and stays inside the window.
- A toast is on screen while a dialog is open: pressing the toast works and does not close the dialog.
- A menu item opens a dialog: the action runs after the menu has closed, so focus lands in the dialog.
- Reduced motion (the system setting or the app's): movement becomes a fade.
- A token is edited in `tokens.css` and the export is not rerun: `bun run verify` fails.
- Typing with an input method (Polish Option-keys, a CJK composer): composition text shows inline and commits once.
- The installed Tauri app is running: nothing is shared; neither app asks for the other's Keychain items.

## Acceptance criteria

- **AC1** — `bun run native:dev` opens a native window with no webview: 1280×840, minimum 1024×700, native title bar, dark, shown after its first frame. `bun run native:check` passes, and CI runs it whenever `apps/native` changes.
- **AC2** — Every colour, size, radius, font, shadow and duration in the native app comes from `apps/app/src/styles/tokens.css`. Editing a token and rerunning the export changes the native app; a stale export fails `bun run verify`; resolved colours match the browser's within 1/255 per channel.
- **AC3** — Theme, shade, accent, density, radius, font and motion switch live, without a restart, and every primitive follows.
- **AC4** — Each primitive listed in the blocks exists with the variants, sizes and states of its React counterpart (default, hover, keyboard focus, active, disabled, and loading and error where the original has them) and is shown in the gallery at three densities.
- **AC5** — Keyboard behaviour matches: a focus ring only on keyboard focus; Tab order follows reading order; a toolbar is one Tab stop with arrow keys inside; menus move with arrows, jump by typing, open submenus with Right; Esc closes only the topmost surface and focus returns to what opened it; a dialog keeps focus inside.
- **AC6** — Floating surfaces open on the asked side and alignment, flip when they would leave the window, stack in token order, and close on Esc or an outside press. A toast stays pressable over a dialog.
- **AC7** — Text fields support typing, selection, copy and paste, undo, and input-method composition; a draft commits on blur or Enter and is dropped on Esc.
- **AC8** — Code outside the `moduo-ui` crate cannot use the component library directly, and no crate outside `moduo-tokens` contains a raw colour or pixel literal for a design value; a test fails on either.
- **AC9** — Sign-in is the emailed six-digit code with the web app's wording, resend countdown and errors. The session lives in the macOS Keychain under the native app's own service; a relaunch restores it; a locked Keychain means signed out; the token is refreshed before it expires and after a 401.
- **AC10** — The last selected workspace reopens, else the first; the switcher (⌘⇧W) changes it; with none, one name field creates one; offline, the remembered list is used; an empty answer never replaces a remembered list.
- **AC11** — The shell matches the React shell: top bar (switcher, module tabs from one module table, sync-status slot, avatar menu), three resizable panels (left at least 240, right at least 280) whose sizes and open state persist per device, bottom bar with both panel toggles, ⌘1 for Tasks, and a native menu with Quit, Edit and Window items.
- **AC12** — Shortcuts come from one registry: the narrowest scope wins, a key typed into a field does nothing unless the shortcut says it works in fields.
- **AC13** — Log out shows the sign-in screen first, then ends the session, removes the Keychain entry and forgets the remembered workspaces; it warns first when changes still wait to sync. A dead refresh token signs out and keeps what waits.
- **AC14** — The native app never reads or writes the Tauri app's Keychain items, data folder or bundle identifier; both run side by side.
- **AC15** — Below the server's minimum build the app shows "Update Moduo", stays readable and refuses saves with the web app's message.
- **AC16** — Offline with a stored session the app opens to the shell; offline without one, sign-in says it cannot reach Moduo.
- **AC17** — Side by side with Storybook, every ported primitive has no unexplained visual difference at any density.

## Tests that prove them

Rust tests live beside the code (`apps/native/crates/<crate>/tests/`); `#[gpui::test]` drives a headless window with simulated keys and clicks. Paths below are under `apps/native/crates/`.

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `app/tests/window.rs` · "opens one window at the default size and minimum" | AC1 | the window options are the ones the design assumes |
| `scripts/native/export-tokens.test.ts` · "the committed tokens.json matches tokens.css" | AC2 | a token edit without a fresh export fails verify |
| `tokens/tests/golden.rs` · "resolved tokens match the browser for six appearances" | AC2 | Rust's colours equal what Chromium computes from the same CSS |
| `tokens/tests/resolve.rs` · "each axis overrides only its own tokens" | AC3 | switching accent changes accent tokens and nothing else |
| `ui/tests/appearance.rs` · "a density switch re-lays every primitive" | AC3 | no primitive caches a size |
| `ui/tests/<primitive>.rs` · "renders every variant and size" (one file per primitive) | AC4 | nothing from the React variant list is missing |
| `ui/tests/<primitive>.rs` · "disabled ignores press and keys" | AC4 | a disabled control does nothing |
| `ui/tests/focus.rs` · "the ring shows on Tab, not on click" | AC5 | focus styling is keyboard-only |
| `ui/tests/toolbar.rs` · "one Tab stop, arrows move, a nested group counts once" | AC5 | roving focus as in the React toolbar |
| `ui/tests/menu.rs` · "arrows, typeahead, submenu, Esc returns focus" | AC5 | menu keyboard map |
| `ui/tests/dialog.rs` · "Tab cycles inside; Esc closes the top one only" | AC5 | focus trap and layered Esc |
| `ui/tests/floating.rs` · "flips at the window edge and stays inside" | AC6 | collision handling |
| `ui/tests/floating.rs` · "outside press closes; press inside does not" | AC6 | dismissal |
| `ui/tests/toast.rs` · "a toast press over a dialog reaches the toast and keeps the dialog" | AC6 | the toast exception |
| `ui/tests/input.rs` · "type, select, copy, paste, undo" | AC7 | plain editing |
| `ui/tests/input.rs` · "marked text commits once" | AC7 | input-method composition through the input handler |
| `ui/tests/input.rs` · "blur and Enter commit, Esc restores" | AC7 | the draft field |
| `tests/boundaries.rs` (workspace root) · "only moduo-ui names the component library" · "no design literals outside moduo-tokens" | AC8 | the two import and literal rules |
| `auth/tests/otp.rs` · "send, verify, store, restore" | AC9 | the sign-in round trip against a fake auth server |
| `auth/tests/refresh.rs` · "refreshes before expiry and once after a 401" | AC9 | token upkeep |
| `auth/tests/keychain.rs` · "a locked store reads as signed out" | AC9 | no crash, no loop |
| `app/tests/sign_in.rs` · "email, code, wrong code, resend countdown" | AC9 | the screens and their copy |
| `app/tests/workspace.rs` · "reopens the last, falls back to the first, creates the first" | AC10 | workspace choice |
| `app/tests/workspace.rs` · "an empty answer keeps the remembered list" | AC10 | the offline-safe rule |
| `app/tests/chrome.rs` · "tabs come from the module table; cmd-1 selects Tasks" | AC11 | one table drives tab, key and route |
| `app/tests/panels.rs` · "sizes and open state persist; minimums hold" | AC11 | panel memory |
| `app/tests/hotkeys.rs` · "narrowest scope wins; fields swallow plain keys" | AC12 | the registry rules |
| `app/tests/sign_out.rs` · "navigates first, then clears; warns when writes wait" | AC13 | sign-out order |
| `auth/tests/refresh.rs` · "a dead refresh token signs out and keeps the outbox hook untouched" | AC13 | forced sign-out is not a wipe |
| `config/tests/identity.rs` · "service, bundle id and data dir never equal the Tauri app's" | AC14 | isolation |
| `supabase/tests/read_only.rs` · "below the minimum, writes get the read-only refusal and reads pass" | AC15 | the minimum-build gate |
| `app/tests/offline.rs` · "a stored session opens the shell offline" · "sign-in offline shows the network copy" | AC16 | offline start |
| Manual: gallery beside Storybook, per primitive, three densities (NF-32 checklist in the PR) | AC17 | nothing looks different without a written reason |

## Assumptions & technical decisions

Mike runs engineer mode; these are the technical calls, each recorded as a dated entry in `docs/decisions/desktop-release.md` or `docs/decisions/toolchain.md` by NF-1.

1. **Separate app, own Cargo workspace at `apps/native`.** Not the repo root, so the Tauri crate's lockfile, `rust-check` job and release workflow are untouched. Rejected: in-place replacement (impossible), a webview-inside-GPUI hybrid (the webview paints over GPUI content).
2. **GPUI through crates.io, exactly pinned: `gpui-kit =0.11.0` on its `gpui-pre` snapshot (unmodified weekly snapshots of Zed's GPUI).** It is what the dropped spike built and ran on (PR #841). Rejected: `gpui` 0.2.2 on crates.io (13 months behind Zed), a bare git pin of Zed (no text input, list or overlay components to start from), the forks `gpui-fast` and `gpui-ce` (diverging). Bumps happen in their own block, never inside a feature block; the kit breaks its API most weeks.
3. **The kit stays behind `moduo-ui`.** Features use Moduo primitives only, as React features use the shadcn wrappers. A kit bump, or leaving the kit, touches one crate.
4. **Toolchain: the desktop crate's pin, `nightly-2026-10-06`** (`docs/decisions/desktop-release.md:32`), in `apps/native/rust-toolchain.toml`. The spike compiled on it. The native workspace is `cargo fmt`- and clippy-clean from the first commit and CI checks both.
5. **Identity.** Product name "Moduo Native" until cutover, bundle id `com.moduo.native` (`.dev` for debug), Keychain service `com.moduo.native.auth` (`.dev.auth` for debug), data in `~/Library/Application Support/com.moduo.native/`. Nothing is shared with `com.moduo.desktop`: a Keychain item's access list belongs to the app that made it.
6. **Tokens: TypeScript exports, Rust includes.** `scripts/native/export-tokens.ts` reads `tokens.css` into a committed `tokens.json` (literals, `var()` references, `color-mix` and `calc` as a small expression tree, one layer per selector); a test in `bun run verify` fails when it is stale. The Rust resolver layers the six axes at run time and does the colour maths (oklch to sRGB, mixing in oklab and oklch). This is the `mail-local.json` pattern the mail engine already uses. Rejected: parsing CSS in `build.rs` (an alpha parser in every build), baking every axis combination (2×6×8×3×3×7).
7. **Async and data crates carry no GPUI.** `moduo-auth`, `moduo-supabase` and the data crates of spec 2 run on a tokio runtime and hand results to the UI over channels, so they test with plain `cargo test` and can serve another shell later.
8. **Supabase by hand: `reqwest` for Auth and PostgREST** (and `tokio-tungstenite` for Realtime in spec 2). There is no official Rust client and the community ones are single-maintainer or stale.
9. **Session in the Keychain through the `keyring` crate** (the desktop crate's choice), not GPUI's credential calls, so auth stays UI-free.
10. **Per-device state as JSON files in the data folder** (`appearance.json`, `preferences.json`, `panels.json`, `workspaces.json`), written atomically. Cloud preference sync comes with Settings (spec 4); spec 2 adds the one synced domain Tasks needs.
11. **Fonts bundled as TTF/OTF** (Geist 400/500/600/700, Geist Mono 400/500, Inter as the fallback for accented Latin); icons as embedded Lucide SVGs behind one `IconName` enum.
12. **Tests.** Vectors ported from the TypeScript tests for anything pure; `#[gpui::test]` for interaction; no screenshot gate yet (GPUI can capture, nothing diffs).
13. **CI.** A `native-check` job on GitHub's `macos-latest`, started only when `apps/native/**` or the two exported JSON sources change. Never the self-hosted Mac (`.claude/rules/ci-release.md`).
14. **No backend change.** No migration, no function, no new table: the native app calls what the web app calls, as the signed-in person.
15. **The Tauri app keeps shipping.** Each block ports the behaviour of the commit it starts from; NF-32 and the parity sweep of spec 2 catch what moved.
16. **Accessibility.** Primitives set role and label from the first version. VoiceOver focus tracking has open upstream bugs (zed #66691); not a gate here.

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| NF-1 | Workspace skeleton, scripts, rule and decisions | `apps/native` opens an empty window; `native:dev`, `native:check`; path rule; decision entries | AC1, AC14 | — |
| NF-2 | CI check for the native workspace | `native-check` job, path gate, Tier 2 paths | AC1 | NF-1 |
| NF-3 | Token export | `tokens.json` from `tokens.css`, staleness test in verify | AC2 | NF-1 |
| NF-4 | Token resolver | `moduo-tokens`: layers, colour maths, golden test against the browser | AC2, AC3 | NF-3 |
| NF-5 | Fonts, icons and assets | bundled fonts, `IconName`, the Moduo mark, type roles | AC2, AC4 | NF-1 |
| NF-6 | Runtime plumbing | config, data folder, tokio bridge, logging, single instance | AC14 | NF-1 |
| NF-7 | Gallery and interaction base | gallery window, theme bridge, state layer, focus ring, motion, recipes | AC3, AC5, AC8 | NF-4, NF-5 |
| NF-8 | Static primitives | Kbd, Separator, Label, Eyebrow, Badge, DetailTitle, EmptyState, CollectionHeader, MetaCount, Progress, Skeleton | AC4 | NF-7 |
| NF-9 | Buttons and toggles | Button, CompleteToggle, Checkbox, Switch, RadioGroup | AC4, AC5 | NF-7 |
| NF-10 | Text fields | Input, NumberInput, Textarea, the draft field | AC4, AC7 | NF-7 |
| NF-11 | Floating layer, Tooltip, Popover, IconButton | one anchored-overlay engine and its first three users | AC4, AC5, AC6 | NF-9 |
| NF-12 | Menus | DropdownMenu, ContextMenu, the shared menu kit | AC4, AC5, AC6 | NF-11 |
| NF-13 | Select, SegmentedControl, Toolbar | roving focus and the two controls built on it | AC4, AC5 | NF-12 |
| NF-14 | Modal layer | Dialog, AlertDialog, Sheet | AC4, AC5, AC6 | NF-9 |
| NF-15 | Toasts | the toast host with Undo | AC4, AC6 | NF-14 |
| NF-16 | Command | filtered command list and its dialog | AC4, AC5 | NF-14, NF-10 |
| NF-17 | Rows, cards, headers, drag visuals | Row, ItemCard, GroupHeader, PropertyRow, drag visuals | AC4 | NF-8 |
| NF-18 | Avatars and chips | Avatar family, Chip, PickerPill | AC4 | NF-12 |
| NF-19 | NavRow | rail rows with menus and inline rename | AC4, AC5 | NF-12, NF-17, NF-10 |
| NF-20 | Calendar and DateField | month grid, date and time entry | AC4, AC5 | NF-11, NF-10, NF-17 |
| NF-21 | FilterBar, DisplayMenu, Feed | the two toolbar composites, the filter model, the feed | AC4, AC5 | NF-16, NF-13, NF-20 |
| NF-22 | Resizable panels and pane scroll | panel group with minimums and persisted sizes; scrollbars | AC4, AC11 | NF-7 |
| NF-23 | VirtualStack | measured virtual list with a sticky header | AC4 | NF-17 |
| NF-24 | Auth core | `moduo-auth`: code sign-in, Keychain session, refresh | AC9, AC13, AC14 | NF-6 |
| NF-25 | Supabase REST core | `moduo-supabase`: requests, errors, retry after refresh, read-only gate, fake server | AC9, AC15 | NF-24 |
| NF-26 | Sign-in screens | restoring, email, code | AC9, AC16 | NF-24, NF-10, NF-9 |
| NF-27 | Workspaces and onboarding | list, choose, remember, create the first | AC10, AC16 | NF-25, NF-26 |
| NF-28 | Hotkey registry | scopes and the global shortcuts table | AC12 | NF-7 |
| NF-29 | Top bar, module table, native menu | the chrome frame and ⌘1 | AC11 | NF-27, NF-28, NF-12, NF-18 |
| NF-30 | Panels shell, bottom bar, device preferences | three-panel layout per module, toggles, JSON stores | AC3, AC11 | NF-29, NF-22 |
| NF-31 | Sign-out, lifecycle, minimum build | Log out, forced sign-out, deleted account, "Update Moduo" | AC13, AC15 | NF-30, NF-15 |
| NF-32 | Gallery parity review | every primitive beside Storybook; fixes; native live-verify doc | AC17 | NF-8, NF-9, NF-10, NF-11, NF-12, NF-13, NF-14, NF-15, NF-16, NF-17, NF-18, NF-19, NF-20, NF-21, NF-22, NF-23 |

## Block briefs

### NF-1 · Workspace skeleton, scripts, rule and decisions

- **Goal:** `apps/native` is a Cargo workspace whose `moduo-app` binary opens one empty native window, with root scripts to run and check it, a path rule for agents and the decisions written down.
- **Acceptance criteria:** AC1 — `bun run native:dev` opens a native window with no webview: 1280×840, minimum 1024×700, native title bar, dark, shown after its first frame. `bun run native:check` passes. AC14 (its part) — bundle id, Keychain service and data folder are the native app's own.
- **Tests:** `crates/app/tests/window.rs` · "opens one window at the default size and minimum"; `tests/boundaries.rs` · "only moduo-ui names the component library" (the test exists and passes on the empty tree).
- **Start here:**
  - The dropped spike is the starting shape: `git fetch origin pull/841/head`, then `git show FETCH_HEAD:apps/gpui-spike/Cargo.toml` (`gpui-kit = "0.11.0"`), `rust-toolchain.toml` (`nightly-2026-10-06`) and `src/main.rs`.
  - Layout: `apps/native/Cargo.toml` (`[workspace] members = ["crates/*"]`, shared `[workspace.dependencies]` with `gpui-kit = "=0.11.0"`, `[workspace.lints]`), `Cargo.lock` committed, `crates/app` (bin `moduo-app`), `crates/ui` (lib, empty), `tests/boundaries.rs` as a workspace-level test crate.
  - Window: the Tauri values at `apps/desktop/src-tauri/tauri.conf.json:13-25` (1280×840, hidden until ready, black background); minimum from `.claude/rules/app-shell.md:15`.
  - Root `package.json` scripts (no `apps/native/package.json`, so `bun.lock` does not move): `native:dev` = `cargo run -p moduo-app`, `native:check` = `cargo fmt --check && cargo clippy --locked --all-targets -- -D warnings && cargo test --locked`, all with `--manifest-path apps/native/Cargo.toml`.
  - `.gitignore:46-51`: add `apps/native/target/`.
  - New `.claude/rules/native-rust.md`: frontmatter `paths: ["apps/native/**"]`, `incident:`, `expires:`, at most 2,500 bytes (`scripts/agent/rules.ts:18,137-145`). Content: the gate, the kit boundary, the pin and identity rules.
  - Decisions: add the two entries at the top of `docs/decisions/desktop-release.md` and `docs/decisions/toolchain.md` in the format of `desktop-release.md:11-12`, then `bun run docs:index`. Text: assumptions 1 to 5 of `specs/native-foundation.md`.
- **Decisions that apply:** `docs/decisions/desktop-release.md:32` (the nightly pin), `:8` (macOS 14 is the floor). This block writes the two new entries.
- **Traps:**
  - A rule's `paths` glob must match a tracked file, so the rule lands in the same commit as `apps/native` (`scripts/agent/rules.ts:142-145`).  - AGENTS.md is capped at 6,144 bytes: add one line at most.
  - Bun workspaces glob `apps/*`: confirm `bun install` accepts a folder with no `package.json`; if it does not, add a minimal private one and note the `bun.lock` change in the PR.
  - Every `.rs` file stays under 32 KB (`scripts/ci/ratchets.ts:32`).
- **Not in this block:** CI (NF-2), any primitive, tokens (the window uses the kit's default dark theme for now).

### NF-2 · CI check for the native workspace

- **Goal:** A pull request or push that changes `apps/native` runs the native gate in CI, and the review tier knows the native paths that carry risk.
- **Acceptance criteria:** AC1 (its part) — CI runs `bun run native:check` whenever `apps/native` changes.
- **Tests:** `scripts/ci/tier.test.ts` · the native paths in `TIER2_FIXTURES`; `scripts/ci/config-traps.test.ts` · "runs the native app's gate when apps/native changes" · "keeps native:check and the CI job running the same commands". `checks.yml` runs only on PRs into develop and on pushes, so the job itself is proved by its first green run on the push to `mike` after the merge.
- **Start here:**
  - `.github/workflows/checks.yml`: `oracle-paths` outputs at :208-211 and the case at :239-250 (add a `native` output for `apps/native/*`, `apps/app/src/styles/tokens.css` and `supabase/functions/_shared/contracts/*`); model the job on `rust-check` at :328-374; add it to `static-checks` needs at :474 and the result line at :491; update the header comment at :20-23.
  - Job: `runs-on: macos-latest`, toolchain read from `apps/native/rust-toolchain.toml` as :345-353 does, Swatinem cache with `workspaces: apps/native` and its own `shared-key`, saved on push only, then the three commands of `native:check` with `--locked`.
  - `scripts/ci/tier.ts:33-71` `TIER2`: add `apps/native/crates/auth/**`, `apps/native/crates/config/**` and `apps/native/Cargo.toml`; mirror in `scripts/ci/tier.test.ts:21-41`.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - Workflow changes are Tier 2: run the `validator` subagent before merging (`.claude/rules/ci-release.md:19`).
  - Never point a `pull_request` job at the self-hosted Mac; this job is GitHub-hosted only (`.claude/rules/ci-release.md`, Mac build runner section).
  - Third-party actions are pinned to a SHA with the tag in a comment (`ci-release.md:29`).
  - A skipped oracle counts as a pass in `static-checks` (`checks.yml:201-204`): keep that behaviour for `native-check`.
  - macOS minutes cost ten times Linux ones; the path gate is what keeps this cheap. Do not widen it.
- **Not in this block:** Building, signing or releasing the native app (spec 12).

### NF-3 · Token export

- **Goal:** A script turns `tokens.css` into a committed `apps/native/crates/tokens/tokens.json`, and verify fails when the two disagree.
- **Acceptance criteria:** AC2 (its part) — every design value comes from `apps/app/src/styles/tokens.css`; a stale export fails `bun run verify`.
- **Tests:** `scripts/native/export-tokens.test.ts` · "the committed tokens.json matches tokens.css" · "every custom property is exported" · "an unknown function fails the export".
- **Start here:**
  - Precedent to copy: `scripts/mail/export-contracts.ts:1-12` writes `supabase/functions/_shared/contracts/mail-local.json` and `mail.test.ts:20` fails when it is stale.
  - Source: `apps/app/src/styles/tokens.css`, 238 custom properties (456 definitions) above the `@theme` block. Sections by line: raw palette 35-99 (oklch literals), dark 100-187, light 188-239, shades 240-335, accents 336-417, state layer 418-530 (23 `color-mix(in oklab …)`), density 555-700, radius 701-738, type 739-813, layout 814-868, shadows 869-902, motion 903-963, z-index 964-984, labels 985-1028. Skip the Tailwind `@theme inline` block at 1029-1142.
  - Output shape: see the NF-4 brief (it is what the resolver reads).
  - Selectors to map into `when` are listed in the file header at `tokens.css:8-14`; compound ones are at :234-238, :260-324, :409-410 and the reduced-motion pair at :940-962.
  - Add the script as `native:tokens` in the root `package.json` and put the test where `test:scripts` picks it up (`bun test scripts`).
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - Two tokens cannot be resolved to a number: `--row-first-line-pad` is a calc tree with a `1lh` operand (`tokens.css:866`) and the mail list width is a `raw` percentage `clamp` (:667). The resolver leaves both unresolved.
  - Media queries (`prefers-color-scheme`, `prefers-reduced-motion`, the two size queries at :648-660 and :690-699) become `when` keys the app sets itself; never drop a layer silently: an unmapped selector fails the export.
  - Parse with a real CSS parser (check the root dev dependencies first; add `postcss` as a root dev dependency if none is there), never with regular expressions.
  - The JSON is committed and formatted by `bun fmt`; the staleness test compares parsed values, not bytes.
- **Not in this block:** Any Rust (NF-4). Component CSS in `global.css` (motion patterns are rebuilt by hand in NF-7).

### NF-4 · Token resolver

- **Goal:** The `moduo-tokens` crate turns `tokens.json` and an `Appearance` (theme, shade, accent, density, radius, font, motion) into typed values, and its colours equal the browser's.
- **Acceptance criteria:** AC2 — resolved colours match the browser's within 1/255 per channel. AC3 (its part) — each axis switches at run time.
- **Tests:** `crates/tokens/tests/golden.rs` · "resolved tokens match the browser for six appearances"; `crates/tokens/tests/resolve.rs` · "each axis overrides only its own tokens" · "a var cycle is an error, not a hang" · "reduced motion shortens durations".
- **Start here:**
  - Input: `apps/native/crates/tokens/tokens.json` through `include_str!`, parsed once (as `apps/desktop/src-tauri/src/mail/contracts.rs:2,56` does for `mail-local.json`).
  - Shape: the types at the top of `scripts/native/export-tokens.ts`. Layers in source order; `when` lists alternatives, each mapping an axis to a value, `"*"` (present) or `{not}`; `media` holds media features; oklch L and alpha are 0–1, mix percentages 0–100 or null; shadows and font stacks are `{list}`.
  - API: `Tokens::resolve(&Appearance) -> Resolved`; typed getters from the token names (`color(Color::Primary)`, `px(Size::CtrlH)`, `duration(Motion::Fast)`, `shadow(Shadow::Md)`, `z(Z::Popover)`), plus `alpha(color, pct)` for `/90`-style modifiers (`docs/DESIGN_RULES.md:87-93`).
  - Colour maths, written here with unit tests: oklch → oklab → linear sRGB → sRGB with gamut clipping; `color-mix` in oklab (23 uses, `tokens.css:460-514`) and in oklch (4 uses, :165, :175-177) with premultiplied alpha, as CSS Color 4 defines.
  - Golden fixture: `scripts/native/tokens-golden.ts` loads `tokens.css` in Playwright Chromium, sets the `data-*` attributes for six appearances (dark default; light; dark + warm + violet; dark + dense + sharp; light + mono; dark + reduced motion) and writes each token's computed value to `crates/tokens/tests/golden.json` (committed).
  - The 6 attributes and their values: `tokens.css:8-14`.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - Apply layers in order (the export guarantees no earlier layer outranks a later one); a layer applies when any `when` alternative matches and every `media` feature holds.
  - State-layer colours are translucent on purpose (`.claude/rules/ui-css.md:35,38`): keep alpha, never pre-flatten onto a background.
  - rem is 16 px times the text-size setting; resolve rem at run time, not at parse time.
  - Every `.rs` file stays under 32 KB (`scripts/ci/ratchets.ts:32`).
- **Not in this block:** Applying tokens to the kit's theme (NF-7). Label colours per `data-label` are resolved on demand by `label(name)`, same crate.

### NF-5 · Fonts, icons and assets

- **Goal:** The app draws text in Geist and icons from Lucide exactly as the web app does, through `moduo-ui` types: `IconName`, `Icon`, `ModuoMark` and the text-role helpers.
- **Acceptance criteria:** AC2 (its part) — fonts and sizes come from tokens. AC4 (its part) — Icon and ModuoMark exist with the React sizes.
- **Tests:** `crates/ui/tests/icon.rs` · "every IconName has an embedded SVG" · "an icon inside a control follows the density ladder"; `crates/ui/tests/text.rs` · "each type role resolves family, size, weight and leading from tokens".
- **Start here:**
  - Fonts the web app loads: `apps/app/src/global.css:19-30` (Geist 400/500/600/700, Geist Mono 400/500, Inter latin-ext 400-700 as fallback) and the bridge faces at :67-97. Bundle the static TTF or OTF files from the Geist and Inter releases (both OFL; add the licence files) under `apps/native/assets/fonts/` and load them with `cx.text_system().add_fonts(…)` at start.
  - Type scale and roles: `tokens.css:739-813` (base is 14 px); roles in `docs/DESIGN_RULES.md:26,68` (R4, R9). Expose `text_role(Role::Body | Display | Eyebrow | Mono | …)`.
  - Icons: `apps/app/src/components/ui/icon.tsx:87-154` (25 named icons, sizes sm 16, md 20, lg 24 at :114-120, the custom `GroundRootsIcon` at :29-85). The shell and Tasks import 134 distinct Lucide icons directly; list them with `rg -o "from \"lucide-react\"" -l apps/app/src/features/tasks apps/app/src/components` and read the names. Copy those SVGs from `lucide-static` at the version in `apps/app/package.json:71` into `apps/native/assets/icons/` and generate the `IconName` enum from the folder.
  - Icon size inside controls follows `--icon-xs…lg` (`tokens.css:576-579`), not 16/20/24.
  - Mark: `apps/app/src/components/ui/moduo-mark-path.ts:4` and `moduo-mark.tsx:28`.
  - Assets are embedded in the binary through GPUI's `AssetSource` (the kit shows the pattern in its `assets` feature).
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - GPUI takes raw TTF or OTF bytes; the web app's woff2 files will not load.
  - Accented Latin (Polish) must fall back to Inter where Geist lacks a glyph: test "Zażółć gęślą jaźń" renders with no missing-glyph box.
  - The picker fonts (Source Serif, Cal Sans, Fraunces, `apps/app/src/styles/fonts-picker.css`) are not bundled yet; `data-font` values other than the default fall back to Geist until Settings (spec 4).
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
- **Not in this block:** The font picker, the app icon and Dock assets (spec 12).

### NF-6 · Runtime plumbing

- **Goal:** Three small GPUI-free pieces every later crate uses: `moduo-config` (backend address, key, identity, data folder), a tokio runtime with a bridge into GPUI, and logging. A second launch focuses the first window.
- **Acceptance criteria:** AC14 — the native app never reads or writes the Tauri app's Keychain items, data folder or bundle identifier; both run side by side.
- **Tests:** `crates/config/tests/identity.rs` · "service, bundle id and data dir never equal the Tauri app's" · "debug and release use different Keychain services"; `crates/config/tests/backend.rs` · "env wins, then the baked value" · "the cloud flag is refused without its env file"; `crates/app/tests/bridge.rs` · "a tokio future's result reaches a GPUI entity".
- **Start here:**
  - Config precedent: `apps/desktop/src-tauri/src/config.rs:3-17` (service names, the debug split and why), :25-37 (`oauth_client!`: run-time env first, then `option_env!`), :121-125 (URL). The spike's `config.rs` (`git show FETCH_HEAD:apps/gpui-spike/src/config.rs` after `git fetch origin pull/841/head`) reads the repo's `.env.local`, takes `--cloud` for `.env.cloud.local` and names the backend in the title.
  - Values: `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`.env.example`; the web fallbacks are at `apps/app/src/lib/runtime.web.client.ts:16-19`). Dev builds read the env files; release builds bake both with `option_env!`.
  - Identity constants (assumption 5): bundle id `com.moduo.native` / `com.moduo.native.dev`, Keychain service `com.moduo.native.auth` / `.dev.auth`, data folder `~/Library/Application Support/<bundle id>/` with per-person subfolders created on demand.
  - Tokio bridge: one multi-thread runtime owned by the app; `spawn_io(fut) -> gpui::Task<T>` runs the future on tokio and resolves on GPUI's foreground executor. Zed's `crates/gpui_tokio` (about 100 lines, Apache-2.0) is the pattern; it is not in the `gpui-pre` set, so write ours.
  - Logging: `tracing` to stderr in dev and to a rotating file in the data folder; never log tokens or email addresses.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - The publishable key is public by design (gitleaks allows `sb_publishable_`, `.gitleaks.toml:9-12`); the session tokens are not, and the repo is public (rule 2).
  - A cloud run changes production data: show the backend in the window title and a red strip on cloud, as the spike did.
  - GPUI's executor is not tokio: a `reqwest` call awaited on it panics. Everything networked goes through the bridge.
  - Every `.rs` file stays under 32 KB (`scripts/ci/ratchets.ts:32`).
- **Not in this block:** Auth (NF-24), any Supabase call (NF-25).

### NF-7 · Gallery and interaction base

- **Goal:** A `moduo-gallery` window lists pages with appearance switches, the kit's theme is driven from `moduo-tokens`, and `moduo-ui` has the shared styling every primitive needs: state layer, focus ring, hit area, motion, the floating-surface and selection recipes.
- **Acceptance criteria:** AC3 — theme, shade, accent, density, radius, font and motion switch live. AC5 (its part) — a focus ring only on keyboard focus. AC8 — the boundary test bites.
- **Tests:** `crates/ui/tests/appearance.rs` · "a density switch re-lays every primitive"; `crates/ui/tests/focus.rs` · "the ring shows on Tab, not on click"; `crates/ui/tests/motion.rs` · "reduced motion turns movement into a fade"; `tests/boundaries.rs` · "no design literals outside moduo-tokens".
- **Start here:**
  - Theme bridge: an `Appearance` global in `moduo-ui`; on change, resolve tokens and push them into the kit (`Theme::apply_semantic_config_str` or the theme fields: colours, `font_family`, `font_size`, `radius`, `shadow`), then refresh every window.
  - State layer: `tokens.css:418-530` and the ladder in `docs/DESIGN_RULES.md:87-93` (hover, active, selected; a filled control hovers one step up). One helper: `.interactive(Tone)` adds hover, active, disabled (50 %) and the focus ring.
  - Focus ring: ring colour `--ring`, shown with GPUI's `focus_visible`; 4 px room where a parent clips (`.claude/rules/tasks-ui.md:35`).
  - Hit area: at least 24×24 (`apps/app/src/global.css:596-606`, `tokens.css:542`).
  - Motion: durations and easings at `tokens.css:903-963`; the four patterns at `global.css:376-470` (`motion-key`, `motion-panel`, `motion-pop`, `motion-row`) and `check-pop` at :258-287, on GPUI `Animation`. Rules: `DESIGN_RULES.md:44-49`.
  - Recipes: `apps/app/src/components/ui/surface.ts:11-21` (floating surface), `selection.ts:10-15` (selected row and option).
  - Gallery: `crates/gallery` (bin), sidebar of pages, a top strip with the seven switches, a `Page` trait each primitive block implements; first page "Tokens" (swatches, type scale, spacing, radius, shadows, icon ladder). Root script `native:gallery`.
  - Boundary test: scan `crates/*/src` outside `ui` for `gpui_kit` and outside `tokens` for `rgb(`, `hsla(`, `rgba(`, `px(<number>)`.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - GPUI has no CSS transitions: every animation is explicit; skip movement under reduced motion.
  - Accent is for the primary action, selection and focus only (`DESIGN_RULES.md:34-42`).
  - Read the kit and GPUI API from the pinned sources (docs.rs for `gpui-kit 0.11.0` and `gpui-pre`), not from memory: both change weekly. Never bump them in this block.
  - Every `.rs` file stays under 32 KB (`scripts/ci/ratchets.ts:32`).
- **Not in this block:** Any concrete primitive beyond what the Tokens page needs.

### NF-8 · Static primitives

- **Goal:** Eleven display-only primitives exist in `moduo-ui` with gallery pages: Kbd, Separator, Label, Eyebrow, Badge, DetailTitle, EmptyState, CollectionHeader, MetaCount, Progress, Skeleton.
- **Acceptance criteria:** AC4 — each has the variants and sizes of its React counterpart and is shown in the gallery at three densities.
- **Tests:** `crates/ui/tests/static_primitives.rs` · "renders every variant and size" (one case per primitive) · "a label press focuses its control" · "the skeleton stops pulsing under reduced motion".
- **Start here:**
  - Kbd ← `apps/app/src/components/ui/kbd.tsx:10`; Separator ← `apps/app/src/components/ui/separator.tsx:6` (orientation); Label ← `apps/app/src/components/ui/label.tsx:6`.
  - Eyebrow ← `apps/app/src/components/ui/eyebrow.tsx:32` — tone default, muted, tag, strong, inherit (:33-43); uppercase 11 px, fixed chrome only (`docs/DESIGN_RULES.md:79`, R12).
  - Badge ← `apps/app/src/components/ui/badge.tsx:7` — variants default, secondary, destructive, outline, success, warning, info (:17-28).
  - DetailTitle ← `apps/app/src/components/ui/detail-title.tsx:26` — size rail, lead, page (:27-36).
  - EmptyState ← `apps/app/src/components/ui/empty-state.tsx:30` — size page, inline (:18).
  - CollectionHeader ← `apps/app/src/components/ui/collection-header.tsx:19`; MetaCount ← `apps/app/src/components/ui/meta-count.tsx:25` (tabular numbers).
  - Progress ← `apps/app/src/components/ui/progress.tsx:36` — size sm, md (:32), width animates on `--motion-fast` (:57).
  - Skeleton ← `apps/app/src/components/ui/skeleton.tsx:10` — pulse, off under reduced motion.
  - API shape to set for every later primitive: a builder (`Badge::new("…").variant(BadgeVariant::Success)`) implementing `IntoElement` / `RenderOnce`, enums for variants and sizes, no stringly-typed options; a `role` and label for accessibility where the React one has one.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - Sentence case; people's words shown as typed (`DESIGN_RULES.md:63`, R8). Three text levels only: foreground, muted, subtle (:76, R11).
  - Radius by role (`DESIGN_RULES.md:20-23`): md for controls and rows, lg for cards, xl for panels and dialogs, full for pills.
  - A primitive is done only when its gallery page shows every variant, size and state at three densities.
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
- **Not in this block:** Card, Tabs, ScrollArea, WaitOrb, Field, TagInput, Reactions, Slider, HoverCard: not needed by the shell or Tasks (Out of scope).

### NF-9 · Buttons and toggles

- **Goal:** Button, CompleteToggle, Checkbox, Switch and RadioGroup exist with every variant, size and state, keyboard included.
- **Acceptance criteria:** AC4 — variants, sizes and the states default, hover, keyboard focus, active, disabled, plus loading and pressed for Button. AC5 (its part) — Space and Enter activate; arrows move inside a radio group.
- **Tests:** `crates/ui/tests/button.rs` · "renders every variant and size" · "disabled ignores press and keys" · "Space and Enter fire once" · "pressed shows the toggle fill"; `crates/ui/tests/toggles.rs` · "checkbox and switch toggle on Space" · "radio arrows move and select" · "the complete toggle pops once".
- **Start here:**
  - Button ← `apps/app/src/components/ui/button.tsx:7` — variant default, secondary, outline, ghost, destructive, link; size sm, md, lg, icon (:18-46); `aria-pressed` toggle fill, `aria-invalid`, disabled at 50 %, colour change on `--motion-fade`.
  - Control heights: `--ctrl-h-sm`, `--ctrl-h`, `--ctrl-h-lg`; the font stays 14 px on every rung; icon `size-icon-sm` (`docs/DESIGN_RULES.md:9-18`, R1). Density values: `apps/app/src/styles/tokens.css:562-642`.
  - CompleteToggle ← `apps/app/src/components/ui/complete-toggle.tsx:20` with `check-pop` (`apps/app/src/global.css:258-287`), the one delight animation.
  - Checkbox ← `apps/app/src/components/ui/checkbox.tsx:7`; Switch ← `apps/app/src/components/ui/switch.tsx:6` (size sm, default at :11; the thumb slides, :31-34); RadioGroup ← `apps/app/src/components/ui/radio-group.tsx:7`.
  - Build on the kit's `Button`, `Checkbox`, `Switch`, `Radio` where their behaviour fits and restyle from tokens; where a kit component cannot express a variant, write the element on `div()` with `.interactive(…)` from NF-7.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - A filled control hovers one step up the state ladder (active → active-hover), it does not get a translucent overlay (`DESIGN_RULES.md:87-93`).
  - Loading keeps the button's width: the label stays laid out and the spinner replaces the icon.
  - One primary (accent) action per surface (`DESIGN_RULES.md:34-42`).
  - A primitive is done only when its gallery page shows every variant, size and state at three densities.
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
  - Read the kit and GPUI API from the pinned sources (docs.rs for `gpui-kit 0.11.0` and `gpui-pre`), not from memory: both change weekly. Never bump them in this block.
- **Not in this block:** IconButton (it needs Tooltip, NF-11). SegmentedControl (NF-13).

### NF-10 · Text fields

- **Goal:** Input, NumberInput and Textarea exist on one field recipe, with a draft mode that commits on blur or Enter and restores on Esc, and input-method composition works.
- **Acceptance criteria:** AC7 — text fields support typing, selection, copy and paste, undo, and input-method composition; a draft commits on blur or Enter and is dropped on Esc. AC4 (its part) — variants filled, ghost, bare; sizes sm, md.
- **Tests:** `crates/ui/tests/input.rs` · "type, select, copy, paste, undo" · "marked text commits once" · "blur and Enter commit, Esc restores" · "number input steps with arrows and clamps" · "renders every variant and size"; `crates/ui/tests/textarea.rs` · "grows with its content up to the cap".
- **Start here:**
  - Recipe: `apps/app/src/components/ui/field-shell.ts:29-64` (variants at :39-52, `FIELD_FOCUS_WITHIN`).
  - Input ← `apps/app/src/components/ui/input.tsx:14` — size sm, md (:9-11); `useDraftField` commits on blur and Enter; `NumberInput` steps on Up and Down and clamps (:171-179).
  - Textarea ← `apps/app/src/components/ui/textarea.tsx:12`; the auto-growing composer is in `feed.tsx:146-201` (the Feed itself is NF-21).
  - Engine: the kit's `Input` / `InputState` (the spike used them: `git show FETCH_HEAD:apps/gpui-spike/src/main.rs` lines 15, 48-60, with `InputEvent::PressEnter`). Wrap them: `TextField` owns an `Entity<InputState>`, exposes `on_commit`, `on_cancel`, `on_change`.
  - GPUI's raw path, if the kit falls short: `EntityInputHandler` + `window.handle_input` (Zed `crates/gpui/examples/input.rs`).
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - Composition: marked text must show inline and commit exactly once. The kit says its test path "does not model complete OS IME composition", so besides the unit test, type "zażółć" with Option keys and one CJK phrase by hand and note it in the PR.
  - A plain key typed into a field must never reach a shortcut (the registry of NF-28 relies on the field owning focus).
  - Enter in a single-line draft commits; in a Textarea it adds a line and ⌘Enter commits.
  - A primitive is done only when its gallery page shows every variant, size and state at three densities.
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
  - Read the kit and GPUI API from the pinned sources (docs.rs for `gpui-kit 0.11.0` and `gpui-pre`), not from memory: both change weekly. Never bump them in this block.
- **Not in this block:** Rich text, mentions and tokens in text (the editor spike, spec 3). TagInput.

### NF-11 · Floating layer, Tooltip, Popover, IconButton

- **Goal:** One anchored-overlay engine in `moduo-ui` (side, align, offset, collision flip, dismissal, focus return, stacking) and its first users: Tooltip, Popover and IconButton.
- **Acceptance criteria:** AC6 — floating surfaces open on the asked side and alignment, flip when they would leave the window, stack in token order, and close on Esc or an outside press. AC5 (its part) — Esc closes only the topmost surface and focus returns to what opened it.
- **Tests:** `crates/ui/tests/floating.rs` · "flips at the window edge and stays inside" · "outside press closes; press inside does not" · "Esc closes the top surface and returns focus" · "nested surfaces close innermost first"; `crates/ui/tests/tooltip.rs` · "opens after the delay, at once when another was just open"; `crates/ui/tests/icon_button.rs` · "the label is the tooltip and the accessible name".
- **Start here:**
  - GPUI pieces: `anchored()` with `snap_to_window` and `deferred().with_priority(n)` (Zed `crates/gpui/examples/popover.rs`); the kit's `Popover` and `Tooltip` for behaviour to reuse.
  - Surface look: `apps/app/src/components/ui/surface.ts:11` (fill, 1 px hairline, radius md, `motion-pop` from the anchor point, `apps/app/src/global.css:407-433`).
  - Tooltip ← `apps/app/src/components/ui/tooltip.tsx:8` — delay 150 ms (:8-18), offset 6, arrow, `--z-tooltip`, `--shadow-md`.
  - Popover ← `apps/app/src/components/ui/popover.tsx:8` — offset 4, side and align, auto-focus on open and return on close; a `container` option (:29) so a popover can live inside a dialog.
  - IconButton ← `apps/app/src/components/ui/icon-button.tsx:26` — size sm, md (:14), `tooltipSide`; `label` is required.
  - Z order tokens: `apps/app/src/styles/tokens.css:964-984`.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - Esc and an outside press are different closes: only Esc and explicit close return focus to the trigger; an outside press leaves focus where the press landed (`.claude/rules/ui-radix.md:12-20`).
  - A surface opened without a trigger (from a key) restores focus to what had it before.
  - One surface style for everything that floats (`docs/DESIGN_RULES.md:83-85`, R13).
  - A primitive is done only when its gallery page shows every variant, size and state at three densities.
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
  - Read the kit and GPUI API from the pinned sources (docs.rs for `gpui-kit 0.11.0` and `gpui-pre`), not from memory: both change weekly. Never bump them in this block.
- **Not in this block:** Menus (NF-12), dialogs (NF-14), HoverCard.

### NF-12 · Menus

- **Goal:** DropdownMenu and ContextMenu exist on the floating layer, built from one menu kit: items, checkbox and radio items, labels, separators, submenus, shortcuts, destructive items.
- **Acceptance criteria:** AC5 (its part) — menus move with arrows, jump by typing, open submenus with Right, and Esc returns focus. AC6 (its part) — a context menu opens at the pointer and stays inside the window.
- **Tests:** `crates/ui/tests/menu.rs` · "arrows, typeahead, submenu, Esc returns focus" · "Left closes a submenu only" · "a checkbox item toggles and keeps the menu open when asked" · "an action that opens a dialog runs after the menu has closed" · "a long menu scrolls and fades its lower edge" · "a context menu opens at the pointer".
- **Start here:**
  - DropdownMenu ← `apps/app/src/components/ui/dropdown-menu.tsx:24` — item variant default, destructive (:78); submenus :185-230; offset 4.
  - ContextMenu ← `apps/app/src/components/ui/context-menu.tsx:25` — the same parts anchored at the pointer (:133).
  - Scroll fade: `apps/app/src/components/ui/menu-scroll.ts:9-49` and `apps/app/src/global.css:584`; sizes `surface.ts:19-21`.
  - One description, two renderers: `apps/app/src/components/ui/nav-row.tsx:72-114` (`MenuKit`) renders the same items as a dropdown or a context menu. Make that the native API: `MenuModel` (a list of `MenuItem` enums with id, label, icon, shortcut, checked, destructive, disabled, children) plus `dropdown(trigger, model)` and `context_menu(area, model)`.
  - The kit has `PopupMenu` and a native `NSMenu` path; use the drawn one (tokens, typeahead, submenus must match the web app).
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - A menu item that opens a focus-taking surface only records the action; it runs when the menu has finished closing (`.claude/rules/ui-radix.md:12-20`).
  - Typeahead matches the visible label from the first letter and resets after a pause; it must not fire while a submenu's text field has focus.
  - Selected option styling is `SELECTED_OPTION` (`selection.ts:15`), not the accent fill.
  - A primitive is done only when its gallery page shows every variant, size and state at three densities.
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
- **Not in this block:** The macOS menu bar (NF-29). Select (NF-13).

### NF-13 · Select, SegmentedControl, Toolbar

- **Goal:** A roving-focus helper and the three primitives built on it: Toolbar (with Group, Spacer, Primary), SegmentedControl and Select.
- **Acceptance criteria:** AC5 (its part) — a toolbar is one Tab stop with arrow keys inside; a nested roving widget counts as one stop. AC4 (its part) — sizes and variants as in React.
- **Tests:** `crates/ui/tests/toolbar.rs` · "one Tab stop, arrows move, a nested group counts once" · "Home and End jump"; `crates/ui/tests/segmented.rs` · "arrows move the choice; one is always chosen"; `crates/ui/tests/select.rs` · "opens under the trigger at least as wide" · "typeahead picks" · "the chosen item carries the check".
- **Start here:**
  - Roving focus: `apps/app/src/components/ui/toolbar.tsx:90-279` (`useRovingFocus`: Left, Right, Home, End; nested widgets at :227-252). Port it as one helper used by Toolbar, SegmentedControl, RadioGroup (NF-9) and menus.
  - Toolbar ← `apps/app/src/components/ui/toolbar.tsx:21` — gap tight, snug, default, row (:21-35); `ToolbarGroup` :321, `Spacer` :335, `Primary` :339. The grammar: title and count, then Search · Filter · Display, the view switch, one primary.
  - SegmentedControl ← `apps/app/src/components/ui/segmented-control.tsx:49` — size xs, sm, default (:28); single choice (:63-64); optional tooltip per segment.
  - Select ← `apps/app/src/components/ui/select.tsx:11` — trigger size sm, default and field variant (:33-35); list aligned to the trigger start and at least its width (:66-67); scroll buttons (:161-193); check mark on the chosen item.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - The toolbar rule is written down at `.claude/rules/ui-radix.md:42`; a control row never lives outside a Toolbar (`docs/DESIGN_RULES.md:9-18`).
  - Size xs is only for section-header switches.
  - A primitive is done only when its gallery page shows every variant, size and state at three densities.
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
- **Not in this block:** Tabs. The view switcher of Tasks (spec 2).

### NF-14 · Modal layer

- **Goal:** Dialog, AlertDialog and Sheet exist on one modal layer: scrim, focus trap, layered Esc, focus return.
- **Acceptance criteria:** AC5 (its part) — a dialog keeps focus inside; Esc closes only the topmost surface and focus returns to what opened it. AC6 (its part) — an outside press closes a Dialog, never an AlertDialog.
- **Tests:** `crates/ui/tests/dialog.rs` · "Tab cycles inside; Esc closes the top one only" · "focus returns to the opener" · "an outside press closes a dialog and not an alert dialog" · "a popover inside a dialog opens above it"; `crates/ui/tests/sheet.rs` · "slides from each of four sides and fades under reduced motion".
- **Start here:**
  - Dialog ← `apps/app/src/components/ui/dialog.tsx:7` — overlay fade, `motion-pop`, `--z-dialog`, `--shadow-overlay`, close button; presses on a toast do not count as outside (:71-78).
  - AlertDialog ← `apps/app/src/components/ui/alert-dialog.tsx:13` — action variant default, destructive (:126).
  - Sheet ← `apps/app/src/components/ui/sheet.tsx:7` — side top, right, bottom, left (:51); slides on `--motion-slow` (:61-69).
  - Scrim tokens: `apps/app/src/styles/tokens.css:690-699`. Radius xl for dialogs.
  - The kit has `Dialog` and `Sheet` hosted by its `Root` view; reuse the hosting, restyle from tokens. Expose `open_dialog(cx, |d| …)` returning a handle with `close()`.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - A dialog opened from a menu item opens after the menu closed (NF-12), or focus lands nowhere.
  - The toast exception needs the toast host (NF-15); leave a hook: the modal layer asks "is this press inside a registered pass-through region?".
  - Never block the main thread waiting for a dialog answer; the result arrives as a callback or a task.
  - A primitive is done only when its gallery page shows every variant, size and state at three densities.
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
  - Read the kit and GPUI API from the pinned sources (docs.rs for `gpui-kit 0.11.0` and `gpui-pre`), not from memory: both change weekly. Never bump them in this block.
- **Not in this block:** Command dialog (NF-16), toasts (NF-15).

### NF-15 · Toasts

- **Goal:** A toast host at the bottom right: stacked, timed, with an action (Undo), pressable over dialogs, callable from anywhere as `toast(cx, …)` and `undo_toast(cx, title, on_undo)`.
- **Acceptance criteria:** AC6 (its part) — a toast stays pressable over a dialog and pressing it does not close the dialog. AC4 (its part) — kinds default, success, error, with an optional action and description.
- **Tests:** `crates/ui/tests/toast.rs` · "a toast press over a dialog reaches the toast and keeps the dialog" · "toasts stack newest on top and leave after their time" · "hovering pauses the timer" · "Undo runs once and dismisses".
- **Start here:**
  - React side: `apps/app/src/components/ui/sonner.tsx:13-57` (bottom right at :22, token colours, `--z-toast`), mounted in `apps/app/src/main.tsx:76-90`.
  - The Undo grammar is one helper: `apps/app/src/lib/undo-toast.tsx` (`undoToast`, `UNDO_TOAST_MS`: neutral voice, Undo as the action), called as in `apps/app/src/features/tasks/commands/bulk.ts:110,292`.
  - The kit has a `Notification` list on `Root`; use it if position, stacking and the action button can match, else draw the host as a deferred layer above the modal layer.
  - The pass-through hook from NF-14 registers the host's bounds.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - Toast text is sentence case and names the thing ("Task deleted"); an error toast carries the server's message when it has one.
  - Under reduced motion toasts fade, they do not slide.
  - A primitive is done only when its gallery page shows every variant, size and state at three densities.
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
- **Not in this block:** System notifications (spec 5).

### NF-16 · Command

- **Goal:** A filtered command list (input, groups, items, empty state) and its dialog form, with the filter and ranking of the web app.
- **Acceptance criteria:** AC5 (its part) — typing filters, arrows move with wrap-around, Enter runs the item, Esc closes. AC4 (its part) — groups, separators, shortcuts on the right, an empty state.
- **Tests:** `crates/ui/tests/command.rs` · "filters on keywords, not ids" · "ranks a prefix above a scattered match" · "arrows wrap; Enter runs the highlighted item" · "an empty filter shows the empty state" · "with the built-in filter off, the caller's order is kept".
- **Start here:**
  - Command ← `apps/app/src/components/ui/command.tsx:14` — a wrapper over `cmdk`; `CommandDialog` at :27-40.
  - Filter rule: `.claude/rules/ui-radix.md:32` (keywords, not ids). The web palette turns cmdk's filter off and filters by label itself (`apps/app/src/components/app/global-command-palette.tsx:423-500`), so the native list needs both modes.
  - Ranking: port cmdk's `command-score` behaviour for the built-in mode (prefix, word start, then scattered letters); write the cases as table tests first.
  - Row look: the selected item uses `SELECTED_OPTION` (`apps/app/src/components/ui/selection.ts:15`).
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - The input keeps focus while arrows move the highlight; the list never takes focus.
  - Long lists must not lay out every item: use GPUI `uniform_list` when items share a height.
  - A primitive is done only when its gallery page shows every variant, size and state at three densities.
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
- **Not in this block:** The global command palette and search (spec 5).

### NF-17 · Rows, cards, headers, drag visuals

- **Goal:** The list building blocks exist: Row (with RowColumns, RowLead, RowTitle, RowMeta), ItemCard, GroupHeader, PropertyRow and the drag visuals (insertion line, nest preview, overlay surface, sorted note, source and target states).
- **Acceptance criteria:** AC4 — each has the variants and states of its React counterpart, including selected, drag source and drop target, at three densities.
- **Tests:** `crates/ui/tests/row.rs` · "selected is a tint and an inset ring, never a bar" · "hover actions keep their space" · "titles give way first when narrow"; `crates/ui/tests/group_header.rs` · "the chevron turns; a press folds"; `crates/ui/tests/drag_visuals.rs` · "renders every variant" (line at an edge, line with indent, nest preview, overlay).
- **Start here:**
  - Row ← `apps/app/src/components/ui/row.tsx:38` and ItemCard ← `apps/app/src/components/ui/item-card.tsx:35` — both use `selection.ts:10` (`SELECTED_ROW`) and the drag states.
  - GroupHeader ← `apps/app/src/components/ui/group-header.tsx:49` — chevron rotation on `--motion-fast` (:69); actions revealed on hover by opacity (:123).
  - PropertyRow ← `apps/app/src/components/ui/property-row.tsx:29` — align center, start (:16).
  - Drag visuals ← `apps/app/src/components/ui/drag-visuals.tsx:29` — `DRAG_SOURCE` (40 % opacity), `DROP_TARGET` :35, `InsertionLine` edge and indent :52, `NestPreview`, `DragOverlaySurface`, `SortedNote`.
  - Row height and padding: `--row-h`, `--pad-x`, `--pad-y` per density (`apps/app/src/styles/tokens.css:562-642`).
  - Design anchors: `.design/tasks-polish/BRIEF.md:141-163` (stable row grid, no hover reflow).
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - A hover reveal reserves its space and fades; nothing shifts (`docs/DESIGN_RULES.md:44-49`).
  - Text is never rotated; titles truncate before metadata does (`.design/tasks-v3/REPLAN.md:1165`, rules 42 and 46a).
  - GPUI redraws a whole entity on `cx.notify()`: keep rows and cells plain elements built from facts, and give a primitive its own entity only when it holds state (open, draft, focus).
  - A primitive is done only when its gallery page shows every variant, size and state at three densities.
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
- **Not in this block:** Drag behaviour (spec 2). The Tasks row and its cells (spec 2).

### NF-18 · Avatars and chips

- **Goal:** The Avatar family (Avatar, PersonAvatar, AvatarGroup, PresenceBadge, AppAvatar, TeamMark) and Chip with PickerPill exist.
- **Acceptance criteria:** AC4 — sizes and variants as in React; a person without a picture gets initials on a hue that is the same on every device.
- **Tests:** `crates/ui/tests/avatar.rs` · "the hue for an id equals the web app's" (vectors taken from `avatarHue`) · "falls back to initials when the image fails" · "a group shows the overflow count"; `crates/ui/tests/chip.rs` · "renders every size and shape" · "the remove button has a 24 px hit area" · "a picker pill opens a menu or a popover".
- **Start here:**
  - Avatar ← `apps/app/src/components/ui/avatar.tsx:11` — size default, sm, lg, icon, feed (:18); fills at :188-216; `avatarHue` :173 over 6 hues (:168); `PresenceBadge` :97; `PersonAvatar` :244; `AppAvatar` :314; `TeamMark` :360.
  - Chip ← `apps/app/src/components/ui/chip.tsx:72` — size sm, xs; shape md, full; active; interactive (:49-60); `PickerPill` kind menu or popover, align (:187-190).
  - Images: GPUI `img()` loads remote pictures through the app's HTTP client (`cx.set_http_client`); set it once in `moduo-app` over the tokio bridge of NF-6.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - Port `avatarHue` bit for bit (string hash and modulo): generate the test vectors by running the TypeScript function on ten ids and pasting the results.
  - Avatar pictures come from Supabase storage with signed or public URLs; never log them.
  - A primitive is done only when its gallery page shows every variant, size and state at three densities.
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
- **Not in this block:** Presence data itself (spec 8).

### NF-19 · NavRow

- **Goal:** The rail row exists: icon or mark, label, count, trailing actions, a menu that is both its "more" dropdown and its context menu, inline rename, drop-target state; plus NavSectionHeader.
- **Acceptance criteria:** AC4 — the row's states (default, hover, current, drop target, renaming, disabled). AC5 (its part) — F2 or a double press renames, Enter saves, Esc cancels, and focus goes back to the row.
- **Tests:** `crates/ui/tests/nav_row.rs` · "F2 and double press start a rename; Enter saves; Esc restores" · "the same menu opens from the button and from a right press" · "current uses the neutral active state, not the accent" · "focus returns to the row after a menu or a rename".
- **Start here:**
  - NavRow ← `apps/app/src/components/ui/nav-row.tsx:94` (743 lines) — item variant default, destructive (:58); `MenuKit` :72-114; rename at :395 and :522-525; `restoreNavFocus` / `focusNavRow`; `NavSectionHeader` with its own context menu :682.
  - Depends on the menu model of NF-12, the text field of NF-10 and the drag states of NF-17.
  - Biggest user: the Tasks rail, `apps/app/src/features/tasks/ui/bucket-rail.tsx:483-673` (17 Tasks files import it).
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - The current destination uses neutral `state-active`; accent is not for navigation (`docs/DESIGN_RULES.md:34-42`).
  - A rename that loses focus commits; an empty name restores the old one.
  - The file is 743 lines in React: split the native one (row, rename, section header) to stay well under 32 KB.
  - A primitive is done only when its gallery page shows every variant, size and state at three densities.
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
- **Not in this block:** Sorting rows by drag (spec 2).

### NF-20 · Calendar and DateField

- **Goal:** A month-grid Calendar and the DateField built on it: typed date and time entry, a picker popover, draft, commit and cancel.
- **Acceptance criteria:** AC4 — variants ghost, outline, property. AC5 (its part) — arrows move by day and week in the grid, Up and Down nudge a typed date, Esc cancels and restores.
- **Tests:** `crates/ui/tests/calendar.rs` · "the week starts on the region's day" · "arrows move by day and week; PageUp and PageDown by month"; `crates/ui/tests/date_field.rs` · "typing a date commits on Enter" · "Esc restores the value and closes once" · "Up and Down nudge by a day" · "time parses 9, 9:30, 930, 9pm".
- **Start here:**
  - Calendar ← `apps/app/src/components/ui/calendar.tsx:15` (react-day-picker); week start follows the time region.
  - DateField ← `apps/app/src/components/ui/date-field.tsx:16` (451 lines) — variant ghost, outline, property (:39); `useDateDraft` (draft, commit, cancel, the double-close guard); `TimeInput` parse and format; nudges :196-206; Esc :435; `DatePickerPanel` renders in place.
  - The kit has `Calendar` and `DatePicker`; use its grid if week start, keyboard and styling can match, else draw the 6×7 grid with `div()`.
  - Date grammar (one way to write dates everywhere): `.design/tasks-v3/REPLAN.md:1165`, rule 41. Dates use the `jiff` crate (the spike's choice): civil dates for due days, zoned instants for times.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - A due day is a calendar day, not an instant: never convert it through UTC (`apps/app/src/lib/task-rows.ts:88-127`, `localDayOf`, `dueOnToLocalInstant`).
  - Closing the popover and committing can both fire: commit exactly once.
  - A primitive is done only when its gallery page shows every variant, size and state at three densities.
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
  - Read the kit and GPUI API from the pinned sources (docs.rs for `gpui-kit 0.11.0` and `gpui-pre`), not from memory: both change weekly. Never bump them in this block.
- **Not in this block:** Natural-language dates ("fri", "next week"): capture parsing in spec 2. Recurrence pickers (spec 2).

### NF-21 · FilterBar, DisplayMenu, Feed

- **Goal:** The two toolbar composites and the feed exist, with the filter model ported as pure Rust.
- **Acceptance criteria:** AC4 — FilterBar (button, chips, menu), DisplayMenu and Feed (items, composer) match React. AC5 (its part) — the filter menu is keyboard-complete.
- **Tests:** `crates/ui/tests/filter_model.rs` · the filter-model cases of `apps/app/src/components/ui/filter-bar.test.tsx` ported, plus one case per operator; `crates/ui/tests/filter_bar.rs` · "pick a field, an operator and a value by keyboard" · "a chip removes its condition"; `crates/ui/tests/display_menu.rs` · "compacts when narrow"; `crates/ui/tests/feed.rs` · "the composer grows and sends on cmd-Enter".
- **Start here:**
  - Pure logic first: `apps/app/src/components/ui/filter-model.ts:14-221` (operators, `matchesFilters`, `describeCondition`).
  - FilterBar ← `apps/app/src/components/ui/filter-bar.tsx:62` (526 lines) — `FilterButton`, `FilterChip`, `FilterMenu`; keyboard at :183; align :120; built from Command, DropdownMenu, Popover, Kbd.
  - DisplayMenu ← `apps/app/src/components/ui/display-menu.tsx:117` (282 lines) — Popover with SegmentedControl, Select and Separator; compacts by container width (:144).
  - Feed ← `apps/app/src/components/ui/feed.tsx:23` — composer variant outline, filled (:146), input size sm, md (:183).
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - Container queries do not exist in GPUI: read the measured width (a `canvas` prepaint or the kit's size hook) and pick the compact layout from it.
  - Filter values are data from the caller (people, tags, statuses); the bar knows nothing about Tasks.
  - A primitive is done only when its gallery page shows every variant, size and state at three densities.
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
  - Every `.rs` file stays under 32 KB (`scripts/ci/ratchets.ts:32`).
- **Not in this block:** Tasks' filter dimensions and saved views (spec 2). Reactions.

### NF-22 · Resizable panels and pane scroll

- **Goal:** A horizontal panel group with draggable separators, minimum sizes and a size-changed callback, and the scroll styling every pane uses.
- **Acceptance criteria:** AC11 (its part) — three resizable panels, left at least 240, right at least 280. AC4 (its part) — scrollbars are thin and token-coloured everywhere.
- **Tests:** `crates/ui/tests/resizable.rs` · "a drag resizes and stops at the minimums" · "the separator grabs over 16 px inside an 8 px gap" · "a hidden panel gives its space back" · "sizes are reported once per drag end"; `crates/ui/tests/scroll.rs` · "the gutter is stable whether or not content overflows".
- **Start here:**
  - Resizable ← `apps/app/src/components/ui/resizable.tsx:24` — react-resizable-panels; `resizeTargetMinimumSize` (:37).
  - How the shell uses it: `apps/app/src/components/app/feature-panels-shell.tsx:56-57` (minimums) and :269-300 (persisted sizes).
  - Scrollbars: `apps/app/src/global.css:513-540` (thin, `--scroll-thumb`), `.pane-scroll` :564 (stable gutter), `.no-scrollbar` :550. Rule: `docs/DESIGN_RULES.md:95`, `.claude/rules/ui-css.md:11-19`.
  - Panel frame tokens never change with density: `--panel-pad` 8, `--panel-inset` 16, `--panel-gap` 8 (`DESIGN_RULES.md:51-61`, R7).
  - The kit has `resizable` panels and `Scrollable`; reuse if minimums and the wide grab area can match.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - `pane-scroll` goes on the element that scrolls, never on a wrapper.
  - Resizing must not re-measure a virtual list on every pointer move: report widths, let the list relayout once per frame.
  - A primitive is done only when its gallery page shows every variant, size and state at three densities.
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
- **Not in this block:** Persisting sizes (NF-30).

### NF-23 · VirtualStack

- **Goal:** A virtual list for mixed-height items: measured heights from estimates, one sticky header for the group in view, a pinned item, and scroll-to-key.
- **Acceptance criteria:** AC4 (its part) — the list primitive behaves as the React `VirtualStack`: 10,000 items scroll smoothly, the current group's header stays at the top, a row asked for by key scrolls into view.
- **Tests:** `crates/ui/tests/virtual_stack.rs` · "only items near the viewport are built" · "a measured height replaces its estimate without a jump" · "the active group header sticks and hands over at the next group" · "scroll_to(key) reveals the item once per request" · "a pinned item stays mounted off screen" · "below the threshold everything renders in flow".
- **Start here:**
  - React source: `apps/app/src/features/tasks/ui/virtual-stack.tsx:28-227` — `VIRTUALIZE_FROM = 120` (:43), estimates corrected by measuring, `stickyIndexes` (only the active header sticks, :13-16, :219), `pinned`, `scrollTo{key, seq}`, `scrollMargin` (:71, :137).
  - Estimates used by the Tasks list: header 28, row 34, end 4 (`apps/app/src/features/tasks/ui/task-list-view.tsx:311`).
  - GPUI: `list()` with `ListState` measures variable heights (`splice`, `remeasure_items`, `scroll_to_reveal_item`); `uniform_list` is for equal heights only. The kit has a `VirtualList` with variable sizes. Neither has sticky headers: draw the active header as an overlay at the top of the viewport, chosen from the scroll offset and the group start offsets, and push it up as the next header arrives.
  - Gallery page: 10,000 rows in 40 groups with a frame-time readout.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - Items are keyed by a stable id; a `splice` by index after a reorder loses scroll position.
  - The sticky overlay must take the same press and menu handlers as the in-flow header.
  - Build each row from plain facts: no entity per row (GPUI redraws a whole entity on `cx.notify()`: keep rows and cells plain elements built from facts, and give a primitive its own entity only when it holds state (open, draft, focus).)
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
  - Every `.rs` file stays under 32 KB (`scripts/ci/ratchets.ts:32`).
- **Not in this block:** Drag reordering inside the list, the Tasks row (spec 2).

### NF-24 · Auth core

- **Goal:** The GPUI-free `moduo-auth` crate signs a person in with the emailed code, keeps the session in the Keychain, refreshes it, and tells the app about every change over a channel.
- **Acceptance criteria:** AC9 (its part) — the session lives in the macOS Keychain under the native app's own service; a relaunch restores it; a locked Keychain means signed out; the token is refreshed before it expires and after a 401. AC13 (its part) — a dead refresh token signs out. AC14 — never the Tauri app's Keychain items.
- **Tests:** `crates/auth/tests/otp.rs` · "send, verify, store, restore"; `crates/auth/tests/refresh.rs` · "refreshes before expiry and once after a 401" · "two callers share one refresh" · "a dead refresh token signs out and keeps the outbox hook untouched" · "offline is not a sign-out"; `crates/auth/tests/keychain.rs` · "a locked store reads as signed out"; `crates/auth/tests/copy.rs` · the cases of `otp-send-error` ported.
- **Start here:**
  - Wire calls (GoTrue, as supabase-js makes them from `apps/app/src/lib/runtime.web.auth.ts:242-280`): `POST /auth/v1/otp {email, create_user: true}`; `POST /auth/v1/verify {email, token, type: "email"}`; `POST /auth/v1/token?grant_type=refresh_token {refresh_token}`; `POST /auth/v1/logout`; `GET /auth/v1/user`. Headers: `apikey` and, when signed in, `Authorization: Bearer`.
  - Shapes: `apps/app/src/lib/runtime.types.auth.ts:3-13` (session, the four events). `isNewUser` rule: `runtime.web.auth.ts:261-280`.
  - Keychain: the unused desktop helpers are the model, `apps/desktop/src-tauri/src/keychain.rs:4-48` and `src/auth.rs:5-43` (`keyring` crate, account `"session"`, serde session). Service names from `moduo-config` (NF-6).
  - Error copy: `apps/app/src/components/auth/otp-send-error.ts` (84 lines).
  - API: `Auth::restore()`, `send_code(email)`, `verify(email, code)`, `sign_out()`, `access_token() -> fresh token` (refreshes if within 60 s of expiry), `subscribe() -> Receiver<AuthEvent>` with `Restored | SignedIn | Refreshed | SignedOut{forced}`.
  - Tests run against a small in-process HTTP server that plays GoTrue, and a `SessionStore` trait with a memory double; the real Keychain is covered by one `#[ignore]` test run by hand.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - A missing session while offline is not a sign-out, and neither is a failed refresh caused by the network (`apps/app/src/lib/sync/kernel/registry.ts:11-15`).
  - Never accept a session from a URL; only the code signs in (`apps/app/src/lib/auth-url.ts:1-15`).
  - Sign-up is invite-only and enforced by the server; show its refusal, do not pre-check.
  - Auth and Keychain code is Tier 2 (NF-2): run the `validator` subagent. Never log a token.
- **Not in this block:** Screens (NF-26). Wiping device data on sign-out (NF-31).

### NF-25 · Supabase REST core

- **Goal:** The GPUI-free `moduo-supabase` crate makes PostgREST calls as the signed-in person: a small query builder, `rpc`, typed errors, one retry after a token refresh, the read-only gate, and a fake server for tests.
- **Acceptance criteria:** AC15 (its part) — below the server's minimum build, saves are refused with the web app's message and reads pass. AC9 (its part) — a 401 refreshes the token and retries once.
- **Tests:** `crates/supabase/tests/query.rs` · "select, eq, in, or, order, limit build the same URL as supabase-js" (URLs captured from the web client) · "rpc posts its arguments"; `crates/supabase/tests/errors.rs` · "network failure and server refusal are different errors" · "PGRST116 is NotFound"; `crates/supabase/tests/retry.rs` · "one refresh and one retry after a 401"; `crates/supabase/tests/read_only.rs` · "below the minimum, writes get the read-only refusal and reads pass" · "an unreadable minimum holds nobody back".
- **Start here:**
  - Client set-up to mirror: `apps/app/src/lib/runtime.web.client.ts:16-32` (URL, key, `readOnlyFetch`).
  - Read-only gate: `apps/app/src/lib/min-build.ts:1-60` (`READ_ONLY_MESSAGE`, `parseVersion`, `isBelowMinimum`), the wrapper at :206-224 and the read-RPC allow-list at :103. The native version comes from the repo's `VERSION` file at build time (`docs/decisions/desktop-release.md:23`).
  - Network or refusal: `apps/app/src/lib/sync/network.ts:1-35`.
  - Helpers the data layer will need: `apps/app/src/lib/runtime.web.shared.ts:82-111` (`selectCapped`, `firstRow`) and `apps/app/src/lib/paged-select.ts:22-74` (`PGRST_MAX_ROWS = 1000`, `READ_CAPS`).
  - The spike's `api.rs` (263 lines, `git show FETCH_HEAD:apps/gpui-spike/src/api.rs` after `git fetch origin pull/841/head`) has working calls with blocking `ureq`; redo them on `reqwest` with JSON bodies and `serde` rows.
  - Fake server: an in-process HTTP server with table fixtures and scripted RPC answers, in a `testing` module other crates can use (the Rust twin of `apps/app/src/lib/sync/store.fake.spec.ts`).
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - Every request carries `apikey` and the bearer token; a request without the token reads as an empty list, not an error (`apps/app/src/providers/workspace-provider.tsx:190-193`).
  - Reads are not retried blindly (the web client sends `.retry(false)`); only the 401 path retries.
  - Quote values in `or=(…)` filters as `apps/app/src/lib/sync/kernel/delta.ts:76` (`pgrstQuoted`) does.
  - The service-role key never appears in this app (rule 10).
- **Not in this block:** Realtime, and any Tasks table (spec 2).

### NF-26 · Sign-in screens

- **Goal:** The app starts on "Checking your session…", then shows the email screen or the app; the code screen verifies six digits with a resend countdown.
- **Acceptance criteria:** AC9 (its part) — sign-in is the emailed six-digit code with the web app's wording, resend countdown and errors. AC16 — offline with a stored session the app opens to the shell; offline without one, sign-in says it cannot reach Moduo.
- **Tests:** `crates/app/tests/sign_in.rs` · "email, code, wrong code, resend countdown" · "Enter submits each step" · "the send button is busy once"; `crates/app/tests/offline.rs` · "a stored session opens the shell offline" · "sign-in offline shows the network copy".
- **Start here:**
  - React screens: `apps/app/src/routes/pages/auth-page.tsx:44-78` and `apps/app/src/components/auth/email-auth-panel.tsx` (885 lines): steps `email → otp_sent` (:33, :94-97), send :161, resend countdown :124-136, verify :186-245.
  - The spike's shell is the same state machine in GPUI: `git show FETCH_HEAD:apps/gpui-spike/src/main.rs` (after `git fetch origin pull/841/head`), `enum Screen { Restoring, Email, Code, Pick, Tasks }` at lines 28-34.
  - Screens outside the workspace force the mono accent (`apps/app/src/app/router/route-tree.tsx:48-56`).
  - The window shows after the first frame (`apps/app/src/lib/show-window.ts:11-22`).
  - Uses `moduo-auth` (NF-24) over the tokio bridge, and Button, TextField, Label from `moduo-ui`.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - Copy every string from the React panel, do not rewrite it.
  - Paste of a six-digit code fills the field and verifies; spaces and a dash in the pasted code are ignored.
  - After verify, the next screen is decided by the workspace list (NF-27), not by `isNewUser` alone.
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
- **Not in this block:** Join by invite, the OAuth consent page, the paywall page (web-only flows for now).

### NF-27 · Workspaces and onboarding

- **Goal:** After sign-in the app loads the person's workspaces with their module permissions, picks one, remembers the choice and the list, and creates the first workspace when there is none.
- **Acceptance criteria:** AC10 — the last selected workspace reopens, else the first; with none, one name field creates one; offline, the remembered list is used; an empty answer never replaces a remembered list.
- **Tests:** `crates/app/tests/workspace.rs` · "reopens the last, falls back to the first, creates the first" · "an empty answer keeps the remembered list" · "a remembered workspace that is gone falls back" · "create runs only when the list is still empty" · "permissions none hides the module".
- **Start here:**
  - Provider to port: `apps/app/src/providers/workspace-provider.tsx` (770 lines): boot :604-641, refresh :164-241, permissions :128-137.
  - The read: `apps/app/src/lib/runtime.web.workspace.ts:45-47` (`workspaces` joined with `workspace_members`, not deleted); mapping and the selection key in `apps/app/src/features/workspaces/workspace-mappers.ts:23-25`; the remembered list in `apps/app/src/features/workspaces/remembered-workspaces.ts:9`.
  - Gate: `apps/app/src/routes/layouts/app-gate.tsx:9-16`; onboarding `apps/app/src/routes/pages/onboarding-page.tsx:44-63` (create only if the list is still empty, guarded against a double submit).
  - Port contract: `apps/app/src/lib/runtime.types.workspace.ts` (224 lines) for the row and permission shapes.
  - Store the selection and the remembered list in `workspaces.json` in the data folder, keyed by user id.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - An empty workspace list proves nothing (`workspace-provider.tsx:190-193`).
  - The app never deletes or leaves the last workspace (`.claude/rules/app-shell.md:17`); neither action exists in this block.
  - Never read another person's data through any elevated connection (rule 10): every call is the signed-in person's.
  - The trial bootstrap (`app-gate.tsx:29-75`) is not ported; the web app does it.
- **Not in this block:** The switcher control (NF-29). Members, invites, billing.

### NF-28 · Hotkey registry

- **Goal:** One registry of shortcuts with scopes, used by every later module, plus the helper that turns a binding into its display string.
- **Acceptance criteria:** AC12 — shortcuts come from one registry: the narrowest scope wins, and a key typed into a field does nothing unless the shortcut says it works in fields.
- **Tests:** `crates/app/tests/hotkeys.rs` · "narrowest scope wins; fields swallow plain keys" · "a shortcut marked for fields fires inside one" · "a handled key does not reach a wider scope" · "every binding has a label and a display string" · "no two bindings in one scope share a key".
- **Start here:**
  - Registry: `apps/app/src/lib/hotkeys/registry.ts:74-301` (entries `{scope, label, keys, inInputs?, overrides?}`); global bindings :78-105; modal :108-114; panel :117-122; tasks :125-135.
  - Guard: `apps/app/src/lib/hotkeys/use-app-hotkeys.ts:50-56` and :127; scopes `apps/app/src/lib/hotkeys/scope.tsx:12-46`; display strings `apps/app/src/lib/shortcuts.ts:46-121`.
  - GPUI mapping: a scope is a `key_context` on the view that owns it; a binding is `KeyBinding::new(keys, Action, Some(context))` registered once from the table with `cx.bind_keys`; an action is declared with `actions!` and handled by `on_action`. GPUI dispatches from the focused element outward, which gives "narrowest wins".
  - Keep the table as data (`const BINDINGS: &[Binding]`) so the shortcuts sheet and tooltips read the same source.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - Text fields own plain keys through their own context; never bind a bare letter in a context a field can sit in without the in-fields flag being off.
  - macOS reserves some chords (⌘H, ⌘M, ⌘Q, ⌃⌘F): those belong to the menu (NF-29), not the registry.
  - Port only the global and panel scopes now; module scopes arrive with their modules.
- **Not in this block:** The shortcuts sheet (spec 5). Tasks bindings (spec 2).

### NF-29 · Top bar, module table, native menu

- **Goal:** The signed-in window has the React shell's top bar and a macOS menu, both driven by one module table that today holds one row: Tasks.
- **Acceptance criteria:** AC11 (its part) — top bar (switcher, module tabs from one module table, sync-status slot, avatar menu), ⌘1 for Tasks, and a native menu with Quit, Edit and Window items. AC10 (its part) — the switcher (⌘⇧W) changes workspace.
- **Tests:** `crates/app/tests/chrome.rs` · "tabs come from the module table; cmd-1 selects Tasks" · "a module with permission none has no tab" · "the switcher lists workspaces and switches" · "the right cluster keeps its width with the longest label" · "the menu has Quit, Edit and Window".
- **Start here:**
  - React shell: `apps/app/src/components/app/app-chrome.tsx:514-693`; top bar :521-606 (grid `1fr auto 1fr`, height `--bar-h`); switcher `apps/app/src/components/workspace-switcher.tsx:32,52`; avatar menu `apps/app/src/components/app/status-menu.tsx:95` (only "Log out" and the name for now).
  - Module table: `apps/app/src/components/app/app-chrome-constants.ts:13-49`. One native table row carries: id, label, icon, key (⌘N by position), permission key, panels layout id, and the view constructor. `.claude/rules/app-shell.md:11` lists the six places React has to touch per module; the table replaces all six.
  - Menu: `apps/desktop/src-tauri/src/lib.rs:150-234` (App, File, Edit, View, Window, Help) through GPUI `cx.set_menus`; Edit needs the standard cut, copy, paste, select-all, undo, redo actions wired to text fields.
  - "Loading workspace..." state: `app-chrome.tsx:482-487`.
  - Sync-status slot: an empty element with a fixed place (`app-chrome.tsx:574`); spec 2 fills it.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - The right cluster is about 180 px at a 1024 px window: measure with the longest label (`app-shell.md:15`).
  - Log out must work offline: nothing in the avatar menu waits on a fetch (`app-shell.md:16`).
  - Quit is the system's ⌘Q through the menu; the confirm-before-quit setting is not ported yet.
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
  - GPUI redraws a whole entity on `cx.notify()`: keep rows and cells plain elements built from facts, and give a primitive its own entity only when it holds state (open, draft, focus).
- **Not in this block:** Help, notifications, focus chip, banners, palette, capture (spec 5). Panels (NF-30).

### NF-30 · Panels shell, bottom bar, device preferences

- **Goal:** Each module renders inside a three-panel shell (left rail, centre, right panel) with a bottom bar holding the two panel toggles; sizes, open state, appearance and preferences persist per device.
- **Acceptance criteria:** AC11 (its part) — three resizable panels (left at least 240, right at least 280) whose sizes and open state persist per device, and a bottom bar with both panel toggles. AC3 (its part) — the chosen appearance survives a restart.
- **Tests:** `crates/app/tests/panels.rs` · "sizes and open state persist; minimums hold" · "each module keeps its own layout" · "a toggle hides a panel and gives focus to the centre"; `crates/app/tests/prefs.rs` · "a write is atomic and survives a crash mid-write" · "an unreadable file falls back to defaults" · "appearance applies before the first frame".
- **Start here:**
  - Shell: `apps/app/src/components/app/feature-panels-shell.tsx:120` (389 lines), minimums :56-57, sizes :269-300, the notice slot for strips.
  - Open state: `apps/app/src/features/layout/panel-events.ts:15,35-68`. Bottom bar: `apps/app/src/components/app/app-chrome.tsx:613-687` (toggles :629-640 and :672-685), centre `global-bottom-bar.tsx:134-177` (leave the centre empty).
  - Right panel frame: `apps/app/src/components/app/right-panel.tsx` (title row and body); `title-actions.tsx` is its actions slot.
  - Preferences to keep now: appearance (`apps/app/src/lib/appearance.ts:14-63`; which keys follow the person and which stay on the device at :52), and from `apps/app/src/lib/preferences.ts:250-302` only `reopenLastWorkspace`, `motion` and the last route.
  - Files in the data folder: `appearance.json`, `preferences.json`, `panels.json`; one `DeviceStore<T>` helper: load with defaults, save by write-to-temp then rename, debounce 300 ms.
  - Panels come from NF-22; panel panes use `motion-panel` (NF-7).
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - Density never changes the panel frame (`docs/DESIGN_RULES.md:51-61`).
  - The shell mounts and unmounts during boot and on a workspace switch: state that must survive lives in the app entity, not the shell view (`.claude/rules/app-shell.md:14`).
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
  - Every `.rs` file stays under 32 KB (`scripts/ci/ratchets.ts:32`).
- **Not in this block:** Cloud preference sync, the Settings screen (spec 4).

### NF-31 · Sign-out, lifecycle, minimum build

- **Goal:** Log out works in the right order and survives being offline; a forced sign-out and a deleted account are handled; the "Update Moduo" strip shows below the minimum build.
- **Acceptance criteria:** AC13 — Log out shows the sign-in screen first, then ends the session, removes the Keychain entry and forgets the remembered workspaces; it warns first when changes still wait to sync. A dead refresh token signs out and keeps what waits. AC15 — below the server's minimum build the app shows "Update Moduo", stays readable and refuses saves with the web app's message.
- **Tests:** `crates/app/tests/sign_out.rs` · "navigates first, then clears; warns when writes wait" · "a forced sign-out keeps waiting writes" · "a deleted account signs out on the first profile read" · "log out works offline"; `crates/app/tests/min_build.rs` · "the strip shows below the minimum and cannot be dismissed".
- **Start here:**
  - Order and wipe list: `apps/app/src/providers/auth-provider.tsx:258-279` (sign-out), :190-216 (the `SIGNED_OUT` handler and what a forced one keeps), :60-91 (deleted account: profile read returns PGRST116).
  - The trigger and the warning: `apps/app/src/features/settings/sections/account-section.tsx:290-302` (`waitingSyncCount`).
  - Device data has no owner yet: define a `DeviceData` trait (`waiting() -> usize`, `wipe(user, keep_waiting)`) with a registry in the app; spec 2's store registers itself.
  - Strip: `apps/app/src/components/app/min-build-banner.tsx:9-58`; minimum read from `app_settings.min_build` at boot (`apps/app/src/lib/min-build.ts`); the gate itself is in `moduo-supabase` (NF-25).
  - Unexpected errors: a panic in a view must not leave a dead window; show an error screen with "Reload" (`apps/app/src/components/app/root-error-boundary.tsx`).
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - Navigate first, then sign out; the sign-in screen must tolerate still being signed in for a moment (`.claude/rules/app-shell.md:13`).
  - Stop work in teardown, not on "the user id became empty": the shell goes away without a last render.
  - The update strip names no download yet (there is no native updater): it says to update from the web page; wording is the React banner's.
- **Not in this block:** The updater (spec 12). Analytics consent, time-zone prompt, trial banner.

### NF-32 · Gallery parity review

- **Goal:** Every ported primitive is compared with its Storybook story at three densities, differences are fixed or written down, and the way to live-verify the native app is documented.
- **Acceptance criteria:** AC17 — side by side with Storybook, every ported primitive has no unexplained visual difference at any density.
- **Tests:** Manual, recorded in the PR: one line per primitive with "same" or the difference and its reason. `bun run native:check` stays green after the fixes.
- **Start here:**
  - Storybook: `bun run storybook` (port 6006); stories sit beside each primitive in `apps/app/src/components/ui/`; the three-density helper is `kit-densities.tsx:11`.
  - Gallery: `bun run native:gallery`. Capture each page with `screencapture -x` at comfortable, compact and dense; capture the story at the same size; compare size, spacing, radius, colour, type and the focus ring.
  - Design rules to judge against: `docs/DESIGN_RULES.md` R1 to R13 and `.design/tasks-polish/BRIEF.md:44-122` (control ladder, type roles, icon ladder, accent, motion).
  - Doc: add a "Native app" section to `docs/desktop-live-verify.md` (run by path, `screencapture`, keys through System Events; note whether GPUI elements show up in the accessibility tree) and a native entry in `docs/gotchas/desktop.md:14-16` for any trap found.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - Text rendering differs between WebKit and GPUI (hinting, sub-pixel placement): a one-pixel text shift is expected; a different line height or weight is not.
  - Fix a difference in the token or the primitive, never with a local override in the gallery.
  - This is the last block before Tasks builds on the primitives: anything written down as "different on purpose" needs Maciej's yes; put those under ❓ Needs you in the report.
- **Not in this block:** New primitives. Screenshot tests in CI.

## Out of scope

- Any module's content: Tasks starts in `specs/native-tasks.md`; the others follow the order in *Scope*.
- Primitives neither the shell nor Tasks uses: Card, Tabs, ScrollArea, HoverCard, Slider, TagInput, Field, Reactions, WaitOrb. Each is ported with the first module that needs it.
- Rich text, mentions and reference chips in text (the editor spike).
- The global palette, capture, search, notifications, Help, banners other than "Update Moduo", analytics, the trial bootstrap.
- Settings screens and cloud preference sync; the font picker's extra families.
- Invite join, OAuth consent and paywall pages (they stay web flows).
- Bundling, signing, notarizing, updating and releasing the native app; its Dock icon.
- Windows and Linux; mobile; light-theme tuning (it resolves, nobody tunes it).
- Any change to the React app, the Tauri app or the backend, apart from the two export scripts and their tests.

---

## Definition-of-Ready gate

> **/s2 must not start a block until this is all true.**

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are all filled and unambiguous.
- [x] **Every acceptance criterion has at least one test** in *Tests that prove them*, with its plain-English note.
- [x] **Open questions is empty**: the technical unknowns are decided under *Assumptions & technical decisions*; where a library fact could not be checked ahead, the brief names the fallback.
- [x] **Data model is named and Supabase-first**: no new tables, columns or migrations; the native app reads and writes what the web app does.
- [x] **Module feature items** (spine wiring, MCP tools, dashboard widget): not applicable, this spec ports no module.
- [x] **Execution blocks** are decomposed, sequenced, and each is context-sized and self-contained.
- [x] **Every block has a brief** of at most 3 KB that stands alone (*Block briefs*).
- [x] **Design constraints acknowledged**: tokens only (AC2, AC8), one primitive per role behind `moduo-ui`, `docs/DESIGN_RULES.md` R1 to R13 cited in the briefs.
- [x] **Manual-test surfaces identified**: `bun run native:dev` and `bun run native:gallery`; each brief says what to try.

Ready to execute.

## Open questions

- [x] (none)
