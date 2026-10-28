// Calendar accounts (CALR-20, AC35, AC37): the accounts list and Connect an
// account…, meeting links, the selected account's sync and Sync now, its
// calendars with Show in your week and Counts as busy for booking links, what
// the account does here, Remove with its consequences and Undo, a revoked
// login's Reconnect, and where new events go.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { CalendarPick } from "../account-picks";
import { REMOVE_CONSEQUENCES } from "../account-removal";
import { type AccountLoginView, CalendarAccountsView } from "./calendar-accounts-view";

afterEach(cleanup);

const ROBIN = "robin.hale@gmail.com";
const robinCalendars: CalendarPick[] = [
  {
    externalId: `google:${ROBIN}:${ROBIN}`,
    name: "Robin",
    readOnly: false,
    primary: true,
    accountId: "a-robin",
    show: true,
    busy: true,
  },
  {
    externalId: `google:${ROBIN}:family`,
    name: "Family",
    readOnly: false,
    primary: false,
    accountId: "a-family",
    show: false,
    busy: true,
  },
  {
    externalId: `google:${ROBIN}:holidays`,
    name: "Holidays in Poland",
    readOnly: true,
    primary: false,
    accountId: null,
    show: false,
    busy: false,
  },
];
const robin: AccountLoginView = {
  key: `google:${ROBIN}`,
  provider: "google",
  login: ROBIN,
  state: "ok",
  lastSyncAt: new Date(Date.now() - 60_000).toISOString(),
  calendars: robinCalendars,
  accountIds: ["a-robin", "a-family"],
};
const ana: AccountLoginView = {
  key: "google:ana@halefounders.co",
  provider: "google",
  login: "ana@halefounders.co",
  state: "reauth",
  lastSyncAt: "2026-10-25T17:02:00.000Z",
  calendars: [],
  accountIds: ["a-ana"],
};

function view(over: Partial<Parameters<typeof CalendarAccountsView>[0]> = {}) {
  const props = {
    logins: [robin, ana],
    selectedKey: robin.key,
    onSelect: rs.fn(),
    onConnect: rs.fn(),
    onToggleShow: rs.fn(),
    onToggleBusy: rs.fn(),
    onSyncNow: rs.fn(),
    syncing: false,
    onRemove: rs.fn(),
    onReconnect: rs.fn(),
    meetingLinks: { googleMeet: true, zoom: "available" as const },
    onConnectZoom: rs.fn(),
    removed: null,
    ...over,
  };
  render(<CalendarAccountsView {...props} />);
  return props;
}

describe("Calendar accounts (AC35)", () => {
  it("lists the accounts and connects another", () => {
    const props = view();
    expect(screen.getAllByText(ROBIN).length).toBeGreaterThan(0);
    expect(screen.getAllByText("ana@halefounders.co").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Connect an account/ }));
    expect(props.onConnect).toHaveBeenCalledTimes(1);
  });

  it("selects another account", () => {
    const props = view();
    fireEvent.click(screen.getByRole("button", { name: /ana@halefounders\.co/ }));
    expect(props.onSelect).toHaveBeenCalledWith(ana.key);
  });

  it("shows meeting links: Google Meet ready, Zoom to connect", () => {
    const props = view();
    expect(screen.getByText("Google Meet")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Connect Zoom/ }));
    expect(props.onConnectZoom).toHaveBeenCalledTimes(1);
  });

  it("Zoom connected says so", () => {
    view({ meetingLinks: { googleMeet: true, zoom: "connected" } });
    expect(screen.queryByRole("button", { name: /Connect Zoom/ })).toBeNull();
  });

  it("the selected account syncs now", () => {
    const props = view();
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    expect(props.onSyncNow).toHaveBeenCalledWith(robin.key);
  });

  it("each calendar has Show in your week and Counts as busy for booking links", () => {
    const props = view();
    const showRobin = screen.getByRole("checkbox", { name: "Show Robin in your week" });
    const showFamily = screen.getByRole("checkbox", { name: "Show Family in your week" });
    const busyFamily = screen.getByRole("checkbox", {
      name: "Family counts as busy for booking links",
    });
    expect(
      showRobin.getAttribute("aria-checked") ?? String((showRobin as HTMLInputElement).checked),
    ).toBe("true");
    expect(
      showFamily.getAttribute("aria-checked") ?? String((showFamily as HTMLInputElement).checked),
    ).toBe("false");
    expect(
      busyFamily.getAttribute("aria-checked") ?? String((busyFamily as HTMLInputElement).checked),
    ).toBe("true");
    fireEvent.click(showFamily);
    expect(props.onToggleShow).toHaveBeenCalledWith(robinCalendars[1], true);
    fireEvent.click(busyFamily);
    expect(props.onToggleBusy).toHaveBeenCalledWith(robinCalendars[1], false);
  });

  it("a read-only calendar says View only", () => {
    view();
    expect(screen.getByText(/View only/)).toBeTruthy();
  });

  it("says what a Google account does here and where new events go", () => {
    view();
    expect(screen.getByText(/save to Google and back within a minute/)).toBeTruthy();
    expect(screen.getByText(/sent by Google/)).toBeTruthy();
    expect(screen.getByText(/New events go to Your calendar · Moduo/)).toBeTruthy();
  });

  it("Remove this account… removes it", () => {
    const props = view();
    fireEvent.click(screen.getByRole("button", { name: /Remove this account/ }));
    expect(props.onRemove).toHaveBeenCalledWith(robin.key);
  });

  it("a removed account says what happened, with Undo", () => {
    const onUndo = rs.fn();
    view({ removed: { label: ROBIN, onUndo } });
    expect(screen.getByText(REMOVE_CONSEQUENCES, { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});

describe("Calendar accounts for a revoked login (AC37)", () => {
  it("shows the notice with Reconnect and the booking-link risk", () => {
    const props = view({ selectedKey: ana.key });
    expect(
      screen.getByText(/Google stopped accepting Moduo's access to ana@halefounders\.co/),
    ).toBeTruthy();
    expect(screen.getByText(/booking links can't see/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Reconnect/ }));
    expect(props.onReconnect).toHaveBeenCalledWith(ana.key);
  });
});
