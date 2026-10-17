// Pure rules for profile pictures and workspace logos. The upload itself lives
// next to the Supabase client; this file stays free of it so the limits, paths,
// and emoji check can be unit-tested.

export const AVATAR_BUCKET = "avatars";
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

const IMAGE_EXTENSIONS = ["jpg", "png", "webp", "gif"] as const;

export const WORKSPACE_ICON_CHOICES = [
  "🏠",
  "🏢",
  "🚀",
  "✨",
  "🎯",
  "🌿",
  "⚡",
  "🎨",
  "📦",
  "🧪",
  "🌍",
  "💼",
  "🧠",
  "🔥",
  "🌙",
  "📐",
] as const;

/** One emoji (including a ZWJ sequence). Rejects words, urls, and empty strings. */
const SINGLE_EMOJI =
  /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})(?:\uFE0F|\uFE0E)?(?:\u200D(?:\p{Extended_Pictographic})(?:\uFE0F|\uFE0E)?)*$/u;

export function isAllowedImageType(type: string): type is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type);
}

export function extensionForType(type: string): (typeof IMAGE_EXTENSIONS)[number] {
  switch (type) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "jpg";
  }
}

export function validateImageFile(file: { type: string; size: number }): string | null {
  const type = file.type === "image/jpg" ? "image/jpeg" : file.type;
  if (!isAllowedImageType(type)) {
    return "Use a JPEG, PNG, WebP, or GIF.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "Image is too large. Use a file up to 4 MB.";
  }
  return null;
}

export function profileAvatarPath(userId: string, ext: string): string {
  return `profiles/${userId}/avatar.${ext}`;
}

export function workspaceLogoPath(workspaceId: string, ext: string): string {
  return `workspaces/${workspaceId}/logo.${ext}`;
}

export function siblingObjectPaths(
  kind: "profile" | "workspace",
  id: string,
  keepExt: string,
): string[] {
  const path = kind === "profile" ? profileAvatarPath : workspaceLogoPath;
  return IMAGE_EXTENSIONS.filter((ext) => ext !== keepExt).map((ext) => path(id, ext));
}

export function allObjectPaths(kind: "profile" | "workspace", id: string): string[] {
  const path = kind === "profile" ? profileAvatarPath : workspaceLogoPath;
  return IMAGE_EXTENSIONS.map((ext) => path(id, ext));
}

/** Public object URL plus a cache-buster so a replaced file is not stuck in the browser. */
export function publicObjectUrl(supabaseUrl: string, path: string, version: number): string {
  const base = supabaseUrl.replace(/\/$/, "");
  const encoded = path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${base}/storage/v1/object/public/${AVATAR_BUCKET}/${encoded}?v=${version}`;
}

/** A workspace icon is one emoji, or null when the input isn't. */
export function normalizeWorkspaceIcon(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > 16) return null;
  return SINGLE_EMOJI.test(value) ? value : null;
}

/** Turn a stored data URL back into a file so an older local picture can be uploaded. */
export function dataUrlToFile(dataUrl: string, filename = "avatar"): File | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) return null;
  const type = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  if (!isAllowedImageType(type)) return null;
  const binary = atob(match[2].replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.byteLength > MAX_IMAGE_BYTES) return null;
  return new File([bytes], `${filename}.${extensionForType(type)}`, { type });
}
