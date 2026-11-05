// HV-15 variant of benchmarks/escapes/509-3-signout-wipes-outbox: Settings → Advanced → "Reset
// local cache" clears every `moduo.*` key, including a preferences change made offline that never
// reached the account (its `.sync` meta says dirty), so the change is lost while the dialog says
// "Your cloud data is safe". Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/settings/sections/advanced-section.509-3.variant.test.tsx
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = rs.hoisted(() => ({
  auth: { runtime: null, userId: "user-A" },
  ws: { selectedWorkspace: { id: "w1", name: "Studio", role: "owner" } },
  toast: Object.assign(rs.fn(), { success: rs.fn(), error: rs.fn() }),
}));

rs.mock("../../../providers/auth-provider", () => ({ useAuth: () => mocks.auth }));
rs.mock("../../../providers/workspace-provider", () => ({ useWorkspace: () => mocks.ws }));
rs.mock("sonner", () => ({ toast: mocks.toast }));
// Nothing waits in Notes or in the upload queue: only the preferences change is unsynced.
rs.mock("../../notes/sync/idb", () => ({
  countPendingOutbox: async () => 0,
  closeNotesDb: async () => {},
}));
rs.mock("@/lib/uploads", () => ({
  countPendingUploads: async () => 0,
  otherAccountsHaveUploads: async () => false,
  closeUploadsDb: async () => {},
  UPLOADS_DB_NAME: "moduo-uploads",
}));

import { getSyncMeta, setSyncMeta } from "../../../lib/prefs-sync";
import { AdvancedSection } from "./advanced-section";

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

beforeEach(() => {
  localStorage.clear();
  // The reset deletes IndexedDB databases by name; a stub that answers at once.
  const idb = {
    databases: async () => [],
    deleteDatabase: () => {
      const req: { onsuccess?: () => void } = {};
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };
  Object.defineProperty(globalThis, "indexedDB", { value: idb, configurable: true });
});

afterEach(() => cleanup());

hunt("HV-15 variant 509-3: Reset local cache drops an unsynced preferences change", () => {
  it("an offline preferences change survives the reset (or the reset is refused)", async () => {
    // A changed their landing view while offline: the mirror holds it and the push failed, so
    // its meta is dirty (exactly what pushLocalChange leaves after a failed push).
    localStorage.setItem("moduo.preferences", JSON.stringify({ landingView: "tasks" }));
    setSyncMeta("preferences", {
      userId: "user-A",
      updatedAt: "2026-10-21T08:00:00.000Z",
      dirty: true,
    });

    const user = userEvent.setup();
    render(<AdvancedSection />);
    await user.click(screen.getByRole("button", { name: /Reset local cache/ }));

    // If the dialog offers the reset, take it (a fix may instead block it, as for Notes).
    const confirm = await screen
      .findByRole("button", { name: /Reset & reload/ }, { timeout: 1000 })
      .catch(() => null);
    if (confirm) {
      await user.click(confirm);
      // performReset clears localStorage, then deletes the IndexedDB stores and reloads.
      await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(true));
      await new Promise((r) => setTimeout(r, 50));
    }

    // The change that never reached A's account is still on this device, still marked to send.
    expect(getSyncMeta("preferences")).toMatchObject({ userId: "user-A", dirty: true });
    expect(JSON.parse(localStorage.getItem("moduo.preferences") ?? "null")).toMatchObject({
      landingView: "tasks",
    });
  });
});
