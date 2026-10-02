import type { ModuoRuntime } from "../../lib/runtime";
import {
  notifyProfileUpdated,
  readStoredAvatar,
  writeStoredAvatar,
} from "../profile/profile-storage";
import { dataUrlToFile } from "./image-asset";
import { uploadProfileAvatar } from "./upload-image";

const inflight = new Map<string, Promise<string | null>>();

async function settle(runtime: ModuoRuntime, userId: string): Promise<string | null> {
  const { data } = await runtime.workspace.getProfile(userId);
  const remote = data?.avatar_url?.trim() || null;
  if (remote && !remote.startsWith("data:")) {
    await writeStoredAvatar(runtime, null);
    return remote;
  }

  const local = await readStoredAvatar(runtime);
  if (!local?.startsWith("data:image/")) return remote;

  const file = dataUrlToFile(local);
  if (!file) return local;

  try {
    const url = await uploadProfileAvatar(userId, file);
    const saved = await runtime.auth.updateAvatarUrl(url);
    if (saved.error) return local;
    await writeStoredAvatar(runtime, null);
    notifyProfileUpdated();
    return url;
  } catch {
    return local;
  }
}

/**
 * The picture to show for this account. A URL already on `profiles.avatar_url`
 * wins. A picture that only exists as a local data URL is uploaded once into
 * the avatars bucket so it follows the account to other devices.
 */
export function ensureProfileAvatar(runtime: ModuoRuntime, userId: string): Promise<string | null> {
  const pending = inflight.get(userId);
  if (pending) return pending;
  const job = settle(runtime, userId).finally(() => {
    inflight.delete(userId);
  });
  inflight.set(userId, job);
  return job;
}
