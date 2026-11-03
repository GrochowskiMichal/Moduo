import { describe, expect, it } from "@rstest/core";
import { render, screen } from "@testing-library/react";

import { EmailWebView } from "./email-web-view";

const empty = { snoozed: [], followUps: [], tissueRefs: [] };

describe("EmailWebView (AC41)", () => {
  it("loading: shows a loading state, not the empty state, until the tissue arrives", () => {
    const { rerender } = render(<EmailWebView email={{ ...empty, loading: true }} highlightedRefId={null} />);
    screen.getByRole("status", { name: "Loading email" });
    expect(screen.queryByText("Nothing linked yet")).toBeNull();
    rerender(<EmailWebView email={{ ...empty, loading: false }} highlightedRefId={null} />);
    expect(screen.queryByRole("status", { name: "Loading email" })).toBeNull();
    screen.getByText("Nothing linked yet");
  });
});
