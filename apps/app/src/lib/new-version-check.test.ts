// REL-4 · AC10: a web tab on an older build prompts "Moduo was updated ·
// Reload" when /config.json's build differs on two checks in a row (on focus,
// on coming back into view, or every 10 minutes while visible). It never
// reloads by itself and stays quiet offline or when `build` is missing.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";

import {
  fetchLiveBuild,
  NEW_VERSION_POLL_MS,
  nextMismatchStreak,
  startNewVersionCheck,
} from "./new-version-check";

function fakeDoc(state: DocumentVisibilityState = "visible") {
  const target = new EventTarget() as Document & {
    setVisibility(s: DocumentVisibilityState): void;
  };
  let visibility = state;
  Object.defineProperty(target, "visibilityState", { get: () => visibility });
  target.setVisibility = (s) => {
    visibility = s;
    target.dispatchEvent(new Event("visibilitychange"));
  };
  return target;
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

let stop: (() => void) | null = null;
beforeEach(() => {
  rs.useFakeTimers();
});
afterEach(() => {
  stop?.();
  stop = null;
  rs.useRealTimers();
});

describe("prompts on change, never reloads, quiet offline", () => {
  it("counts differing checks in a row; a missing answer counts as none", () => {
    expect(nextMismatchStreak(0, "aaa", "bbb")).toBe(1);
    expect(nextMismatchStreak(1, "aaa", "bbb")).toBe(2);
    expect(nextMismatchStreak(1, "aaa", "aaa")).toBe(0);
    expect(nextMismatchStreak(1, "aaa", null)).toBe(1);
  });

  it("prompts once after two differing checks on focus, and never reloads", async () => {
    const reload = rs.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      value: { ...original, reload },
      configurable: true,
    });
    const prompt = rs.fn();
    const readLiveBuild = rs.fn(async () => "new1234");
    const win = new EventTarget() as Window;
    stop = startNewVersionCheck({
      bundledBuild: "old1234",
      readLiveBuild,
      prompt,
      doc: fakeDoc(),
      win,
    });

    win.dispatchEvent(new Event("focus"));
    await flush();
    expect(prompt).not.toHaveBeenCalled();
    win.dispatchEvent(new Event("focus"));
    await flush();
    expect(prompt).toHaveBeenCalledOnce();

    // Stopped: no more reads, no second prompt.
    win.dispatchEvent(new Event("focus"));
    await rs.advanceTimersByTimeAsync(NEW_VERSION_POLL_MS * 3);
    expect(readLiveBuild).toHaveBeenCalledTimes(2);
    expect(prompt).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
    Object.defineProperty(window, "location", { value: original, configurable: true });
  });

  it("polls every 10 minutes only while visible, and on coming back into view", async () => {
    const prompt = rs.fn();
    const readLiveBuild = rs.fn(async () => "new1234");
    const doc = fakeDoc("hidden");
    stop = startNewVersionCheck({
      bundledBuild: "old1234",
      readLiveBuild,
      prompt,
      doc,
      win: new EventTarget() as Window,
    });

    await rs.advanceTimersByTimeAsync(NEW_VERSION_POLL_MS * 3);
    expect(readLiveBuild).not.toHaveBeenCalled();

    doc.setVisibility("visible");
    await flush();
    expect(readLiveBuild).toHaveBeenCalledTimes(1);
    await rs.advanceTimersByTimeAsync(NEW_VERSION_POLL_MS);
    expect(readLiveBuild).toHaveBeenCalledTimes(2);
    expect(prompt).toHaveBeenCalledOnce();
  });

  it("a deploy caught mid-way (new, then old again) doesn't prompt", async () => {
    const prompt = rs.fn();
    const answers = ["new1234", "old1234", "new1234"];
    const win = new EventTarget() as Window;
    stop = startNewVersionCheck({
      bundledBuild: "old1234",
      readLiveBuild: async () => answers.shift() ?? null,
      prompt,
      doc: fakeDoc(),
      win,
    });
    for (let i = 0; i < 3; i++) {
      win.dispatchEvent(new Event("focus"));
      await flush();
    }
    expect(prompt).not.toHaveBeenCalled();
  });

  it("stays quiet offline and when the build is missing", async () => {
    const prompt = rs.fn();
    const win = new EventTarget() as Window;
    stop = startNewVersionCheck({
      bundledBuild: "old1234",
      readLiveBuild: async () => null,
      prompt,
      doc: fakeDoc(),
      win,
    });
    for (let i = 0; i < 4; i++) {
      win.dispatchEvent(new Event("focus"));
      await flush();
    }
    expect(prompt).not.toHaveBeenCalled();
  });

  it("reads the live build, or null offline, on an error, or when it's missing", async () => {
    const json = (body: unknown, ok = true) =>
      (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
    expect(await fetchLiveBuild(json({ build: "abc1234" }))).toBe("abc1234");
    expect(await fetchLiveBuild(json({ build: "" }))).toBeNull();
    expect(await fetchLiveBuild(json({ supabaseUrl: "x" }))).toBeNull();
    expect(await fetchLiveBuild(json({ build: "abc1234" }, false))).toBeNull();
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await fetchLiveBuild(offline)).toBeNull();
    const notJson = (async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    })) as unknown as typeof fetch;
    expect(await fetchLiveBuild(notJson)).toBeNull();
  });
});
