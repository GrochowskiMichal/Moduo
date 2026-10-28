// Connect a calendar (CALR-20, AC36): provider tiles that say the truth, a
// consent step naming each permission, where events are kept and what Moduo
// doesn't read, "Finish in your browser", a calendar picker, and import
// progress that can be closed.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { CalendarPick } from "../account-picks";
import {
  CalendarPicker,
  ConnectTiles,
  FinishInBrowser,
  GoogleConsent,
  ImportProgress,
} from "./calendar-connect-steps";

afterEach(cleanup);

describe("connect a calendar (AC36)", () => {
  it("tiles say what each provider does here", () => {
    const onPick = rs.fn();
    render(<ConnectTiles onPick={onPick} />);
    const google = screen.getByRole("button", { name: /Google/ });
    expect(google.textContent).toContain("Syncs both ways");
    expect(google.textContent).toContain("Meet links");
    expect(screen.getByRole("button", { name: /Microsoft 365 or Outlook/ }).textContent).toContain(
      "View only",
    );
    expect(screen.getByRole("button", { name: /iCloud or CalDAV/ }).textContent).toContain(
      "app-specific password",
    );
    expect(screen.getByRole("button", { name: /Subscribe by link/ }).textContent).toContain(".ics");
    fireEvent.click(google);
    expect(onPick).toHaveBeenCalledWith("google");
    fireEvent.click(screen.getByRole("button", { name: /Subscribe by link/ }));
    expect(onPick).toHaveBeenCalledWith("ics");
  });

  it("the consent step names each permission, where events are kept and what Moduo doesn't read", () => {
    const onBack = rs.fn();
    const onContinue = rs.fn();
    render(<GoogleConsent onBack={onBack} onContinue={onContinue} />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/See your calendars and their events/);
    expect(text).toMatch(/Add, change and delete events/);
    expect(text).toMatch(/name and email address/);
    expect(text).toMatch(/London, UK/);
    expect(text).toMatch(/doesn't read your email/);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Continue to Google/ }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("finishing in the browser can open the page again or cancel", () => {
    const onOpenAgain = rs.fn();
    const onCancel = rs.fn();
    render(<FinishInBrowser onOpenAgain={onOpenAgain} onCancel={onCancel} />);
    expect(screen.getByText(/Finish in your browser/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open the Google page again/ }));
    expect(onOpenAgain).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("the picker shows each calendar with show and busy, and confirms the picks", () => {
    const picks: CalendarPick[] = [
      {
        externalId: "google:r:r",
        name: "Robin",
        readOnly: false,
        primary: true,
        accountId: null,
        show: true,
        busy: true,
      },
      {
        externalId: "google:r:f",
        name: "Family",
        readOnly: false,
        primary: false,
        accountId: null,
        show: true,
        busy: true,
      },
      {
        externalId: "google:r:h",
        name: "Holidays",
        readOnly: true,
        primary: false,
        accountId: null,
        show: false,
        busy: false,
      },
    ];
    const onConfirm = rs.fn();
    render(<CalendarPicker email="robin@example.com" picks={picks} onConfirm={onConfirm} />);
    expect(screen.getByText(/robin@example\.com is connected/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Holidays in your week" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Family counts as busy for booking links" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Show 3 calendars/ }));
    expect(onConfirm).toHaveBeenCalledWith([
      picks[0],
      { ...picks[1], busy: false },
      { ...picks[2], show: true },
    ]);
  });

  it("one calendar shown says so in the singular", () => {
    const picks: CalendarPick[] = [
      {
        externalId: "google:r:r",
        name: "Robin",
        readOnly: false,
        primary: true,
        accountId: null,
        show: true,
        busy: true,
      },
      {
        externalId: "google:r:h",
        name: "Holidays",
        readOnly: true,
        primary: false,
        accountId: null,
        show: false,
        busy: false,
      },
    ];
    render(<CalendarPicker email="robin@example.com" picks={picks} onConfirm={() => {}} />);
    expect(screen.getByRole("button", { name: /Show 1 calendar\b/ })).toBeTruthy();
  });

  it("import progress says how far it is and that you can close it", () => {
    const onClose = rs.fn();
    render(<ImportProgress events={214} done={1} total={2} onClose={onClose} />);
    expect(screen.getByText("Bringing in 214 events · 50%")).toBeTruthy();
    expect(screen.getByText(/You can close this; it carries on/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
