// AC2's banner speaks only when the person can do something: Try again when the
// calendar didn't load, Reconnect for a revoked login. An account that merely
// failed to sync gets no banner (it retries in the background; its rail row says
// when it last synced).

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

const unloaded = calendarSyncStatus({ accounts: [], degraded: true });

describe("the sync banner", () => {
  it("says nothing about an account that only failed to sync", () => {
    const { container } = render(<SyncBanner status={failed} onRetry={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("offers Try again when the calendar didn't load", () => {
    const onRetry = rs.fn();
    render(<SyncBanner status={unloaded} onRetry={onRetry} />);
    expect(screen.getByRole("status").textContent).toContain("didn't load");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("says when it is trying again", () => {
    render(<SyncBanner status={unloaded} onRetry={() => {}} retrying />);
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

  it("a plain failure has no banner, so nothing to press", () => {
    const { container } = render(
      <SyncBanner status={failed} onRetry={() => {}} onReconnect={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
