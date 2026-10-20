// Desktop-only: the main window starts hidden (tauri.conf.json `visible: false`)
// so the webview never shows a blank frame before React paints. Show it from an
// effect, which runs after React's first commit. Not requestAnimationFrame: a
// hidden WKWebView window doesn't tick frames. Rust shows the window anyway
// after ~2 s (src-tauri/src/lib.rs `WINDOW_SHOW_FALLBACK`) if this never runs.

import { useEffect } from "react";

import { isTauriRuntime } from "./runtime";

export function useShowWindowAfterFirstCommit(): void {
  useEffect(() => {
    if (!isTauriRuntime()) return;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().show();
      } catch (err) {
        console.error("[show-window] failed to show the main window:", err);
      }
    })();
  }, []);
}
