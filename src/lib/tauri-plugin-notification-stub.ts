/**
 * Stub for @tauri-apps/plugin-notification aliased in web builds.
 * Callers load the plugin only when isTauriRuntime() (features/focus/
 * phase-alert.ts, components/app/notice-deliveries.tsx), which a web build
 * never is in use; this stub lets the bundler resolve the module there.
 *
 * It does what the plugin's own JS layer does (the plugin's notify goes
 * through `window.Notification`, which Tauri replaces with its own), so a
 * test that plays the desktop app in a browser (tests/chat-notify.spec.ts)
 * can record the OS notifications it would show.
 */
export async function isPermissionGranted(): Promise<boolean> {
  return typeof window !== "undefined" && window.Notification?.permission === "granted";
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !window.Notification) return "denied";
  return window.Notification.requestPermission();
}

export function sendNotification(options: { title: string; body?: string } | string): void {
  if (typeof window === "undefined" || !window.Notification) return;
  if (typeof options === "string") new window.Notification(options);
  else new window.Notification(options.title, options);
}
