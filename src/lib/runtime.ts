/**
 * Runtime entry-point.
 *
 * On desktop (Tauri): exports the Tauri runtime that proxies all calls via invoke().
 * On web: exports the Supabase-backed web runtime.
 *
 * Consumers import from this file only — never from runtime.tauri.ts or runtime.web.ts directly.
 */

export type {
  AuthChangeEvent,
  AuthListener,
  AuthMnemonic,
  IntegrationStatusItem,
  LocalAuthState,
  ModuoRuntime,
  RuntimeCapabilities,
  RuntimeResult,
  RuntimeSession,
} from "./runtime.types";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
}

// MODUO_TARGET is set at build time by rsbuild.config.ts.
// "web" skips the Tauri import entirely so @tauri-apps/api is tree-shaken out.
const buildTarget: string = (import.meta.env.MODUO_TARGET as string | undefined) ?? "desktop";

async function loadRuntime() {
  if (buildTarget === "web" || !isTauriRuntime()) {
    const { webRuntime } = await import("./runtime.web");
    return webRuntime;
  }
  const { tauriRuntime } = await import("./runtime.tauri");
  return tauriRuntime;
}

// Synchronous singleton — resolved on first use via initRuntime().
let _runtime: import("./runtime.types").ModuoRuntime | null = null;

/**
 * Call once at app startup (main.tsx / AuthProvider) before any component uses runtime.
 */
export async function initRuntime(): Promise<import("./runtime.types").ModuoRuntime> {
  if (!_runtime) {
    _runtime = await loadRuntime();
  }
  return _runtime;
}

/**
 * Synchronous accessor after initRuntime() has resolved.
 * Returns null if called before initialisation — components should guard with `if (!runtime)`.
 */
export function getRuntime(): import("./runtime.types").ModuoRuntime | null {
  return _runtime;
}

/**
 * Convenience reactive export used throughout the codebase.
 * For components that need the runtime at render time, prefer useRuntime() from auth-provider.
 */
export const runtime: import("./runtime.types").ModuoRuntime | null = null;

// Legacy compat: runtimeConfigError was checked by the old auth panel.
export const runtimeConfigError: string | null =
  buildTarget === "web" || isTauriRuntime()
    ? null
    : "Rust desktop runtime is required. Run inside Tauri (dev:desktop/build:desktop).";
