import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";

import { awayPromptCopy, describePhaseEnd, formatAwaySpan } from "./away-copy";
import type { FocusPhaseEnd } from "./engine-core";
import { alertPhaseEnd, phaseEndCopy } from "./phase-alert";

const h = rs.hoisted(() => ({
  toast: rs.fn(),
  notification: {
    isPermissionGranted: rs.fn(() => Promise.resolve(true)),
    requestPermission: rs.fn(() => Promise.resolve("granted")),
    sendNotification: rs.fn(),
  },
}));

rs.mock("sonner", () => ({ toast: h.toast }));
rs.mock("@tauri-apps/plugin-notification", () => h.notification);

const MIN = 60_000;
const workEnd: FocusPhaseEnd = { phase: "work", longBreak: false, lengthMs: 25 * MIN, at: 0 };
const breakEnd: FocusPhaseEnd = { phase: "break", longBreak: false, lengthMs: 5 * MIN, at: 0 };

type Win = typeof window & { __TAURI_INTERNALS__?: unknown };

function inBackground(hidden: boolean): void {
  rs.spyOn(document, "visibilityState", "get").mockReturnValue(hidden ? "hidden" : "visible");
  rs.spyOn(document, "hasFocus").mockReturnValue(!hidden);
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

beforeEach(() => {
  localStorage.clear();
  h.toast.mockClear();
  h.notification.sendNotification.mockClear();
});

afterEach(() => {
  rs.restoreAllMocks();
  delete (window as Win).__TAURI_INTERNALS__;
});

describe("phase-end copy", () => {
  it("says what ended and what comes next", () => {
    expect(
      phaseEndCopy(workEnd, { phase: "break", longBreak: false, lengthMs: 5 * MIN, running: true }),
    ).toEqual({
      title: "Focus block done",
      body: "Your 5-min break has started.",
    });
    expect(
      phaseEndCopy(workEnd, { phase: "break", longBreak: true, lengthMs: 15 * MIN, running: false })
        .body,
    ).toBe("Start your 15-min long break when you're ready.");
    expect(
      phaseEndCopy(breakEnd, { phase: "work", longBreak: false, lengthMs: 25 * MIN, running: true })
        .body,
    ).toBe("Your next 25-min focus block has started.");
    expect(
      phaseEndCopy(breakEnd, {
        phase: "work",
        longBreak: false,
        lengthMs: 25 * MIN,
        running: false,
      }),
    ).toEqual({
      title: "Break's over",
      body: "Resume when you're ready.",
    });
  });
});

describe("F1-5 — phase-end alert", () => {
  const next = { phase: "break" as const, longBreak: false, lengthMs: 5 * MIN, running: true };

  it("in the foreground there's no toast or notification", async () => {
    inBackground(false);
    alertPhaseEnd(workEnd, next);
    await settle();
    expect(h.toast).not.toHaveBeenCalled();
    expect(h.notification.sendNotification).not.toHaveBeenCalled();
  });

  it("on the web in the background it leaves one in-app toast", async () => {
    inBackground(true);
    alertPhaseEnd(workEnd, next);
    await settle();
    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(h.toast).toHaveBeenCalledWith("Focus block done", {
      description: "Your 5-min break has started.",
    });
    expect(h.notification.sendNotification).not.toHaveBeenCalled();
  });

  it("on desktop in the background it sends one OS notification and leaves the in-app note", async () => {
    (window as Win).__TAURI_INTERNALS__ = {};
    inBackground(true);
    alertPhaseEnd(workEnd, next);
    await settle();
    expect(h.notification.sendNotification).toHaveBeenCalledTimes(1);
    expect(h.notification.sendNotification).toHaveBeenCalledWith({
      title: "Focus block done",
      body: "Your 5-min break has started.",
    });
    expect(h.toast).toHaveBeenCalledTimes(1);
  });

  it("on desktop, a refused notification still leaves the in-app note", async () => {
    (window as Win).__TAURI_INTERNALS__ = {};
    inBackground(true);
    h.notification.isPermissionGranted.mockReturnValueOnce(Promise.resolve(false));
    h.notification.requestPermission.mockReturnValueOnce(Promise.resolve("denied"));
    alertPhaseEnd(workEnd, next);
    await settle();
    expect(h.notification.sendNotification).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledTimes(1);
  });
});

describe("away prompt copy", () => {
  it("formats the gap", () => {
    expect(formatAwaySpan(42 * 60)).toBe("42m");
    expect(formatAwaySpan(65 * 60)).toBe("1h 5m");
    expect(formatAwaySpan(95)).toBe("2m");
  });

  it("offers Keep with the held amount when less than the whole gap would be kept", () => {
    const copy = awayPromptCopy({
      awaySeconds: 50 * 60,
      heldSeconds: 15 * 60,
      endedPhases: [{ ...workEnd, at: new Date(2026, 9, 8, 14, 25).getTime() }],
    });
    expect(copy.headline).toBe("You were away 50m.");
    expect(copy.keepLabel).toBe("Keep 15m");
    expect(copy.hasHeld).toBe(true);
    expect(copy.detail).toMatch(/^Your 25-min focus ended at .*25/);
  });

  it("says Keep when the whole gap would be kept, and offers no Keep with nothing held", () => {
    expect(awayPromptCopy({ awaySeconds: 600, heldSeconds: 600, endedPhases: [] })).toMatchObject({
      keepLabel: "Keep",
      detail: null,
      hasHeld: true,
    });
    expect(
      awayPromptCopy({ awaySeconds: 600, heldSeconds: 0, endedPhases: [breakEnd] }).hasHeld,
    ).toBe(false);
    expect(describePhaseEnd({ ...breakEnd, longBreak: true, lengthMs: 15 * MIN })).toMatch(
      /^Your 15-min long break ended at /,
    );
  });
});
