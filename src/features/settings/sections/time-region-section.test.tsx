// TV-D14 · Settings → Time & region redraws with the setting (AC12.7).

import { afterEach, describe, expect, it } from "@rstest/core";
import { act, render, screen } from "@testing-library/react";

import {
  applyTimeRegion,
  EMPTY_TIME_REGION,
  resetTimeRegionForTests,
} from "../../../lib/time-region";
import { TimeRegionSection } from "./time-region-section";

afterEach(() => resetTimeRegionForTests());

describe("TimeRegionSection", () => {
  it("its samples follow the clock and the date order as they change", () => {
    applyTimeRegion({ ...EMPTY_TIME_REGION, hourCycle: "h12", dateOrder: "month_day" }, null);
    render(<TimeRegionSection />);
    expect(screen.getByText(/Times read like 3:00\sPM\./)).toBeTruthy();
    expect(screen.getByText("Dates read like Oct 16.")).toBeTruthy();
    act(() =>
      applyTimeRegion({ ...EMPTY_TIME_REGION, hourCycle: "h23", dateOrder: "day_month" }, null),
    );
    expect(screen.getByText("Times read like 15:00.")).toBeTruthy();
    expect(screen.getByText("Dates read like 16 Oct.")).toBeTruthy();
  });
});
