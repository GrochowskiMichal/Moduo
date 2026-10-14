# Tasks v3 keyboard map (consolidated, collision-checked)

Sources: `src/lib/shortcuts.ts`, `src/features/tasks/ui/list-keys.ts`, tasks-v2 §8 + A19, REPLAN calls 31/33/33a/61/62a/65a/70/72a/82b/90/90b + defaults h/k, round-2b research. Status: **E** in code · **D n** decided call n · **v2** old plan · **P** proposed here.

## Global

| Key | Action | Status | Notes |
| --- | --- | --- | --- |
| ⌘K | Command palette | E | Fires from inputs |
| ⌘⇧K | Capture to Inbox | E / D 90 | Fires from inputs |
| ⌘N | New item of this module, here | E / D 90 | |
| ⌘⇧N · ⌘, · ⌘/ · ⌘⇧W | New note · Settings · Notifications · Workspaces | E | |
| ⌘1–7 | Switch module | E | Browser tabs collide; accepted |
| ? | Shortcut sheet | E | Tasks claims it in capture phase (A19) |
| ⌘Z | Undo | D | Every Tasks edit undoable |

## List / Board rows

| Key | Action | Status | Notes |
| --- | --- | --- | --- |
| ↑↓ · j k | Move cursor | E | Board: in column |
| ←→ | Collapse / expand | E | Board: prev / next column |
| ⏎ | Open in panel | D 82b | **Today: edit title** |
| e | Edit title inline | E | |
| Space · x | Complete | E | Status-icon click too (k) |
| ⇧S | Status menu | D k | |
| c | New task here | E / D 90 | Board: focused column |
| b | Move to project (today: bucket) | E | |
| s · d | Sessions · Due | E | |
| q | Add to Focus | E / D 61 | |
| ⇧F | Focus on this | D 31 | |
| a · @ | Assign | v2 / D 82b | @ primary (grammar) |
| i | Assign to me | v2 | |
| l · # | Tags | v2 / D 82b | # primary |
| p · f · / | Priority · Filter · Search | v2 | |
| w | Hand off | REPLAN §201 | Not in code |
| > · < | Nest · un-nest | D k | |
| ⌥⇧↑↓ · ⌥⇧←→ | Move in order · across columns | P | Replaces v2 ⌘↑/↓ |
| ⇧⌘M | Type-to-move | v2 | |
| ⌘⌫ | Delete (undo) | E | |

## Multi-select

| Key | Action | Status | Notes |
| --- | --- | --- | --- |
| ⇧-click · ⌘-click · ⇧↑↓ · ⇧J ⇧K | Range · toggle · extend | D 82b / A19 | Not in code |
| ⌘A | Select view | v2 | Explicit binding |
| Space | Complete all | D 82b | Not ⏎ |
| Q · @ · # · D · ⌫ | Focus · Assign · Tag · Date · Delete | D 82b (round 2e) | Bar row |
| a i l p s b ⇧S | Act on all | research §4 | |
| Esc | Clear selection | D 82b | |

## Inbox triage

| Key | Action | Status | Notes |
| --- | --- | --- | --- |
| 1 · 2 · 3 | Accept · Decline · Duplicate | D h | Accept asks project (20a) |
| H | Snooze | D h | |

## Focus (Now card)

| Key | Action | Status | Notes |
| --- | --- | --- | --- |
| ⏎ · ⇧⏎ | Done / Step done · Finish whole task | D 65a | |
| S | Skip | P | 65a names no key |
| W | Hand off | D 65a | |
| ⇧F | Subtask becomes the Now card | D 65a | |
| c | New at top of Up next | D 90 | |
| Stop · pause | ⋯ / pill only | D 62a | No key |

## Timeline

| Key | Action | Status | Notes |
| --- | --- | --- | --- |
| ↑↓ · j k | Move rows | D 70 | |
| ⌥←→ · ⌥⇧←→ | Date ±day · ±week | D 70 | |
| D · ⇧D | Date picker · clear | D 70 / P | |
| T · ⇧T | Today · fit selection | D 70 / P | Sketch had F |
| Space · ⏎ | Complete · open | P | Sketch: peek/open |
| ⇧↑↓ · ⌘-click | Select | P | Sketch's X dropped |
| − · = | Zoom out / in | P | Bare only; ⌘-scroll too |
| Esc | Clear selection | D 70 | |

## Capture modal

