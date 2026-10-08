// DS-3 · DS-AC8 (MetaCount) — icon + number, muted, 12 px, hidden at zero.

import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";
import { Paperclip } from "lucide-react";

import { MetaCount, MetaCounts } from "./meta-count";

afterEach(cleanup);

describe("MetaCount", () => {
  it("shows the icon and the number, quiet, and names both for a screen reader", () => {
    render(<MetaCount icon={Paperclip} count={2} label="attachments" />);
    const el = document.querySelector('[data-slot="meta-count"]') as HTMLElement;
    expect(el.textContent).toContain("2");
    expect(el.querySelector("svg")?.getAttribute("class")).toContain("size-icon-xs");
    expect(el.className).toContain("text-xs");
    expect(el.className).toContain("text-muted-foreground");
    expect(el.className).toContain("tabular-nums");
    expect(screen.getByText("2 attachments").className).toContain("sr-only");
  });

  it("renders nothing at zero (and for a negative or non-finite count)", () => {
    render(
      <MetaCounts data-testid="group">
        <MetaCount icon={Paperclip} count={0} label="attachments" />
        <MetaCount icon={Paperclip} count={-1} label="attachments" />
        <MetaCount icon={Paperclip} count={Number.NaN} label="attachments" />
      </MetaCounts>,
    );
    expect(screen.getByTestId("group").childElementCount).toBe(0);
  });

  it("can show a value other than the count (subtask progress), still hidden at zero", () => {
    render(
      <MetaCounts data-testid="group">
        <MetaCount icon={Paperclip} count={3} value="1/3" label={() => "1 of 3 subtasks done"} />
        <MetaCount icon={Paperclip} count={0} value="0/0" label="subtasks" />
      </MetaCounts>,
    );
    const group = screen.getByTestId("group");
    expect(group.childElementCount).toBe(1);
    expect(group.textContent).toContain("1/3");
    expect(screen.getByText("1 of 3 subtasks done").className).toContain("sr-only");
  });

  it("lets the caller word the label (singulars)", () => {
    render(
      <MetaCount icon={Paperclip} count={1} label={(n) => (n === 1 ? "1 attachment" : `${n}`)} />,
    );
    expect(screen.getByText("1 attachment")).toBeTruthy();
  });
});
