// DS-4 — the persisted view-prefs helper: one read/write per workspace+scope,
// and every kind of bad storage falls back to the defaults instead of throwing.
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook } from "@testing-library/react";

import {
  clearViewPrefs,
  mergeViewPrefs,
  readViewPrefs,
  useViewPrefs,
  viewPrefsKey,
  writeViewPrefs,
} from "./view-prefs";

type Display = { layout: string; completed: string; properties: string[]; showEnergy: boolean };
const DEFAULTS: Display = {
  layout: "list",
  completed: "hidden",
  properties: ["priority", "due"],
  showEnergy: false,
};

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  rs.restoreAllMocks();
});

describe("viewPrefsKey", () => {
  it("builds moduo:<module>:view:<parts>", () => {
    expect(viewPrefsKey("tasks", "ws1", "bucket:abc")).toBe("moduo:tasks:view:ws1:bucket:abc");
  });

  it("matches calendar's existing key, so it can adopt the helper without a migration", () => {
    expect(viewPrefsKey("calendar", "user1", "ws1")).toBe("moduo:calendar:view:user1:ws1");
  });

  it("is null while a part is missing (no workspace yet → nothing persists)", () => {
    expect(viewPrefsKey("tasks", null, "all")).toBeNull();
    expect(viewPrefsKey("tasks", "ws1", "")).toBeNull();
    expect(viewPrefsKey("tasks")).toBeNull();
  });
});

describe("read / write per scope", () => {
  it("round-trips a value under its key", () => {
    const key = viewPrefsKey("tasks", "ws1", "all");
    writeViewPrefs(key, { ...DEFAULTS, layout: "board" });
    expect(readViewPrefs(key, DEFAULTS)).toEqual({ ...DEFAULTS, layout: "board" });
  });

  it("keeps scopes and workspaces apart", () => {
    writeViewPrefs(viewPrefsKey("tasks", "ws1", "all"), { ...DEFAULTS, layout: "board" });
    writeViewPrefs(viewPrefsKey("tasks", "ws1", "today"), { ...DEFAULTS, layout: "timeline" });
    expect(readViewPrefs(viewPrefsKey("tasks", "ws1", "all"), DEFAULTS).layout).toBe("board");
    expect(readViewPrefs(viewPrefsKey("tasks", "ws1", "today"), DEFAULTS).layout).toBe("timeline");
    expect(readViewPrefs(viewPrefsKey("tasks", "ws2", "all"), DEFAULTS).layout).toBe("list");
  });

  it("returns the defaults for a key never written, and accepts a defaults factory", () => {
    expect(readViewPrefs("moduo:tasks:view:ws1:none", DEFAULTS)).toEqual(DEFAULTS);
    expect(readViewPrefs("moduo:tasks:view:ws1:none", () => DEFAULTS)).toEqual(DEFAULTS);
  });

  it("treats a null key as 'don't persist'", () => {
    writeViewPrefs(null, { layout: "board" });
    expect(window.localStorage.length).toBe(0);
    expect(readViewPrefs(null, DEFAULTS)).toEqual(DEFAULTS);
  });

  it("forgets a scope on clear", () => {
    const key = viewPrefsKey("tasks", "ws1", "all");
    writeViewPrefs(key, { ...DEFAULTS, layout: "board" });
    clearViewPrefs(key);
    expect(readViewPrefs(key, DEFAULTS)).toEqual(DEFAULTS);
  });
});

describe("corrupt storage falls back", () => {
  const key = "moduo:tasks:view:ws1:all";

  it("corrupt JSON → the defaults", () => {
    window.localStorage.setItem(key, "{not json");
    expect(readViewPrefs(key, DEFAULTS)).toEqual(DEFAULTS);
  });

  it("a value of the wrong shape → the defaults, field by field", () => {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        layout: 3,
        completed: "all",
        properties: "due",
        showEnergy: true,
        extra: 1,
      }),
    );
    expect(readViewPrefs(key, DEFAULTS)).toEqual({
      layout: "list", // number where a string belongs
      completed: "all",
      properties: ["priority", "due"], // string where an array belongs
      showEnergy: true,
    });
  });

  it("a stored non-object → the defaults", () => {
    window.localStorage.setItem(key, JSON.stringify(["board"]));
    expect(readViewPrefs(key, DEFAULTS)).toEqual(DEFAULTS);
    window.localStorage.setItem(key, "null");
    expect(readViewPrefs(key, DEFAULTS)).toEqual(DEFAULTS);
  });

  it("a custom sanitiser decides closed vocabularies, and one that throws → the defaults", () => {
    window.localStorage.setItem(key, JSON.stringify({ ...DEFAULTS, layout: "carousel" }));
    const closed = (raw: unknown, d: Display) => {
      const merged = mergeViewPrefs(raw, d);
      return ["list", "board", "timeline"].includes(merged.layout)
        ? merged
        : { ...merged, layout: d.layout };
    };
    expect(readViewPrefs(key, DEFAULTS, closed).layout).toBe("list");
    expect(
      readViewPrefs(key, DEFAULTS, () => {
        throw new Error("bad");
      }),
    ).toEqual(DEFAULTS);
  });

  it("storage that throws on read or write → the defaults, silently", () => {
    rs.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    rs.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeViewPrefs(key, DEFAULTS)).not.toThrow();
    expect(readViewPrefs(key, DEFAULTS)).toEqual(DEFAULTS);
  });
});

describe("mergeViewPrefs", () => {
  it("merges nested objects and keeps a stored value for a null default", () => {
    const defaults = { sort: { by: "manual", dir: "asc" }, lastId: null as string | null };
    expect(mergeViewPrefs({ sort: { by: "due" }, lastId: "t1" }, defaults)).toEqual({
      sort: { by: "due", dir: "asc" },
      lastId: "t1",
    });
    expect(mergeViewPrefs({ lastId: { nope: true } }, defaults).lastId).toBeNull();
  });
});

describe("useViewPrefs", () => {
  it("reads once per scope, writes on set, and re-reads when the scope changes", () => {
    writeViewPrefs(viewPrefsKey("tasks", "ws1", "today"), { ...DEFAULTS, layout: "timeline" });
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) => useViewPrefs(viewPrefsKey("tasks", "ws1", scope), DEFAULTS),
      { initialProps: { scope: "all" } },
    );
    expect(result.current[0].layout).toBe("list");

    act(() => result.current[1]((prev) => ({ ...prev, layout: "board" })));
    expect(result.current[0].layout).toBe("board");
    expect(readViewPrefs(viewPrefsKey("tasks", "ws1", "all"), DEFAULTS).layout).toBe("board");

    rerender({ scope: "today" });
    expect(result.current[0].layout).toBe("timeline");

    act(() => result.current[1]({ ...DEFAULTS, completed: "all" }));
    expect(readViewPrefs(viewPrefsKey("tasks", "ws1", "today"), DEFAULTS).completed).toBe("all");
    // The other scope kept its own value.
    expect(readViewPrefs(viewPrefsKey("tasks", "ws1", "all"), DEFAULTS).layout).toBe("board");
  });
});
