/**
 * Stub for @tauri-apps/api/core that is aliased in web builds.
 * The web runtime never calls invoke(); this stub ensures the module resolves
 * without errors if somehow any tree-shaking boundary is missed.
 */
export async function invoke<T = unknown>(
  _cmd: string,
  _args?: Record<string, unknown>,
): Promise<T> {
  throw new Error(`[tauri-stub] invoke("${_cmd}") called in web build — this is a bug.`);
}