| Key | Action | Status | Notes |
| --- | --- | --- | --- |
| ⌘1–7 | Switch capture type | D 90b | Swallowed; ⌘1 inert |
| @ · # · / | Mention/assign · tag · command | D 33, 33a | |
| ⏎ · ⌘⏎ | Create · create more | E / D 91 | |
| ⇧⏎ | To description | P | Research had ↵ |
| Tab | Accept suggested link | D 90 | ⌫ on chip removes |
| Esc | Menu → undo recognition → close, keep draft | research §5 | |

## Detail panel (not in a field)

| Key | Action | Status | Notes |
| --- | --- | --- | --- |
| Row letters | Act on open task | P | a @ l # p s d q ⇧S w ⇧F |
| Tab · ⏎ | Next property · picker | E | ↑↓ ⏎ Esc inside |
| ⌘⏎ | Post comment | E | |
| Esc | Back arrow, then close | D 72a | |

## Right-panel views

| Key | Action | Status | Notes |
| --- | --- | --- | --- |
| ⌥1 ⌥2 | Details · Project | P | *about this* |
| ⌥3 ⌥4 | In flight · No date | P | *alongside* |

## Collision check

| Collision | Resolution · why |
| --- | --- |
| ⏎: edit (code) vs open (82b, board §4, Timeline) | **Open** everywhere; `e` edits. |
| Space: complete (code) vs Timeline peek | **Complete**; selection already peeks (72a). |
| x: complete (code) vs select (Linear, sketch) | **Complete**; select via ⇧↑↓/⌘-click. |
| f: Filter vs Focus-on-this vs Timeline fit | f · ⇧F (31) · ⇧T. |
| Q vs F for Add-to-Focus | Q (61): learned, F taken. |
| a/d vs triage accept/decline | 1·2·3·H (h). |
| ⌘[ ⌘] nest vs browser Back/Forward | `>` `<` (k). |
| Move: v2 ⌘↑/↓ vs board ⌥⇧; ⌘←/→ = Chrome Back/Forward | **⌥⇧ arrows** everywhere; revises A19. |
| Create: research ⌘⏎/⌘⇧⏎ vs 91 ⏎/⌘⏎ | **91** (decided, in code); ⇧⏎ = description. |
| Bare ⌫ (82b) vs ⌘⌫ (code) | Bare ⌫ only with ≥2 selected. |
| a/l vs @/# | Both; @/# primary. |
| ⌘1–7 modules vs capture type | Modal claims in capture phase while open. |
| ⌥1–4 vs ⌘1–7 | Different modifier; ⌃ rejected (Ctrl = ⌘ on Windows). |
| −/= vs ⌘−/⌘= zoom (dev:web; Tauri menu in `lib.rs` has no zoom item) | Bare keys only; re-check if a View › Zoom item is added. |
| ⌘A vs browser select-all | Explicit binding + preventDefault. |
| ⌘W ⌘Q ⌘H ⌘M ⌘0 ⌘⇧[ ⌘⇧] | Never bound. |
| Chrome: ⌘1–7, ⌘, · ⌘⇧W (close window) · ⌘⇧M (profile) | Accepted, Tauri-first. |
| S: Skip (Focus) vs sessions (rows) | Separate scopes; Now card has no sessions. |
| ⌘A · ⌘Z: list/undo vs Tauri Edit menu (`src-tauri/src/lib.rs` select_all/undo) | Verify the webview still gets keydown on desktop; else drive via menu events. |

## Rules

1. **Modifier guard.** List/Board/Timeline bail on ⌘/⌃/⌥ except explicit bindings: ⌘⌫, ⌘A, ⌥⇧ arrows, ⌥←/→ (+⇧), ⇧⌘M. Swallowed keys never reach `useGlobalShortcuts` (`defaultPrevented`).
2. **Shift is not a bail-out:** ⇧J/K/S/F/D/T checked before the lowercase match; `@ # > <` match `event.key`.
3. **`/` requires `!shiftKey`**; `?` matches `"?"` or `shiftKey && "/"`, claimed in capture phase on /tasks, opens the one sheet with the current scope first.
4. **⌥1–4** match `event.code` `Digit1–4` (macOS yields `¡™£¢`); bound at the shell.
5. **Capture ⌘1–7:** capture phase + `preventDefault` (gotchas/ui.md:27 recipe).
6. **Editable fields swallow single letters**; only ⌘K/⌘⇧K fire from inputs; inside text `@ # /` are grammar.
7. **Row controls keep Space/⏎**; portaled popovers never reach the list.
8. **Esc order:** popover/menu → (capture: undo recognition) → clear selection → panel item back → close panel view / leave triage.
9. **Digits and bare ⌫** need a selected row (digits: Inbox only; ⌫: ≥2).
