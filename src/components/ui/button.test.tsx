// DS-2 — no no-op hovers (DS-AC5). On dark, the old secondary button rested on
// bg-secondary and hovered to bg-accent: the same grey on every shade, so
// nothing changed. Neutral variants now step up the state layer
// (tokens.css §5b): their hover is a state token, and never the rest fill.

import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import { Button } from "./button";

afterEach(cleanup);

const STATE_STEP = ["state-hover", "state-active", "state-active-hover"];

/** The background a class list paints at rest, and on hover. */
function fills(className: string) {
  const classes = className.split(/\s+/);
  const rest = classes.find((c) => /^bg-/.test(c))?.slice(3) ?? "transparent";
  const hover = classes.find((c) => /^hover:bg-/.test(c))?.slice("hover:bg-".length);
  return { rest, hover };
}

describe("Button states", () => {
  for (const variant of ["secondary", "outline", "ghost"] as const) {
    it(`hover differs from rest (${variant})`, () => {
      render(<Button variant={variant}>{variant}</Button>);
      const { rest, hover } = fills(screen.getByRole("button", { name: variant }).className);
      expect({ variant, hoverIsStateToken: STATE_STEP.includes(hover ?? "") }).toEqual({
        variant,
        hoverIsStateToken: true,
      });
      expect(hover).not.toBe(rest);
    });
  }

  it("neutral variants never use the colliding accent/secondary greys", () => {
    for (const variant of ["secondary", "outline", "ghost"] as const) {
      render(<Button variant={variant}>{`${variant}-greys`}</Button>);
      const className = screen.getByRole("button", { name: `${variant}-greys` }).className;
      expect({ variant, className: /\bbg-(accent|secondary)\b/.test(className) }).toEqual({
        variant,
        className: false,
      });
    }
  });

  it("a secondary button's hover is one step above its fill", () => {
    render(<Button variant="secondary">Step</Button>);
    const { rest, hover } = fills(screen.getByRole("button", { name: "Step" }).className);
    expect(STATE_STEP.indexOf(hover ?? "")).toBeGreaterThan(STATE_STEP.indexOf(rest));
  });
});
