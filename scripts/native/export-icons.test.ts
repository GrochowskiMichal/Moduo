import { describe, expect, it } from "bun:test";

import { committedIcons, exportIcons, kebab } from "./export-icons";

// NF-5 (specs/native-foundation.md): the native app's icons are the web app's lucide icons,
// rendered from the same package version. These keep the committed SVGs from drifting.
describe("native icons", () => {
  it("the committed icons match lucide-react and the brand master", () => {
    const want = exportIcons();
    const have = committedIcons();
    expect([...have.keys()].sort()).toEqual([...want.keys()].sort());
    for (const [path, svg] of want) expect({ path, svg: have.get(path) }).toEqual({ path, svg });
  });

  it("covers every icon the shell and Tasks import", () => {
    expect(exportIcons().size).toBeGreaterThan(100);
  });

  it("names a file the way lucide names the icon", () => {
    expect(kebab("ChevronDownIcon")).toBe("chevron-down");
    expect(kebab("Trash2")).toBe("trash-2");
    expect(kebab("Grid2x2")).toBe("grid-2x2");
    expect(kebab("CircleUserRound")).toBe("circle-user-round");
    expect(kebab("BarChart2")).toBe("bar-chart-2");
  });
});
