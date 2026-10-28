// CALR-20b contract: the "New events go to" field, shown in Calendar accounts
// and in Settings › Integrations. It names where new events go now and, when
// the chosen calendar can't take them any more, says they go to Your calendar.

import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import { YOUR_CALENDAR_LABEL } from "../new-events-to";
import { accountIdFromOption, NewEventsToField } from "./new-events-to-field";

afterEach(cleanup);

const CALENDARS = [
  { id: "acc-work", label: "Work" },
  { id: "acc-family", label: "Family" },
];

describe("New events go to", () => {
  it("shows Your calendar · Moduo by default", () => {
    render(
      <NewEventsToField
        calendars={CALENDARS}
        to={{ accountId: null, label: YOUR_CALENDAR_LABEL, fallback: null }}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole("combobox", { name: "New events go to" }).textContent).toContain(
      YOUR_CALENDAR_LABEL,
    );
  });

  it("shows the chosen Google calendar", () => {
    render(
      <NewEventsToField
        calendars={CALENDARS}
        to={{ accountId: "acc-family", label: "Family", fallback: null }}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole("combobox", { name: "New events go to" }).textContent).toContain(
      "Family",
    );
  });

  it("says so when it fell back to Your calendar", () => {
    const fallback = "Holidays is read only now, so new events go to Your calendar.";
    render(
      <NewEventsToField
        calendars={CALENDARS}
        to={{ accountId: null, label: YOUR_CALENDAR_LABEL, fallback }}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText(fallback)).toBeTruthy();
  });

  it("without Google, says Your calendar is the one place and offers no picker", () => {
    render(
      <NewEventsToField
        calendars={[]}
        to={{ accountId: null, label: YOUR_CALENDAR_LABEL, fallback: null }}
        onChange={() => undefined}
      />,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(/New events go to Your calendar · Moduo/)).toBeTruthy();
  });

  it("reads Your calendar as no account, and a calendar as its account", () => {
    expect(accountIdFromOption("moduo")).toBeNull();
    expect(accountIdFromOption("acc-work")).toBe("acc-work");
  });
});
