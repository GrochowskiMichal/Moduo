// Proves specs/contacts.md AC3 — status is a renamable flat label, never a
// pipeline. The status module normalizes any label (defaults AND renamed/custom
// ones), exposes color + label for every status, and deliberately ships NO
// stage machine (no transition table, no canTransition / next-stage API).

import { describe, expect, it } from "@rstest/core";

import * as statusModule from "./status";
import {
  contactStatusMeta,
  DEFAULT_CONTACT_STATUS,
  DEFAULT_CONTACT_STATUSES,
  normalizeContactStatus,
} from "./status";

describe("normalizeContactStatus", () => {
  it("defaults empty / non-string input to Lead", () => {
    expect(normalizeContactStatus("")).toBe(DEFAULT_CONTACT_STATUS);
    expect(normalizeContactStatus("   ")).toBe(DEFAULT_CONTACT_STATUS);
    expect(normalizeContactStatus(null)).toBe(DEFAULT_CONTACT_STATUS);
    expect(normalizeContactStatus(undefined)).toBe(DEFAULT_CONTACT_STATUS);
    expect(normalizeContactStatus(42)).toBe(DEFAULT_CONTACT_STATUS);
  });

  it("normalizes a default label to a stable id", () => {
    expect(normalizeContactStatus("Active")).toBe("active");
    expect(normalizeContactStatus("  DORMANT  ")).toBe("dormant");
  });

  it("accepts renamed / custom labels (no closed set to reject against)", () => {
    expect(normalizeContactStatus("Prospect")).toBe("prospect");
    expect(normalizeContactStatus("VIP")).toBe("vip");
  });
});

describe("contactStatusMeta", () => {
  it("gives a default status both a color tone and a label", () => {
    const active = contactStatusMeta("active");
    expect(active.label).toBe("Active");
    expect(active.tone).toBe("success");
    // every default carries a tone AND a label — color is never the only signal.
    for (const s of DEFAULT_CONTACT_STATUSES) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.tone).toBeTruthy();
    }
  });

  it("passes a renamed/custom status through with a label + neutral tone", () => {
    const custom = contactStatusMeta("prospect");
    expect(custom).toEqual({ id: "prospect", label: "Prospect", tone: "muted" });
  });
});

describe("no stage machine (AC3 — never a pipeline)", () => {
  it("exposes no transition / automation API", () => {
    const mod = statusModule as Record<string, unknown>;
    expect(mod.canTransition).toBeUndefined();
    expect(mod.STATUS_TRANSITIONS).toBeUndefined();
    expect(mod.nextStatus).toBeUndefined();
    expect(mod.allowedTransitions).toBeUndefined();
  });

  it("any status may follow any other (no ordering gate)", () => {
    // archived → lead is a no-op normalization, not a rejected transition.
    expect(normalizeContactStatus("archived")).toBe("archived");
    expect(normalizeContactStatus("lead")).toBe("lead");
  });
});
