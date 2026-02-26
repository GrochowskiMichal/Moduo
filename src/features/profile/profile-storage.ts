import type { ModuoRuntime } from "../../lib/runtime";

export const PROFILE_UPDATED_EVENT = "moduo:profile:updated";
export const AVATAR_STORAGE_KEY = "moduo:auth-avatar-preview-v1";
export const AVATAR_STORE_NAMESPACE = "auth_ui";
export const AVATAR_STORE_KEY = "avatar_preview_v1";

export async function readStoredAvatar(runtime: ModuoRuntime | null): Promise<string | null> {
  if (typeof window === "undefined") return null;

  const fromLocal = window.localStorage.getItem(AVATAR_STORAGE_KEY);
  if (fromLocal) return fromLocal;

  if (!runtime) return null;
  const fromStore = await runtime.localStore.get(AVATAR_STORE_NAMESPACE, AVATAR_STORE_KEY).catch(() => null);
  const next = typeof fromStore === "string" && fromStore ? fromStore : null;
  if (next) {
    window.localStorage.setItem(AVATAR_STORAGE_KEY, next);
  }
  return next;
}

export async function writeStoredAvatar(runtime: ModuoRuntime | null, dataUrl: string | null): Promise<void> {
  if (typeof window === "undefined") return;

  if (!dataUrl) {
    window.localStorage.removeItem(AVATAR_STORAGE_KEY);
    if (runtime) {
      await runtime.localStore.remove(AVATAR_STORE_NAMESPACE, AVATAR_STORE_KEY).catch(() => {});
    }
    return;
  }

  window.localStorage.setItem(AVATAR_STORAGE_KEY, dataUrl);
  if (runtime) {
    await runtime.localStore.set(AVATAR_STORE_NAMESPACE, AVATAR_STORE_KEY, dataUrl).catch(() => {});
  }
}

export function notifyProfileUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT));
}
