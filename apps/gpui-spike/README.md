# moduo-gpui-spike

A throwaway experiment: Moduo Tasks drawn natively with [GPUI](https://gpui.rs)
(through GPUI Kit), with no webview, talking to the same Supabase backend as
the app. It is not part of any Bun or Cargo workspace, is outside `bun run
verify`, and is never shipped.

## Run

```bash
cd apps/gpui-spike
cargo run --release             # the backend in the repo's .env.local
cargo run --release -- --cloud  # the cloud project parked in .env.cloud.local
```

The window title says which backend it is on, and the cloud shows a red banner:
changes there are real changes to production data. Sign in with your email and
the 6-digit code, as in the app; the session is kept in the macOS Keychain, one
entry per backend. Nothing is baked into the binary.

## What works

Projects in the sidebar, a virtualised task list (sections, one level of
subtasks), create, edit title and notes, complete and reopen, status, priority,
due date, move to another project, reorder, delete and undo. Every write goes
through the same server functions the web app calls (`tasks_op_create`,
`tasks_op_update`, `tasks_op_set_status`), as the signed-in person.

Keys, with the list focused: `↑`/`↓` or `j`/`k` select, `space` complete,
`enter` edit the title, `⌥↑`/`⌥↓` reorder, `⌘⌫` delete, `⌘Z` undo the delete.
Anywhere: `⌘N` new task, `⌘R` reload.

## What it leaves out

- Live updates use a 4-second poll (and a read when the window comes forward),
  not Realtime.
- No offline queue: a write that fails is rolled back with a notice.
- No tags, comments, assignees, repeats, reminders, queue, time tracking,
  board or timeline views, and no design tokens (GPUI Kit's default theme).

## Checks

```bash
cargo test                       # position keys and the store's merge rules
MODUO_SPIKE_ACCESS_TOKEN=<local token> cargo run -- --smoke
```

`--smoke` runs create, edit, complete, reorder, delete, delta read and undo on
one throwaway task. It refuses to run against anything but the local stack.
