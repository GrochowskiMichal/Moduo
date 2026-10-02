// DF-18 — one detail-panel title scale. Before this, the same object (an
// entity's own name) rendered at 13px / 14px / 15px / 24px / 30px across six
// surfaces, half of them on the display face.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DetailTitle, detailTitleVariants } from "./detail-title";
import { Input } from "./input";

afterEach(cleanup);

describe("DetailTitle", () => {
  it("defaults to the rail scale on a real heading element", () => {
    render(<DetailTitle>Ship the alpha</DetailTitle>);
    const el = screen.getByRole("heading", { name: "Ship the alpha" });
    expect(el.tagName).toBe("H2");
    expect(el.className).toContain("text-md");
    expect(el.className).toContain("text-foreground");
  });

  it("uses the body face — an entity's own name is content, not chrome (R4)", () => {
    render(<DetailTitle>Acme</DetailTitle>);
    const el = screen.getByRole("heading", { name: "Acme" });
    expect(el.className).toContain("font-sans");
    expect(el.className).not.toContain("font-display");
  });

  it("size=page is the centered-hub step", () => {
    render(<DetailTitle size="page">Acme Inc</DetailTitle>);
    expect(screen.getByRole("heading", { name: "Acme Inc" }).className).toContain("text-2xl");
  });

  it("asChild wins over the Input primitive's own text-base base", () => {
    // The real risk: `Input`'s fieldShell base carries `text-base`, so a naive
    // merge would leave editable titles a size below the static ones.
    render(
      <DetailTitle asChild>
        <Input aria-label="Task title" defaultValue="Draft" />
      </DetailTitle>,
    );
    const input = screen.getByLabelText("Task title");
    expect(input.tagName).toBe("INPUT");
    expect(input.className).toContain("text-md");
    expect(input.className).not.toMatch(/(?:^|\s)text-base(?:\s|$)/);
  });

  it("exposes the recipe for title inputs that already own their className", () => {
    expect(detailTitleVariants()).toContain("text-md");
    expect(detailTitleVariants({ size: "page" })).toContain("text-2xl");
  });
});
