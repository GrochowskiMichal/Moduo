import { useEffect, useState } from "react";

import type { NotificationPrefs } from "../notifications";

/**
 * The device mirror of the user's notification-mute prefs. DF-21 READS these to
 * hide muted categories in the bell; **DF-19f owns writing them** — its Settings →
 * Preferences toggles write the synced `user_preferences.preferences.notifications`
 * domain and mirror it to this `moduo.notifications` key for instant read (the
 * `moduo.<domain>` convention `moduo.appearance` already uses). Until DF-19f lands
 * the mirror is absent → `{}` → every category shows (graceful degrade — the bell
 * never silently swallows a notification it can't confirm is muted).
 */
export const NOTIFICATION_PREFS_MIRROR_KEY = "moduo.notifications";

function readMirror(): NotificationPrefs {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(NOTIFICATION_PREFS_MIRROR_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as NotificationPrefs) : {};
  } catch {
    return {};
  }
}

/** Live notification prefs for the bell; re-reads on cross-tab writes + window focus. */
export function useNotificationPrefs(): NotificationPrefs {
  const [prefs, setPrefs] = useState<NotificationPrefs>(readMirror);

  useEffect(() => {
    const reread = () => setPrefs(readMirror());
    // Cross-tab writes fire `storage`; a same-tab settings save is caught on the
    // next window focus (cheap, matches the dashboard data-refresh-on-focus seam).
    const onStorage = (e: StorageEvent) => {
      if (e.key === NOTIFICATION_PREFS_MIRROR_KEY || e.key === null) reread();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", reread);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", reread);
    };
  }, []);

  return prefs;
}
