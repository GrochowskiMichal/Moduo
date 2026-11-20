// Settings → Mail → Accounts (specs/mail-v3.md §12, A1, AC35): each account is
// a card with its hue dot and label, its live state, push or polling, when it
// last synced, its history depth with "Each device keeps its own.", and Sync
// now, Sign in again (only when it needs it) and Disconnect.

import { afterEach, describe, expect, it, rstest } from "@rstest/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  AccountsGroup,
  accountStatus,
  pushLine,
  type SettingsAccount,
  toSettingsAccount,
} from "./accounts-group";

afterEach(cleanup);

const NOW = new Date(2026, 10, 6, 11, 0).getTime();

const account = (over: Partial<SettingsAccount> = {}): SettingsAccount => ({
  id: "a1",
  address: "me@hale.test",
  label: "Work",
  hue: "blue",
  state: "idle",
  status: "Up to date",
  needsReconnect: false,
  push: true,
  lastSyncedMs: NOW - 2 * 60_000,
  depth: "twelveMonths",
  ...over,
});

function mount(accounts: SettingsAccount[]) {
  const actions = {
    reconnect: rstest.fn(),
    disconnect: rstest.fn(),
    setDepth: rstest.fn(),
    syncNow: rstest.fn(),
  };
  render(
    <TooltipProvider>
      <AccountsGroup accounts={accounts} actions={actions} nowMs={NOW} />
    </TooltipProvider>,
  );
  return actions;
}

describe("Settings → Mail account cards (AC35)", () => {
  it("state, push, last synced, depth, actions", () => {
    const actions = mount([
      account(),
      account({
        id: "a2",
        address: "me@icloud.test",
        label: "Personal",
        hue: "green",
        state: "reconnect",
        status: "Needs you to sign in again",
        needsReconnect: true,
        push: false,
        lastSyncedMs: null,
      }),
    ]);

    const work = screen.getByRole("article", { name: "Work" });
    expect(work.querySelector('[data-label="blue"]')).toBeTruthy();
    within(work).getByText("me@hale.test");
    expect(within(work).getByRole("status").textContent).toBe("Up to date");
    within(work).getByText("New mail arrives instantly · Last synced 2 minutes ago");
    within(work).getByText("History on this Mac");
    within(work).getByText("Each device keeps its own.");
    within(work).getByRole("combobox", { name: "History depth for me@hale.test" });
    // Sign in again is only for an account that needs it.
    expect(within(work).queryByRole("button", { name: "Sign in again" })).toBeNull();
    fireEvent.click(within(work).getByRole("button", { name: /Sync now/ }));
    expect(actions.syncNow).toHaveBeenCalledWith("a1");
    fireEvent.click(within(work).getByRole("button", { name: "Disconnect" }));
    fireEvent.click(
      within(work).getByRole("button", { name: "Disconnect and delete this Mac's copy" }),
    );
    expect(actions.disconnect).toHaveBeenCalledWith("a1");

    const personal = screen.getByRole("article", { name: "Personal" });
    expect(within(personal).getByRole("status").textContent).toBe("Needs you to sign in again");
    within(personal).getByText("Checks for new mail every minute");
    fireEvent.click(within(personal).getByRole("button", { name: "Sign in again" }));
    expect(actions.reconnect).toHaveBeenCalledWith("a2");
    expect(
      (within(personal).getByRole("button", { name: /Sync now/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("names every state with §12's copy", () => {
    expect(accountStatus("idle", null, null)).toBe("Up to date");
    expect(accountStatus("syncing", null, null)).toBe("Syncing…");
    expect(accountStatus("first_sync", null, null)).toBe("Syncing…");
    expect(accountStatus("backfilling", 0.4, null)).toBe("Getting history · 40%");
    expect(accountStatus("offline", null, null)).toBe("Offline");
    expect(accountStatus("reconnect", null, null)).toBe("Needs you to sign in again");
    expect(accountStatus("error", null, "the server refused the password")).toBe(
      "Can't sync: the server refused the password",
    );
    expect(pushLine(true)).toBe("New mail arrives instantly");
    expect(pushLine(false)).toBe("Checks for new mail every minute");
    expect(pushLine(null)).toBeNull();
  });

  it("reads an engine account row: label, push, last synced and only reconnect signs in again", () => {
    const row = toSettingsAccount(
      {
        id: "a1",
        address: "me@hale.test",
        displayName: "Work",
        syncState: "backfilling",
        backfillProgress: 0.4,
        lastError: null,
        historyDepth: "threeMonths",
        lastSyncedMs: NOW,
        push: true,
      },
      1,
    );
    expect(row).toMatchObject({
      label: "Work",
      status: "Getting history · 40%",
      needsReconnect: false,
      push: true,
      lastSyncedMs: NOW,
      depth: "threeMonths",
    });
    const failing = toSettingsAccount({
      id: "a2",
      address: "x@y.test",
      syncState: "error",
      lastError: "timed out",
    });
    expect(failing.status).toBe("Can't sync: timed out");
    expect(failing.needsReconnect).toBe(false);
    expect(failing.push).toBeNull();
  });
});
