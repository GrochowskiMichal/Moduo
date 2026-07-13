// Desktop-only "confirm before quitting" guard (DF-19f-quit). When the user opts
// in (Settings → Preferences → Startup), a window-close attempt asks for
// confirmation first; Cancel keeps the app open. No-op on web / SSR.
//
// IMPORTANT — the close listener is registered ONLY while the toggle is ON. Tauri
// v2's `onCloseRequested` JS wrapper (@tauri-apps/api/window) calls
// `getCurrentWindow().destroy()` whenever the handler does NOT preventDefault, and
// `destroy()` requires the `core:window:allow-destroy` capability (granted in
// src-tauri/capabilities/default.json — `core:default` alone does NOT include it).
// So the destroy path is only ever exercised for opted-in users; the default-OFF
// majority register no listener and keep Tauri's native close behaviour untouched.
//
// window.confirm is used (not @tauri-apps/plugin-dialog) because it's SYNCHRONOUS
// in the webview, so preventDefault can be decided inside the handler before the
// wrapper checks it — no async preventDefault→destroy dance, and no extra JS dep.
//
// KNOWN LIMITATION: this guards the window-close gesture (red button / last-window
// close → CloseRequested). On macOS, ⌘Q fires `RunEvent::ExitRequested`, which does
// NOT route through a window's onCloseRequested — catching ⌘Q would need a Rust-side
// exit handler (a separate, larger change). Verify on a desktop build. DF-19f-quit.

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
}
