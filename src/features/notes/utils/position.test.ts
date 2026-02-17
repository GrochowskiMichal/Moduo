import { describe, expect, it } from "vitest";
import { generatePosition, initialPosition } from "./position";

describe("position helpers", () => {
  it("returns initial position when both bounds are missing", () => {
    expect(generatePosition()).toBe(initialPosition());
  });

  it("generates a value between prev and next when possible", () => {
    const pos = generatePosition("0000000000001000", "0000000000003000");
    expect(pos).toBe("0000000000002000");
  });

  it("appends at end when only prev exists", () => {
    const pos = generatePosition("0000000000002000", null);
    expect(pos > "0000000000002000").toBe(true);
  });
});
