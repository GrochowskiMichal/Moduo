import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { lazySection, SettingsSectionView } from "./section-loader";

afterEach(cleanup);

describe("Settings sections", () => {
  it("shows a Retry when a section's chunk can't load, and loads it on Retry", async () => {
    const error = rs.spyOn(console, "error").mockImplementation(() => {});
    let online = false;
    const section = lazySection(() =>
      online
        ? Promise.resolve(() => <p>Billing loaded</p>)
        : Promise.reject(new Error("Loading chunk billing-section failed")),
    );

    render(<SettingsSectionView section={section} />);
    expect((await screen.findByRole("alert")).textContent).toContain("couldn't load");

    online = true;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Billing loaded")).toBeTruthy();
    error.mockRestore();
  });

  it("renders an eager section without a chunk to fetch", () => {
    render(<SettingsSectionView section={() => <p>Now</p>} />);
    expect(screen.getByText("Now")).toBeTruthy();
  });
});
