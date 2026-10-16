// "Update Moduo" (CV-23, AC12.9): a desktop build below app_settings.min_build
// sees the notice and runs read-only; the web app and unstamped builds are never
// held back by their package.json version.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const h = rs.hoisted(() => ({
  version: "1.0.20",
  stamped: true,
  desktop: true,
  minimum: "1.0.21" as string | null,
  asked: 0,
}));

rs.mock("../../features/settings/about", () => ({
  get APP_VERSION() {
    return h.version;
  },
  get APP_VERSION_STAMPED() {
    return h.stamped;
  },
  get IS_DESKTOP() {
    return h.desktop;
  },
}));
rs.mock("../../features/settings/settings-events", () => ({ dispatchOpenSettings: () => {} }));
rs.mock("../../providers/auth-provider", () => {
  // One runtime for every render, as the provider keeps it.
  const auth = {
    runtime: {
      preferences: {
        getMinBuild: () => {
          h.asked += 1;
          return Promise.resolve(h.minimum);
        },
      },
    },
  };
  return { useAuth: () => auth };
});

import {
  applyMinBuild,
  isReadOnlyBuild,
  READ_ONLY_MESSAGE,
  readOnlyFetch,
} from "../../lib/min-build";
import { MinBuildBanner } from "./min-build-banner";

function setBuild(next: Partial<typeof h>) {
  Object.assign(
    h,
    { version: "1.0.20", stamped: true, desktop: true, minimum: "1.0.21", asked: 0 },
    next,
  );
}

afterEach(() => {
  cleanup();
  applyMinBuild(null, "0.0.0");
});

describe("old builds (AC12.9)", () => {
  it("a desktop build below min_build sees Update Moduo and runs read-only", async () => {
    setBuild({});
    render(<MinBuildBanner />);
    expect((await screen.findByRole("alert")).textContent).toContain("Update Moduo.");
    expect(screen.getByRole("alert").textContent).toContain("1.0.21 or newer can");
    expect(isReadOnlyBuild()).toBe(true);

    const calls: string[] = [];
    const guarded = readOnlyFetch((async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("{}", { status: 200 });
    }) as typeof fetch);
    const refused = await guarded("http://x/rest/v1/rpc/chat_op_send", { method: "POST" });
    expect(refused.status).toBe(403);
    expect((await refused.json()).message).toBe(READ_ONLY_MESSAGE);
    await guarded("http://x/rest/v1/rpc/chat_unread_counts", { method: "POST" });
    expect(calls).toEqual(["http://x/rest/v1/rpc/chat_unread_counts"]);
  });

  it("the release build itself (1.0.21) keeps saving", async () => {
    setBuild({ version: "1.0.21" });
    render(<MinBuildBanner />);
    await waitFor(() => expect(h.asked).toBe(1));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(isReadOnlyBuild()).toBe(false);
  });

  it("the web app (package.json's 1.0.0) is never held back", async () => {
    setBuild({ version: "1.0.0", stamped: false, desktop: false });
    render(<MinBuildBanner />);
    await Promise.resolve();
    expect(h.asked).toBe(0);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(isReadOnlyBuild()).toBe(false);
  });

  it("a dev or local desktop build (unstamped) is never held back", async () => {
    setBuild({ version: "1.0.0", stamped: false, desktop: true });
    render(<MinBuildBanner />);
    await Promise.resolve();
    expect(h.asked).toBe(0);
    expect(isReadOnlyBuild()).toBe(false);
  });
});
