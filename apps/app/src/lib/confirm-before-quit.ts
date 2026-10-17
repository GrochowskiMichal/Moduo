// Desktop-only "confirm before quitting" wiring (DF-19f-quit). When the user opts in
// (Settings → Preferences → Startup), quitting asks for confirmation first; Cancel keeps
// the app open. No-op on web / SSR.
//
// Both quit gestures are intercepted NATIVELY in Rust (src-tauri/src/lib.rs) — there is no
// JS-side guard anymore:
//   1. macOS ⌘Q → a custom Quit menu item (the predefined Quit calls `terminate:`, which
//      can't be intercepted) → confirm in `on_menu_event`.
//   2. Window close (red button / ⌘W / File → Close Window) → `WindowEvent::CloseRequested`
//      → `api.prevent_close()` + the same native confirm dialog.
// A single native dialog serves both; on macOS the gestures are disjoint (⌘Q never raises
// CloseRequested), so there's no double prompt.
//
// Rust can't read the webview-only preference, so this hook's only job is to MIRROR the
// current `confirmBeforeQuit` value into Rust `AppState` via `set_confirm_before_quit`,
// pushed on boot and on every toggle (including off, so turning it off restores immediate
// quit). Desktop-only; a no-op on web.
//
// (Earlier revisions guarded the window-close path in JS with `window.confirm`, but in the
// Tauri v2 webview `window.confirm` is async and gated by a capability we don't grant —
// `!Promise` is always falsy, so `preventDefault` never fired and the window closed anyway.
// Moving BOTH gestures to Rust fixes that and unifies them on one native dialog.)

import { useEffect } from "react";

import { usePreferencesValue } from "./preferences";
import { isTauriRuntime } from "./runtime";

export function useConfirmBeforeQuit(): void {
  const { confirmBeforeQuit } = usePreferencesValue();

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (!cancelled) await invoke("set_confirm_before_quit", { value: confirmBeforeQuit });
      } catch (err) {
        // A failed push just means quit keeps its prior behaviour — never break the app.
        console.error("[confirm-before-quit] failed to mirror pref to Rust:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [confirmBeforeQuit]);
}
