// AC8 (specs/tanstack-spine.md): a duplicate binding inside one scope fails here,
// and so does a narrower scope hiding a wider one's key without `overrides`.
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

import {
  CHORD_TIMEOUT_MS,
  findChordPrefixClashes,
  findDuplicateBindings,
  findUndeclaredShadows,
  type HotkeyRegistry,
  HOTKEYS,
  keysFor,
} from "./registry";
import { HotkeyScope } from "./scope";
import { type AppHotkeyHandlers, useAppHotkeys, useChordPending } from "./use-app-hotkeys";

afterEach(() => {
  cleanup();
  rs.useRealTimers();
});

describe("the hotkey registry", () => {
  it("has no duplicate binding inside a scope", () => {
    expect(findDuplicateBindings(HOTKEYS)).toEqual([]);
  });

  it("declares every key a narrower scope takes from a wider one", () => {
    expect(findUndeclaredShadows(HOTKEYS)).toEqual([]);
  });

  it("catches two bindings on one key in one scope, including Mod spelled out", () => {
    const bad: HotkeyRegistry = {
      a: { scope: "global", label: "A", keys: ["Mod+K"] },
      b: { scope: "global", label: "B", keys: ["Meta+K"] },
      c: { scope: "tasks", label: "C", keys: ["Mod+K"], overrides: true },
    };
    expect(findDuplicateBindings(bad)).toEqual(['a and b both bind Mod+K in "global"']);
  });

  it("catches one binding listing a key twice", () => {
    const bad: HotkeyRegistry = { a: { scope: "home", label: "A", keys: ["J", "J"] } };
    expect(findDuplicateBindings(bad)).toEqual(["a lists J twice"]);
  });

  it("catches a platform-only duplicate", () => {
    const bad: HotkeyRegistry = {
      a: { scope: "global", label: "A", keys: [{ key: "F11", only: "other" }] },
      b: { scope: "global", label: "B", keys: ["F11"] },
    };
    expect(findDuplicateBindings(bad)).toHaveLength(1);
  });

  it("requires overrides when a route or surface reuses a wider key", () => {
    const bad: HotkeyRegistry = {
      help: { scope: "global", label: "Help", keys: ["Shift+/"] },
      list: { scope: "tasks", label: "Close", keys: ["Escape"] },
      page: { scope: "task-page", label: "Close", keys: ["Escape"] },
      legend: { scope: "email", label: "Legend", keys: ["Shift+/"] },
    };
    expect(findUndeclaredShadows(bad)).toEqual([
      "page shadows list on Escape without overrides: true",
      "legend shadows help on Shift+/ without overrides: true",
    ]);
  });

  it("never starts a chord with a key its scope binds on its own", () => {
    expect(findChordPrefixClashes(HOTKEYS)).toEqual([]);
    const bad: HotkeyRegistry = {
      go: { scope: "email", label: "Go", keys: [["G", "I"]] },
      g: { scope: "email", label: "G", keys: ["G"] },
    };
    expect(findChordPrefixClashes(bad)).toEqual(['go starts with G, which g binds in "email"']);
  });

  it("keeps the platform-only keys apart", () => {
    expect(keysFor(HOTKEYS.fullscreen, true)).toEqual(["Control+Meta+F"]);
    expect(keysFor(HOTKEYS.fullscreen, false)).toEqual(["F11"]);
  });
});

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key;
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, ...init }),
    );
  });
}

function bindEmail(handlers: AppHotkeyHandlers) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(HotkeyScope, { scope: "email", children });
  return renderHook(
    () => {
      useAppHotkeys(handlers);
      return useChordPending("email");
    },
    { wrapper },
  );
}

describe("registry chords (specs/mail-v3.md decision 15, AC21)", () => {
  it("chords resolve within 1 s and cancel on other keys", () => {
    rs.useFakeTimers();
    const inbox = rs.fn();
    const sent = rs.fn();
    const snooze = rs.fn();
    const next = rs.fn();
    const { result } = bindEmail({
      "email.go-inbox": inbox,
      "email.go-sent": sent,
      "email.snooze": snooze,
      "email.next": next,
    });

    // g then i, quickly: Inbox, and the hint reads "g" while it waits.
    press("g");
    expect(result.current).toBe("g");
    press("i");
    expect(inbox).toHaveBeenCalledTimes(1);
    expect(result.current).toBeNull();

    // The second step belongs to the chord: g then s is not Snooze.
    press("g");
    press("t");
    expect(sent).toHaveBeenCalledTimes(1);
    expect(snooze).not.toHaveBeenCalled();

    // Too slow: the chord drops after a second and the key acts on its own.
    press("g");
    act(() => {
      rs.advanceTimersByTime(CHORD_TIMEOUT_MS + 50);
    });
    expect(result.current).toBeNull();
    press("i");
    press("s");
    expect(inbox).toHaveBeenCalledTimes(1);
    expect(snooze).toHaveBeenCalledTimes(1);

    // Any non-chord key cancels it and acts normally.
    press("g");
    press("j");
    expect(next).toHaveBeenCalledTimes(1);
    expect(result.current).toBeNull();
    press("i");
    expect(inbox).toHaveBeenCalledTimes(1);
  });

  it("never arms a chord from a text field", () => {
    const inbox = rs.fn();
    bindEmail({ "email.go-inbox": inbox });
    const input = document.createElement("input");
    document.body.append(input);
    press("g", {}, input);
    press("i", {}, input);
    press("i");
    expect(inbox).not.toHaveBeenCalled();
    input.remove();
  });
});
