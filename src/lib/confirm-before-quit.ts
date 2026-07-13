// Desktop-only "confirm before quitting" guard (DF-19f-quit). When the user opts in
// (Settings → Preferences → Startup), quitting asks for confirmation first; Cancel
// keeps the app open. No-op on web / SSR.
//
// Two quit gestures, two layers — this hook wires BOTH:
//   1. Window close (red button / last-window close → CloseRequested) is caught HERE in
//      JS via getCurrentWindow().onCloseRequested + a synchronous window.confirm.
//   2. macOS ⌘Q raises app-level `RunEvent::ExitRequested`, which does NOT route through
//      any window's onCloseRequested — so it is caught in RUST (src-tauri/src/lib.rs,
//      api.prevent_exit() + a native tauri-plugin-dialog confirm). Rust can't read the
//      webview-only pref, so the second effect below mirrors it into AppState via the
//      `set_confirm_before_quit` command (pushed on boot + every toggle). On macOS
//      (our shipping target) the two paths are disjoint — ⌘Q never fires onCloseRequested
//      and closing the last window doesn't raise ExitRequested — so there's no double
//      prompt. (On Win/Linux, not yet a target, last-window close could fire both.)
//
// IMPORTANT — the close listener is registered ONLY while the toggle is ON. Tauri
// v2's `onCloseRequested` JS wrapper (@tauri-apps/api/window) calls
// `getCurrentWindow().destroy()` whenever the handler does NOT preventDefault, and
// `destroy()` requires the `core:window:allow-destroy` capability (granted in
// src-tauri/capabilities/default.json — `core:default` alone does NOT include it).
// So the destroy path is only ever exercised for opted-in users; the default-OFF
// majority register no listener and keep Tauri's native close behaviour untouched.
//
// window.confirm is used for the window-close path (not @tauri-apps/plugin-dialog)
// because it's SYNCHRONOUS in the webview, so preventDefault can be decided inside the
// handler before the wrapper checks it — no async preventDefault→destroy dance. The
// ⌘Q path uses a native Rust dialog since `ExitRequested` prevention is async. DF-19f-quit.

import { useEffect } from "react";

import { usePreferencesValue } from "./preferences";
import { isTauriRuntime } from "./runtime";

export function useConfirmBeforeQuit(): void {
  const { confirmBeforeQuit } = usePreferencesValue();

  useEffect(() => {
    // Only guard the close when opted in AND on desktop. Off (the default) →
    // register nothing, so the window closes natively and the destroy path (and its
    // capability) is never touched. Re-runs on toggle to register/unregister.
    if (!confirmBeforeQuit || !isTauriRuntime()) return;

    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        // Dynamic import: @tauri-apps/api/window is NOT stubbed in web builds, so it
        // must never be evaluated there — the isTauriRuntime() guard above ensures
        // this only runs on desktop (web code-splits it into a never-fetched chunk).
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const stop = await getCurrentWindow().onCloseRequested((event) => {
          if (!window.confirm("Quit Moduo?")) event.preventDefault();
        });
        // If the component unmounted (or the toggle flipped off) while registering,
        // detach immediately.
        if (cancelled) stop();
        else unlisten = stop;
      } catch (err) {
        // Registration failure must never break the app — worst case the guard is
        // absent and the window closes normally.
        console.error("[confirm-before-quit] failed to register close handler:", err);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [confirmBeforeQuit]);

  // Mirror the pref into Rust so the native ⌘Q handler (RunEvent::ExitRequested — which
  // the JS onCloseRequested guard above cannot see) reads the current value from
  // AppState. Runs on mount (boot) and on every toggle — INCLUDING off, so turning the
  // setting off restores immediate ⌘Q. Desktop-only; a no-op on web.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (!cancelled) await invoke("set_confirm_before_quit", { value: confirmBeforeQuit });
      } catch (err) {
        // A failed push just means ⌘Q keeps its prior behaviour — never break the app.
        console.error("[confirm-before-quit] failed to mirror pref to Rust:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [confirmBeforeQuit]);
}
