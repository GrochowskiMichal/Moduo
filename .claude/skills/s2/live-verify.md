# Live-verify recipes (the Browser pane, Chrome, Playwright)

Read before live-verifying a UI change in step 5. Compiled from the UI and notes gotchas (HV-14b). Sign-in and the local stack: [docs/local-dev.md](../../../docs/local-dev.md).

## The Browser pane is shared and often hidden
- Every session on this Mac shares the pane: open your own tab (`tabs_create`), pass its `tabId` to every call, close it when done. Another lane can navigate the fronted tab under you.
- A hidden pane (`document.visibilityState === "hidden"`) never runs `requestAnimationFrame` and freezes CSS animations, so a closed Radix menu or dialog stays mounted with `data-state="closed"`, `onCloseAutoFocus` never fires, and screenshots time out. Read state after the pane is shown, take a screenshot to force progress, or drive the flow with headless Playwright (`chromium.launch()`, `addInitScript` with the same localStorage pairs as `signInPage`).
- Reading React or Radix state in the very next `javascript_tool` call after an event gives false negatives: force a repaint (a screenshot) or wait first. Treat an eval timeout as "throttled", not "hung".
- The pane can report `window.innerWidth === 0`, so viewport-driven components mount in their narrow mode: check it before debugging breakpoints, or set `resize_window`.
- With the viewport emulated larger than the pane, clicks use the emulated frame, not the scaled screenshot's: click by `ref` (`find`, `read_page`).

## Driving input
- `computer` coordinate clicks can miss thin targets with no error; Radix Select and DropdownMenu act on pointer events: dispatch `PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })`, then focus an item and press Enter.
- `key "Return"` doesn't reach React's `onKeyDown` or Lexical's `KEY_ENTER_COMMAND`: set a controlled input with the native value setter plus a bubbling `input` event, then in a separate call dispatch `KeyboardEvent("keydown", { key: "Enter", bubbles: true })`. In Lexical use `Enter`.
- A contenteditable doesn't focus from a `computer` click: `el.focus()` plus a collapsed `Range` at the end, then `computer.type`; select a menu option with a bubbling `MouseEvent("mousedown")`.
- dnd-kit drags: `left_click_drag` makes a text selection, not a pointer drag. Dispatch `PointerEvent`s on `document.body` (`buttons: 1` while moving, `0` on release), with per-frame delays between ~10 moves; a DragOverlay appearing means the sensor engaged. Playwright's real mouse is simpler.
- A `?` shortcut can arrive as `shift` + `/`; window-level shortcuts fire from a `KeyboardEvent` dispatched on `window`.

## The dev server and the build
- After a big merge or branch switch mid-session, restart the dev server (`preview_stop`, `preview_start`); `read_console_messages` is an accumulated buffer, so trust `preview_logs` on the current server and a fresh screenshot.
- Editing a custom hook during HMR throws a false "change in the order of Hooks" in its caller: hard-reload before trusting it.
- The React Compiler runs only in the app build: compiler-dependent behaviour (store snapshots, memoised rows) is checked here, never in rstest.
- Email's three panels render only in the desktop build (`IS_DESKTOP`); to see them in the pane, flip it locally and restore the file before committing.
- supabase-js resolves `fetch` late, so an in-page `window.fetch` stub can fake unapplied RPCs; remount through SPA navigation (a reload wipes the stub).
- The Chrome extension's browser may be on another machine and can't reach this Mac's `127.0.0.1`: use the Browser pane. Keep your check out of the shared dev workspace's e2e leftovers by creating a workspace of your own.
