import { describe, expect, it } from "@rstest/core";

import { shareGoogleSignIn } from "./desktop-connect";

describe("shareGoogleSignIn", () => {
  it("hands the new token to Supabase, then reads the status that clears reauth", async () => {
    const calls: string[] = [];
    await shareGoogleSignIn("google:me@gmail.com", {
      publish: async (id) => void calls.push(`publish ${id}`),
      refresh: async () => void calls.push("status"),
    });
    expect(calls).toEqual(["publish google:me@gmail.com", "status"]);
  });

  it("never fails the connect when the hand-over can't happen", async () => {
    let refreshed = false;
    await expect(
      shareGoogleSignIn("google:me@gmail.com", {
        publish: async () => {
          throw new Error("sign_in_required");
        },
        refresh: async () => {
          refreshed = true;
        },
      }),
    ).resolves.toBeUndefined();
    expect(refreshed).toBe(false);
  });
});
