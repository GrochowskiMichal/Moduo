---
paths: ["apps/native/**"]
incident: "bun run verify covers no Rust, and the GPUI component library breaks its API most weeks (specs/native-foundation.md, 2026-11-28)"
expires: 2027-03-31
---

# Native app (GPUI), apps/native

A separate app beside the Tauri one, in its own Cargo workspace. Plan and blocks: `specs/native-foundation.md`, `specs/native-tasks.md`. Locked calls: [docs/decisions/desktop-release.md](../../docs/decisions/desktop-release.md), [docs/decisions/toolchain.md](../../docs/decisions/toolchain.md) (2026-11-28).

- **`bun run verify` covers no Rust.** A block that touches `apps/native` must pass `bun run native:check` (fmt, clippy with warnings as errors, tests). Run it with `bun run native:dev` to look at the app.
- **Only `crates/ui` (`moduo-ui`) may name the component library** (`gpui_kit`, `gpui_component`, `gpui_base`). Every other crate takes GPUI from `moduo_ui::gpui` and components from `moduo_ui`, as React features take the shadcn wrappers. `apps/native/tests/boundaries.rs` fails otherwise.
- **The pins are exact** (`gpui-kit = "=0.11.0"` on its `gpui-pre` snapshot). Never bump them inside a feature block: a bump is a block of its own. Read the API from the pinned sources (`~/.cargo/registry/src/*/gpui-kit-0.11.0`, `gpui-pre-0.3.14`), not from memory; the kit's `TESTING.md` there explains the test harness.
- **Nothing is shared with the Tauri app:** not its bundle id (`com.moduo.desktop`), its Keychain service or its data folder. A Keychain item belongs to the app that made it.
- **Every `.rs` file stays under 32 KB** (`scripts/ci/ratchets.ts`). Split by concern early.
- **Data crates carry no GPUI.** Auth, Supabase and sync code runs on tokio and tests with plain `cargo test`; GPUI's executor is not tokio.
- **GPUI redraws a whole entity when it is notified.** Build rows and cells as plain elements from facts; give something its own entity only when it holds state.
- **A cold dependency resolve can fail on a stale crates.io index** ("candidate versions found which didn't match"): run `cargo fetch --manifest-path apps/native/Cargo.toml` again, the lockfile is right.
- **Tests:** `#[gpui::test]` with `use moduo_ui::gpui;` in scope (the macro expands to `gpui::` paths); the `test-support` feature of `moduo-ui` turns the harness on.
