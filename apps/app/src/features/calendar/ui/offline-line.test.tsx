// Offline: the toolbar's now-and-next line gives way to "Offline · 2 to sync",
// which opens the list of waiting changes; with nothing waiting it just says
// "Offline".

import { afterEach, describe, expect, it } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CalendarNowNext } from "./now-next";
import { OfflineLine, offlineLabel } from "./offline-line";

afterEach(() => {
  cleanup();
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => true });
});

describe("the offline line", () => {
  it("counts what waits", () => {
    expect(offlineLabel(0)).toBe("Offline");
    expect(offlineLabel(2)).toBe("Offline · 2 to sync");
  });

  it("with nothing waiting it is a quiet word, not a button", () => {
    render(<OfflineLine waiting={[]} />);
    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("opens the list of waiting changes", () => {
    render(
      <OfflineLine
        waiting={[
          { id: "e1", title: "Investor prep" },
          { id: "e2", title: "Lunch with Tom" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Offline · 2 to sync/ }));
    expect(screen.getByText("Investor prep")).toBeTruthy();
    expect(screen.getByText("Lunch with Tom")).toBeTruthy();
  });

  it("takes the now-and-next line's place when the network goes", () => {
    render(<CalendarNowNext events={[]} onOpen={() => {}} />);
    expect(screen.queryByText("Offline")).toBeNull();
    Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => false });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText("Offline")).toBeTruthy();
  });
});
