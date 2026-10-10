import { describe, expect, it } from "@rstest/core";

import {
  handleSearchPattern,
  handleWithCurrentKey,
  normalizeTaskKey,
  TASK_KEY_PATTERN,
  taskHandle,
  taskKeyProblem,
} from "./task-handle";

describe("a task's handle (AC3.1)", () => {
  it("is the key and the number, unpadded", () => {
    expect(taskHandle("MOD", 142)).toBe("MOD-142");
    expect(taskHandle("ML", 7)).toBe("ML-7");
  });

  it("is missing until both the key and the number are known", () => {
    expect(taskHandle(null, 3)).toBeNull();
    expect(taskHandle("MOD", null)).toBeNull();
    expect(taskHandle("MOD", undefined)).toBeNull();
    expect(taskHandle("MOD", Number.NaN)).toBeNull();
  });
});

describe("the task key Settings saves", () => {
  it("is trimmed and upper-cased", () => {
    expect(normalizeTaskKey("  mod ")).toBe("MOD");
  });

  it("takes 2 to 5 letters and says why anything else won't save", () => {
    expect(taskKeyProblem("mod")).toBeNull();
    expect(taskKeyProblem("PLAN")).toBeNull();
    expect(taskKeyProblem("")).toBe("Type 2 to 5 letters.");
    expect(taskKeyProblem("   ")).toBe("Type 2 to 5 letters.");
    expect(taskKeyProblem("P1")).toBe("Use letters A to Z only.");
    expect(taskKeyProblem("ŁÓD")).toBe("Use letters A to Z only.");
    expect(taskKeyProblem("M")).toBe("Use 2 to 5 letters.");
    expect(taskKeyProblem("MODUOX")).toBe("Use 2 to 5 letters.");
  });

  it("matches the server's CHECK exactly when it has no problem", () => {
    for (const key of ["MO", "MODUO", "ab", "Abc"]) {
      expect(taskKeyProblem(key)).toBeNull();
      expect(TASK_KEY_PATTERN.test(normalizeTaskKey(key))).toBe(true);
    }
  });
});

describe("searching by handle", () => {
  it("turns a typed handle, whole or partial, into a prefix pattern", () => {
    expect(handleSearchPattern("MOD-142")).toBe("MOD-142%");
    expect(handleSearchPattern("mod-14")).toBe("MOD-14%");
    expect(handleSearchPattern("mod-")).toBe("MOD-%");
    expect(handleSearchPattern("  MOD-1 ")).toBe("MOD-1%");
  });

  it("ignores anything that isn't handle-shaped (so the filter stays safe)", () => {
    expect(handleSearchPattern("logo concepts")).toBeNull();
    expect(handleSearchPattern("MOD")).toBeNull();
    expect(handleSearchPattern("MOD-1a")).toBeNull();
    expect(handleSearchPattern("MOD-1,title.eq.x")).toBeNull();
    expect(handleSearchPattern("M-1")).toBeNull();
    expect(handleSearchPattern("MODUOX-1")).toBeNull();
  });

  it("finds a task by its old key after the key changed", () => {
    expect(handleWithCurrentKey("ML-14%", "PLAN", ["ML"])).toBe("PLAN-14%");
    expect(handleWithCurrentKey("ml-%", "PLAN", ["ML"])).toBe("PLAN-%");
  });

  it("leaves the current key and unknown keys alone", () => {
    expect(handleWithCurrentKey("PLAN-14%", "PLAN", ["ML"])).toBe("PLAN-14%");
    expect(handleWithCurrentKey("XY-14%", "PLAN", ["ML"])).toBe("XY-14%");
    expect(handleWithCurrentKey("ML-14%", null, ["ML"])).toBe("ML-14%");
  });
});
