/**
 * Stub for @tauri-apps/plugin-process aliased in web builds.
 * use-updater.ts guards all calls with IS_DESKTOP; this stub prevents
 * the bundler from pulling in Tauri-specific globals in the web target.
 */
export async function relaunch(): Promise<void> {
  // no-op on web
}
