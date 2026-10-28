// CALR-18 · AC33: choice blanks carry a caret; a blank that only shows a value doesn't.

import { describe, expect, it } from "@rstest/core";
import { render, screen } from "@testing-library/react";

import { Blank } from "./sentence-ui";

describe("sentence blanks", () => {
  it("a choice blank carries a caret, filled or not", () => {
    const { container } = render(
      <p>
        <Blank label="Day" value="Wednesday 28 October" placeholder="which day" />
        <Blank label="Time" value={null} placeholder="what time" />
      </p>,
    );
    const carets = container.querySelectorAll("[data-caret]");
    expect(carets).toHaveLength(2);
    for (const caret of carets) expect(caret.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("button", { name: /Day: Wednesday 28 October/ })).toBeTruthy();
  });

  it("a text blank that opens the details step has no caret", () => {
    const { container } = render(
      <Blank label="Your name" value={null} placeholder="your name" caret={false} />,
    );
    expect(container.querySelector("[data-caret]")).toBeNull();
  });
});
