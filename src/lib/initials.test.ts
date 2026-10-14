import { describe, expect, it } from "@rstest/core";

import { initialsOf } from "./initials";

describe("initialsOf — two initials (call 43)", () => {
  it("first and last name", () => {
    expect(initialsOf("Maciej Grzywacz")).toBe("MG");
    expect(initialsOf("  anna  maria  nowak ")).toBe("AN");
  });

  it("a one-word name keeps two letters, never one", () => {
    expect(initialsOf("Mike")).toBe("MI");
    expect(initialsOf("Ó")).toBe("Ó");
  });

  it("an empty name is a placeholder", () => {
    expect(initialsOf("   ")).toBe("?");
  });
});
