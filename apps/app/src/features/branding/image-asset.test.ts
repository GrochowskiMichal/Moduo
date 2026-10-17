import { describe, expect, it } from "@rstest/core";
import {
  dataUrlToFile,
  extensionForType,
  normalizeWorkspaceIcon,
  profileAvatarPath,
  publicObjectUrl,
  siblingObjectPaths,
  validateImageFile,
  workspaceLogoPath,
} from "./image-asset";

describe("validateImageFile", () => {
  it("accepts the bucket's image types under 4 MB", () => {
    expect(validateImageFile({ type: "image/png", size: 1024 })).toBeNull();
    expect(validateImageFile({ type: "image/jpg", size: 1024 })).toBeNull();
  });

  it("rejects other types and oversized files", () => {
    expect(validateImageFile({ type: "image/svg+xml", size: 100 })).toMatch(/JPEG/);
    expect(validateImageFile({ type: "image/png", size: 4 * 1024 * 1024 + 1 })).toMatch(/4 MB/);
  });
});

describe("object paths", () => {
  it("keeps profile and workspace objects in separate folders", () => {
    expect(profileAvatarPath("user-1", "png")).toBe("profiles/user-1/avatar.png");
    expect(workspaceLogoPath("ws-1", "jpg")).toBe("workspaces/ws-1/logo.jpg");
    expect(extensionForType("image/webp")).toBe("webp");
  });

  it("lists the other extensions so a replacement can delete them", () => {
    expect(siblingObjectPaths("profile", "user-1", "png")).toEqual([
      "profiles/user-1/avatar.jpg",
      "profiles/user-1/avatar.webp",
      "profiles/user-1/avatar.gif",
    ]);
  });
});

describe("publicObjectUrl", () => {
  it("builds a public bucket URL with a cache-buster", () => {
    expect(publicObjectUrl("https://example.supabase.co/", "profiles/u/avatar.png", 7)).toBe(
      "https://example.supabase.co/storage/v1/object/public/avatars/profiles/u/avatar.png?v=7",
    );
  });
});

describe("normalizeWorkspaceIcon", () => {
  it("keeps a single emoji and rejects text", () => {
    expect(normalizeWorkspaceIcon(" 🚀 ")).toBe("🚀");
    expect(normalizeWorkspaceIcon("🏠")).toBe("🏠");
    expect(normalizeWorkspaceIcon("rocket")).toBeNull();
    expect(normalizeWorkspaceIcon("")).toBeNull();
    expect(normalizeWorkspaceIcon("🚀🚀")).toBeNull();
  });
});

describe("dataUrlToFile", () => {
  it("round-trips a small png data URL", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const file = dataUrlToFile(png);
    expect(file?.type).toBe("image/png");
    expect(file?.name).toBe("avatar.png");
    expect(file?.size).toBeGreaterThan(0);
  });

  it("rejects a non-image data URL", () => {
    expect(dataUrlToFile("data:text/plain;base64,aGVsbG8=")).toBeNull();
  });
});
