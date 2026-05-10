import { describe, expect, it } from "vitest";
import { normalizeHexColor } from "./colors";

describe("normalizeHexColor", () => {
  it("normalizes 6-digit hex (with or without #)", () => {
    expect(normalizeHexColor("#a1b2c3")).toBe("#A1B2C3");
    expect(normalizeHexColor("a1b2c3")).toBe("#A1B2C3");
  });

  it("expands 3-digit hex", () => {
    expect(normalizeHexColor("#abc")).toBe("#AABBCC");
    expect(normalizeHexColor("abc")).toBe("#AABBCC");
  });

  it("rejects invalid input", () => {
    expect(normalizeHexColor("")).toBeNull();
    expect(normalizeHexColor("#abcd")).toBeNull();
    expect(normalizeHexColor("#zzzzzz")).toBeNull();
    expect(normalizeHexColor("not-a-color")).toBeNull();
  });
});

