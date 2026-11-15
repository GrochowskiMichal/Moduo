// HV-15 variant of benchmarks/escapes/509-1-error-read-as-empty: `ensureProfileAvatar` reads a
// failed `getProfile` (offline, a 5xx, a mid-refresh 401) as "this account has no picture", so a
// picture left on the device (picked on the sign-in screen) is uploaded and saved over the
// account's real `avatar_url`. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/branding/profile-avatar.509-1.variant.test.ts
import { beforeEach, describe, expect, it, rs } from "@rstest/core";

import type { ModuoRuntime } from "@/lib/runtime.types";

const h = rs.hoisted(() => ({ uploads: [] as string[] }));

rs.mock("./upload-image", () => ({
  uploadProfileAvatar: async (userId: string) => {
    h.uploads.push(userId);
    return "https://cdn.example/avatars/new-from-device.png";
  },
}));

import { AVATAR_STORAGE_KEY } from "../profile/profile-storage";
import { ensureProfileAvatar } from "./profile-avatar";

const USER = "00000000-0000-4000-8000-0000000000a1";
const REAL = "https://cdn.example/avatars/the-account-picture.png";
const DEVICE_PICK = "data:image/png;base64,iVBORw0KGgo=";

function fakeRuntime(profile: { data: unknown; error: unknown }) {
  const account = { avatarUrl: REAL as string | null };
  const runtime = {
    localStore: {
      get: async () => null,
      set: async () => {},
      remove: async () => {},
    },
    workspace: {
      getProfile: async () => profile,
    },
    auth: {
      async updateAvatarUrl(url: string | null) {
        account.avatarUrl = url;
        return { error: null };
      },
    },
  } as unknown as ModuoRuntime;
  return { runtime, account };
}

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

hunt(
  "HV-15 variant 509-1: a failed profile read lets a device picture replace the account's",
  () => {
    beforeEach(() => {
      h.uploads.length = 0;
      window.localStorage.clear();
      // A picture picked on the sign-in screen of this new device, before signing in.
      window.localStorage.setItem(AVATAR_STORAGE_KEY, DEVICE_PICK);
    });

    it("keeps the account's picture when the profile read fails", async () => {
      const { runtime, account } = fakeRuntime({
        data: null,
        error: new Error("TypeError: Failed to fetch"),
      });

      await ensureProfileAvatar(runtime, USER);

      expect(h.uploads).toEqual([]);
      expect(account.avatarUrl).toBe(REAL);
    });

    it("a good read still keeps the account's picture (the oracle)", async () => {
      const { runtime, account } = fakeRuntime({
        data: { plan_tier: "free", display_name: "A", avatar_url: REAL },
        error: null,
      });

      await expect(ensureProfileAvatar(runtime, USER)).resolves.toBe(REAL);
      expect(h.uploads).toEqual([]);
      expect(account.avatarUrl).toBe(REAL);
    });
  },
);
