/**
 * Stub for @tauri-apps/plugin-notification aliased in web builds.
 * features/focus/phase-alert.ts only loads the plugin when isTauriRuntime();
 * this stub lets the bundler resolve the module on the web target, where the
 * phase-end alert is an in-app toast instead.
 */
export async function isPermissionGranted(): Promise<boolean> {
  return false;
}

export async function requestPermission(): Promise<NotificationPermission> {
  return "denied";
}

export function sendNotification(_options: { title: string; body?: string } | string): void {
  /* no OS notifications on the web build */
}
