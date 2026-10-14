import { describe, expect, it } from "@rstest/core";

import {
  clearPendingOpenSettings,
  dispatchCloseSettings,
  dispatchOpenSettings,
  isSettingsSectionId,
  PENDING_OPEN_TTL_MS,
  pendingOpenSettings,
  SETTINGS_CLOSE_EVENT,
  SETTINGS_SECTION_IDS,
} from "./settings-events";

describe("isSettingsSectionId", () => {
  it("accepts every section id, including billing (the trial CTA target)", () => {
    expect(SETTINGS_SECTION_IDS).toContain("billing");
    for (const id of SETTINGS_SECTION_IDS) {
      expect(isSettingsSectionId(id)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isSettingsSectionId("payments")).toBe(false);
    expect(isSettingsSectionId("")).toBe(false);
    expect(isSettingsSectionId(null)).toBe(false);
    expect(isSettingsSectionId(undefined)).toBe(false);
  });
});

describe("pending-open buffer (cold-load /settings deep link)", () => {
  it("only a sticky dispatch arms the buffer; ordinary opens never re-open later", () => {
    dispatchOpenSettings({ section: "billing" });
    expect(pendingOpenSettings()).toBeNull();
    dispatchOpenSettings({ section: "billing" }, { sticky: true });
    expect(pendingOpenSettings()).toEqual({ section: "billing" });
    // The boot flow mounts the modal several times; each read must succeed.
    expect(pendingOpenSettings()).toEqual({ section: "billing" });
  });

  it("latest intent wins: an ordinary open supersedes an armed deep link", () => {
    dispatchOpenSettings({ section: "billing" }, { sticky: true });
    dispatchOpenSettings({ section: "focus" });
    expect(pendingOpenSettings()).toBeNull();
  });

  it("a user close disarms the buffer", () => {
    dispatchOpenSettings({ section: "billing" }, { sticky: true });
    clearPendingOpenSettings();
    expect(pendingOpenSettings()).toBeNull();
  });

  it("expires after the TTL", () => {
    dispatchOpenSettings({ section: "billing" }, { sticky: true });
    expect(pendingOpenSettings(Date.now() + PENDING_OPEN_TTL_MS + 1)).toBeNull();
    // Expiry clears the buffer for later in-TTL reads too.
    expect(pendingOpenSettings()).toBeNull();
  });
});

describe("dispatchCloseSettings (Storage's task name leaves Settings)", () => {
  it("tells the modal to close and disarms a sticky open", () => {
    dispatchOpenSettings({ section: "storage" }, { sticky: true });
    let closed = 0;
    const onClose = () => {
      closed += 1;
    };
    window.addEventListener(SETTINGS_CLOSE_EVENT, onClose);
    dispatchCloseSettings();
    window.removeEventListener(SETTINGS_CLOSE_EVENT, onClose);
    expect(closed).toBe(1);
    expect(pendingOpenSettings()).toBeNull();
  });
});
