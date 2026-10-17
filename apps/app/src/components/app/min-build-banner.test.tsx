// "Update Moduo" (CV-23, AC12.9): a desktop build below app_settings.min_build
// sees the notice and runs read-only; the release build and the web app don't.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const h = rs.hoisted(() => ({
  version: "1.0.20",
  desktop: true,
  minimum: "1.0.21" as string | null,
}));

rs.mock("../../features/settings/about", () => ({
  get APP_VERSION() {
    return h.version;
  },
  get IS_DESKTOP() {
    return h.desktop;
  },
}));
rs.mock("../../features/settings/settings-events", () => ({ dispatchOpenSettings: () => {} }));
rs.mock("../../providers/auth-provider", () => {
  // One runtime for every render, as the provider keeps it.
  const auth = {
    runtime: { preferences: { getMinBuild: () => Promise.resolve(h.minimum) } },
  };
  return { useAuth: () => auth };
});

import {
  applyMinBuild,
  getMinBuildState,
  isReadOnlyBuild,
  READ_ONLY_MESSAGE,
  readOnlyFetch,
} from "../../lib/min-build";
import { MinBuildBanner } from "./min-build-banner";

function setBuild(next: Partial<typeof h>) {
  Object.assign(h, { version: "1.0.20", desktop: true, minimum: "1.0.21" }, next);
}

/** The banner has read the server's minimum and applied it to this build. */
async function applied(minimum: string) {
  await waitFor(() => expect(getMinBuildState().minimum).toBe(minimum));
}

afterEach(() => {
  cleanup();
  applyMinBuild(null, "0.0.0", "desktop");
});

describe("old builds (AC12.9)", () => {
  it("a desktop build from before Chat v2 sees Update Moduo and runs read-only", async () => {
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

  it("the first desktop build with Chat v2 (1.0.21) keeps saving", async () => {
    setBuild({ version: "1.0.21" });
    render(<MinBuildBanner />);
    await applied("1.0.21");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(isReadOnlyBuild()).toBe(false);
  });

  it("a desktop build from the VERSION file (1.1.0, staging -rc) keeps saving", async () => {
    setBuild({ version: "1.1.0-rc.4" });
    render(<MinBuildBanner />);
    await applied("1.0.21");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(isReadOnlyBuild()).toBe(false);
  });

  it("the web app is never held back, whatever version it reports", async () => {
    setBuild({ version: "1.0.0", desktop: false });
    render(<MinBuildBanner />);
    await applied("1.0.21");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(isReadOnlyBuild()).toBe(false);
  });
});
