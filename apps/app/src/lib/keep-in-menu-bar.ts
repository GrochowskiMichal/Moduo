// Desktop-only "keep running in the menu bar" (TV-D12, REPLAN 73): with it on
// (the default), closing the window hides it and Moduo keeps running in the
// menu bar, so reminders still arrive as OS notifications. The close itself is
// handled natively (src-tauri/src/lib.rs, `CloseRequested`); this hook only
// mirrors the synced preference into Rust, on boot and on every toggle, the
// way confirm-before-quit does. No-op on web.

import { useEffect } from "react";

import { usePreferencesValue } from "./preferences";
import { isTauriRuntime } from "./runtime";

export function useKeepInMenuBar(): void {
  const { keepInMenuBar } = usePreferencesValue();

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (!cancelled) await invoke("set_keep_in_menu_bar", { value: keepInMenuBar });
      } catch (err) {
        // An older shell without the command just closes as before.
        console.error("[keep-in-menu-bar] failed to mirror pref to Rust:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [keepInMenuBar]);
}
