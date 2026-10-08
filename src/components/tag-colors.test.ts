import { describe, expect, it } from "@rstest/core";

import { DEFAULT_LABEL_COLOR, LABEL_COLORS, normalizeLabelColor, pickTagColor } from "./tag-colors";

describe("normalizeLabelColor", () => {
  it("passes through known hues", () => {
    expect(normalizeLabelColor("blue")).toBe("blue");
    expect(normalizeLabelColor("pink")).toBe("pink");
  });

  it("falls back to the default for unknown / empty values", () => {
    expect(normalizeLabelColor(null)).toBe(DEFAULT_LABEL_COLOR);
    expect(normalizeLabelColor(undefined)).toBe(DEFAULT_LABEL_COLOR);
    expect(normalizeLabelColor("#ff0000")).toBe(DEFAULT_LABEL_COLOR);
  });
});

describe("pickTagColor", () => {
  it("starts at the first palette hue", () => {
    expect(pickTagColor([])).toBe(LABEL_COLORS[0]);
  });

  it("spreads across hues as tags accumulate (least-used wins)", () => {
    const existing = [{ color: "blue" }];
    expect(pickTagColor(existing)).toBe(LABEL_COLORS[1]);
  });

  it("is deterministic", () => {
    const existing = [{ color: "blue" }, { color: "green" }, { color: "blue" }];
    expect(pickTagColor(existing)).toBe(pickTagColor(existing));
  });

  it("reaches gray only once every colored hue is used", () => {
    const colored = LABEL_COLORS.filter((c) => c !== "gray");
    // colored hues partially used → still prefers an unused colored hue over gray
    expect(pickTagColor([{ color: "blue" }, { color: "green" }])).not.toBe("gray");
    // one of each colored hue used once, gray unused → gray is now the unique least-used
    expect(pickTagColor(colored.map((color) => ({ color })))).toBe("gray");
  });
});
