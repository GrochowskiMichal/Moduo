import { describe, expect, it, rs } from "@rstest/core";

import { installChunkReload, isChunkLoadError, reloadOnceForChunkError } from "./chunk-reload";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

function chunkError(): Error {
  const err = new Error(
    "Loading chunk 7o failed.\n(missing: https://app.moduo.app/static/js/async/7o.dfb5.js)",
  );
  err.name = "ChunkLoadError";
  return err;
}

describe("chunk-load errors are recognised", () => {
  it("Rspack JS and CSS chunk failures and native import failures", () => {
    expect(isChunkLoadError(chunkError())).toBe(true);
    expect(isChunkLoadError(new Error("Loading chunk 12 failed."))).toBe(true);
    expect(isChunkLoadError(Object.assign(new Error("x"), { code: "CSS_CHUNK_LOAD_FAILED" }))).toBe(
      true,
    );
    expect(isChunkLoadError(new Error("Loading CSS chunk 9s failed."))).toBe(true);
    expect(
      isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: /x.js")),
    ).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
  });

  it("anything else is not", () => {
    expect(isChunkLoadError(new Error("Network request failed"))).toBe(false);
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError("Loading chunk 1 failed")).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe("reloads once (AC8)", () => {
  it("the first chunk error in a session reloads; later ones don't", () => {
    const storage = memoryStorage();
    const reload = rs.fn();
    expect(reloadOnceForChunkError(chunkError(), { storage, reload })).toBe(true);
    expect(reloadOnceForChunkError(chunkError(), { storage, reload })).toBe(false);
    expect(
      reloadOnceForChunkError(new Error("Loading chunk 99 failed."), { storage, reload }),
    ).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a different error never reloads and doesn't use up the one reload", () => {
    const storage = memoryStorage();
    const reload = rs.fn();
    expect(reloadOnceForChunkError(new Error("boom"), { storage, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(reloadOnceForChunkError(chunkError(), { storage, reload })).toBe(true);
  });

  it("without storage (blocked) it never reloads, so it can't loop", () => {
    const reload = rs.fn();
    expect(reloadOnceForChunkError(chunkError(), { storage: null, reload })).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    expect(reloadOnceForChunkError(chunkError(), { storage: throwing, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("an unhandled chunk rejection reloads once through the window listener", () => {
    const storage = memoryStorage();
    const reload = rs.fn();
    const uninstall = installChunkReload(window, { storage, reload });
    for (let i = 0; i < 3; i++) {
      const event = new Event("unhandledrejection") as PromiseRejectionEvent;
      Object.defineProperty(event, "reason", { value: chunkError() });
      window.dispatchEvent(event);
    }
    uninstall();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
