// SH-1 (tasks-v3 call 90b, AC10.1) — the capture type registry: ⌘ + a top-bar
// number picks the type registered for that module; Home and modules without a
// type answer to nothing; hiding a module renumbers both places alike.
import { describe, expect, it } from "@rstest/core";

import { visibleModuleNavItems } from "../components/app/app-chrome-constants";
import type { ModulePermissions } from "../features/workspaces/types";
import {
  CAPTURE_TYPES,
  type CaptureTypeDef,
  captureDigitFor,
  captureDigitKey,
  captureTypeForDigit,
} from "./capture-registry";

const ALL: ModulePermissions = {
  notes: "edit",
  tasks: "edit",
  calendar: "edit",
  contacts: "edit",
  chat: "edit",
};
const tabs = (perms: Partial<ModulePermissions> = {}) =>
  visibleModuleNavItems({ ...ALL, ...perms });
const typeAt = (digit: number, types: readonly CaptureTypeDef[] = CAPTURE_TYPES, perms = {}) =>
  captureTypeForDigit(digit, tabs(perms), types)?.type ?? null;
const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("the registered types", () => {
  it("opens as Task: Task is first and files to the Inbox", () => {
    expect(CAPTURE_TYPES[0]).toMatchObject({ type: "task", module: "tasks", destination: "Inbox" });
  });

  it("has one type per module, each labelled", () => {
    const modules = CAPTURE_TYPES.map((t) => t.module);
    expect(new Set(modules).size).toBe(modules.length);
    for (const type of CAPTURE_TYPES) {
      expect(type.label).toMatch(/^[A-Z][a-z]+$/);
      expect(type.Body).toBeTruthy();
    }
  });
});

describe("⌘1–7 follow the top bar's order", () => {
  it("maps 2 → note, 3 → task, 4 → event, 6 → contact", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((d) => typeAt(d))).toEqual([
      null, // Home
      "note",
      "task",
      "event",
      null, // Email: no type yet
      "contact",
      null, // Chat: no type yet
    ]);
  });

  it("with only Task registered, every number but Tasks' does nothing", () => {
    const onlyTask = [CAPTURE_TYPES[0]];
    expect([1, 2, 4, 5, 6, 7].map((d) => typeAt(d, onlyTask))).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(typeAt(3, onlyTask)).toBe("task");
  });

  it("renumbers like the top bar when a module is hidden", () => {
    // No Notes: Tasks moves to ⌘2, as its tab does.
    expect(typeAt(2, CAPTURE_TYPES, { notes: "none" })).toBe("task");
    expect(captureDigitFor(CAPTURE_TYPES[0], tabs({ notes: "none" }))).toBe(2);
    expect(captureDigitFor(CAPTURE_TYPES[1], tabs({ notes: "none" }))).toBeNull();
  });

  it("reads ⌘ + digit on macOS and Ctrl + digit elsewhere, nothing else", () => {
    expect(captureDigitKey(key({ metaKey: true, key: "2" }), true)).toBe(2);
    expect(captureDigitKey(key({ ctrlKey: true, key: "4" }), false)).toBe(4);
    expect(captureDigitKey(key({ ctrlKey: true, key: "2" }), true)).toBeNull();
    expect(captureDigitKey(key({ metaKey: true, shiftKey: true, key: "2" }), true)).toBeNull();
    expect(captureDigitKey(key({ metaKey: true, altKey: true, key: "2" }), true)).toBeNull();
    expect(captureDigitKey(key({ metaKey: true, key: "8" }), true)).toBeNull();
    expect(captureDigitKey(key({ key: "2" }), true)).toBeNull();
  });
});
