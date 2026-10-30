import { describe, expect, it } from "@rstest/core";

import { hexToHsl, hslToHex, hueAttrs, normalizeHue, parseColor } from "./hue";

describe("calendar hues", () => {
  it("keeps a valid hex and a named hue, and turns anything else into a name", () => {
    expect(normalizeHue("#4F8EF7")).toBe("#4f8ef7");
    expect(normalizeHue("teal")).toBe("teal");
    expect(normalizeHue("#12")).toBe("gray");
    expect(normalizeHue(null)).toBe("gray");
  });

  it("paints a custom hex through --label and a name through its token", () => {
    expect(hueAttrs("blue")).toEqual({ "data-label": "blue" });
    expect(hueAttrs("#4f8ef7")).toEqual({
      "data-label": "custom",
      style: { "--label": "#4f8ef7" },
    });
  });

  it("reads hex, short hex, rgb and hsl input", () => {
    expect(parseColor("#4F8EF7")).toBe("#4f8ef7");
    expect(parseColor("4f8ef7")).toBe("#4f8ef7");
    expect(parseColor("#48f")).toBe("#4488ff");
    expect(parseColor("79, 142, 247")).toBe("#4f8ef7");
    expect(parseColor("rgb(79 142 247)")).toBe("#4f8ef7");
    expect(parseColor("hsl(0, 100%, 50%)")).toBe("#ff0000");
    expect(parseColor("300, 0, 0")).toBeNull();
    expect(parseColor("blue-ish")).toBeNull();
  });

  it("round-trips through hsl", () => {
    const [h, s, l] = hexToHsl("#4f8ef7");
    expect(parseColor(hslToHex(h, s, l))).toBe(hslToHex(h, s, l));
    expect(hexToHsl("#ff0000")).toEqual([0, 100, 50]);
  });
});
