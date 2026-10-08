// DS-2 — the current segment is a RAISED plate: lighter than its bg-muted track
// on dark (the old bg-card plate was darker, so the icon-only view switcher
// lost its current view), the white card + a shadow on light.
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import { blocksWithSelectors, cssBlocks, declarations } from "@/styles/css-blocks";
import { SegmentedControl } from "./segmented-control";
import { TooltipProvider } from "./tooltip";

afterEach(cleanup);

/** Lightness of an `oklch(L …)` value, resolving `var(--neutral-…)` once. */
function lightness(value: string, palette: Map<string, string>): number {
  const resolved = value.replace(/var\((--[\w-]+)\)/, (_, name: string) => palette.get(name) ?? "");
  const match = resolved.match(/oklch\(\s*([\d.]+)/);
  if (!match) throw new Error(`not an oklch value: ${value}`);
  return Number(match[1]);
}

describe("SegmentedControl raised plate", () => {
  it("renders the current segment on the raised-plate tokens, on a muted track", () => {
    render(
      <TooltipProvider>
        <SegmentedControl
          aria-label="View"
          value="board"
          onValueChange={() => {}}
          items={[
            { value: "list", label: "List" },
            { value: "board", label: "Board" },
          ]}
        />
      </TooltipProvider>,
    );
    const track = screen.getByRole("radiogroup", { name: "View" });
    expect(track.className).toContain("bg-muted");
    const current = screen.getByRole("radio", { name: "Board" });
    expect(current.getAttribute("data-state")).toBe("on");
    for (const cls of ["aria-checked:bg-control-raised", "aria-checked:shadow-control-raised"]) {
      expect(current.className).toContain(cls);
    }
    expect(current.className).not.toContain("bg-card");
  });

  it("keeps the plate on the icon-only switcher, where the tooltip owns data-state", () => {
    render(
      <TooltipProvider>
        <SegmentedControl
          aria-label="View icons"
          iconOnly
          value="board"
          onValueChange={() => {}}
          items={[
            { value: "list", ariaLabel: "List" },
            { value: "board", ariaLabel: "Board" },
          ]}
        />
      </TooltipProvider>,
    );
    const current = screen.getByRole("radio", { name: "Board" });
    // The tooltip trigger overwrites data-state, so the style must not depend on it.
    expect(current.getAttribute("data-state")).not.toBe("on");
    expect(current.getAttribute("aria-checked")).toBe("true");
    expect(current.className).toContain("aria-checked:bg-control-raised");
    expect(current.className).not.toMatch(/data-\[state=on\]/);
  });

  it("plate lighter than track on dark, on every shade", async () => {
    const blocks = cssBlocks(
      await fs.readFile(path.join(process.cwd(), "src/styles/tokens.css"), "utf8"),
    );
    const palette = declarations(blocksWithSelectors(blocks, [":root"])[0]);
    const formula = declarations(blocks.find((b) => b.prelude.startsWith(":where(:root"))!).get(
      "--control-raised",
    );
    expect(formula).toBe("color-mix(in oklab, var(--foreground) 14%, var(--muted))");

    const dark = declarations(
      blocks.find(
        (b) => b.prelude === ':root, [data-theme="dark"]' && declarations(b).has("--muted"),
      )!,
    );
    const foreground = lightness(dark.get("--foreground")!, palette);
    const shades = blocks.filter((b) =>
      /^\[data-shade="\w+"\]:not\(\[data-theme="light"\]\)$/.test(b.prelude),
    );
    expect(shades).toHaveLength(6);

    for (const scope of [dark, ...shades.map(declarations)]) {
      const track = lightness(scope.get("--muted")!, palette);
      // color-mix in oklab interpolates L linearly between two opaque colours.
      const plate = 0.14 * foreground + 0.86 * track;
      expect(plate - track).toBeGreaterThan(0.08);
    }
  });

  it("plate is the card on light, lifted by a shadow", async () => {
    const blocks = cssBlocks(
      await fs.readFile(path.join(process.cwd(), "src/styles/tokens.css"), "utf8"),
    );
    const light = blocks.find(
      (b) =>
        b.prelude.startsWith('[data-theme="light"],') && declarations(b).has("--control-raised"),
    );
    expect(light && declarations(light).get("--control-raised")).toBe("var(--card)");
    const lightTheme = blocks.find(
      (b) => b.prelude === '[data-theme="light"]' && declarations(b).has("--shadow-control-raised"),
    );
    expect(lightTheme && declarations(lightTheme).get("--shadow-control-raised")).toBe(
      "var(--shadow-sm)",
    );
  });
});
