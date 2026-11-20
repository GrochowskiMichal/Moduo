import { describe, expect, it } from "@rstest/core";

import { MCP_KEYS_SECTION, mcpConnectorStatus } from "./integrations";
import { isSettingsSectionId } from "./settings-events";

describe("mcpConnectorStatus (AC9 — AI/MCP card status)", () => {
  it("is connected, counting apps and keys apart, when the workspace has live ones", () => {
    expect(mcpConnectorStatus({ apps: 0, keys: 1 })).toEqual({
      connected: true,
      label: "1 active key",
    });
    expect(mcpConnectorStatus({ apps: 2, keys: 3 })).toEqual({
      connected: true,
      label: "2 connected apps · 3 active keys",
    });
    expect(mcpConnectorStatus({ apps: 1, keys: 0 }).label).toBe("1 connected app");
  });

  it("is not connected when there are none", () => {
    expect(mcpConnectorStatus({ apps: 0, keys: 0 })).toEqual({
      connected: false,
      label: "Not connected",
    });
  });

  it("stays neutral (never falsely 'not connected') when the count is unreadable", () => {
    const status = mcpConnectorStatus(null);
    expect(status.connected).toBe(false);
    expect(status.label).not.toBe("Not connected");
    expect(status.label).toMatch(/manage connections/i);
  });
});

describe("AI/MCP card jump target (AC9)", () => {
  it("points at the dedicated API-keys section", () => {
    expect(MCP_KEYS_SECTION).toBe("apikeys");
    expect(isSettingsSectionId(MCP_KEYS_SECTION)).toBe(true);
  });
});
