import { SUPABASE_URL, supabaseClient } from "../../lib/runtime.web";
import {
  AVATAR_BUCKET,
  allObjectPaths,
  extensionForType,
  profileAvatarPath,
  publicObjectUrl,
  siblingObjectPaths,
  validateImageFile,
  workspaceLogoPath,
} from "./image-asset";

async function replaceObject(
  kind: "profile" | "workspace",
  id: string,
  file: File,
): Promise<string> {
  const type = file.type === "image/jpg" ? "image/jpeg" : file.type;
  const problem = validateImageFile({ type, size: file.size });
  if (problem) throw new Error(problem);

  const ext = extensionForType(type);
  const path = kind === "profile" ? profileAvatarPath(id, ext) : workspaceLogoPath(id, ext);
  const stale = siblingObjectPaths(kind, id, ext);
  if (stale.length > 0) {
    await supabaseClient.storage.from(AVATAR_BUCKET).remove(stale);
  }

  const { error } = await supabaseClient.storage.from(AVATAR_BUCKET).upload(path, file, {
    upsert: true,
    contentType: type,
    cacheControl: "3600",
  });
  if (error) throw new Error(error.message);
  return publicObjectUrl(SUPABASE_URL, path, Date.now());
}

async function removeObjects(kind: "profile" | "workspace", id: string): Promise<void> {
  const { error } = await supabaseClient.storage
    .from(AVATAR_BUCKET)
    .remove(allObjectPaths(kind, id));
  if (error) throw new Error(error.message);
}

export function uploadProfileAvatar(userId: string, file: File): Promise<string> {
  return replaceObject("profile", userId, file);
}

export function clearProfileAvatar(userId: string): Promise<void> {
  return removeObjects("profile", userId);
}

export function uploadWorkspaceLogo(workspaceId: string, file: File): Promise<string> {
  return replaceObject("workspace", workspaceId, file);
}

export function clearWorkspaceLogo(workspaceId: string): Promise<void> {
  return removeObjects("workspace", workspaceId);
}
