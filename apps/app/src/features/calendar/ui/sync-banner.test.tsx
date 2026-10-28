// AC2's banner: it says what the status says and offers Try again; with
// nothing wrong it isn't there.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { calendarSyncStatus } from "../sync-status";
import { SyncBanner } from "./sync-banner";

afterEach(cleanup);

const failed = calendarSyncStatus({
  accounts: [
    {
      id: "work",
      workspaceId: "w1",
      ownerId: "u1",
      provider: "google",
      externalId: "google:robin.hale@gmail.com:work",
      displayLabel: "Work",
      isDefaultTarget: false,
      color: null,
      lastSyncAt: null,
      status: "error",
      syncToken: null,
      deletedAt: null,
    },
  ],
  degraded: false,
});

describe("the sync banner", () => {
  it("names the account and offers Try again", () => {
    const onRetry = rs.fn();
    render(<SyncBanner status={failed} onRetry={onRetry} />);
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("robin.hale@gmail.com");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("says when it is trying again", () => {
    render(<SyncBanner status={failed} onRetry={() => {}} retrying />);
    const button = screen.getByRole("button", { name: /Trying/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("is absent when everything synced", () => {
    const ok = calendarSyncStatus({ accounts: [], degraded: false });
    const { container } = render(<SyncBanner status={ok} onRetry={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("the banner for a revoked Google connection (AC37)", () => {
  const revoked = calendarSyncStatus({
    accounts: [
      {
        id: "family",
        workspaceId: "w1",
        ownerId: "u1",
        provider: "google",
        externalId: "google:robin.hale@gmail.com:family",
        displayLabel: "Family",
        isDefaultTarget: false,
        color: null,
        lastSyncAt: "2026-10-25T17:02:00.000Z",
        status: "reauth",
        syncToken: null,
        deletedAt: null,
      },
    ],
    degraded: false,
  });

  it("offers Reconnect, naming the login, instead of Try again", () => {
    const onRetry = rs.fn();
    const onReconnect = rs.fn();
    render(<SyncBanner status={revoked} onRetry={onRetry} onReconnect={onReconnect} />);
    expect(screen.getByRole("status").textContent).toContain("booking links can't see it");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(onReconnect).toHaveBeenCalledWith("robin.hale@gmail.com");
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("a plain failure still offers Try again only", () => {
    render(<SyncBanner status={failed} onRetry={() => {}} onReconnect={() => {}} />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
  });
});
