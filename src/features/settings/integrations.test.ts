import { describe, expect, it } from "@rstest/core";

import { MCP_KEYS_SECTION, mcpConnectorStatus } from "./integrations";
import { isSettingsSectionId } from "./settings-events";

describe("mcpConnectorStatus (AC9 — AI/MCP card status)", () => {
  it("is connected with a key count when the workspace has active keys", () => {
    expect(mcpConnectorStatus(1)).toEqual({ connected: true, label: "1 active key" });
    expect(mcpConnectorStatus(3)).toEqual({ connected: true, label: "3 active keys" });
  });

  it("is not connected when there are zero active keys", () => {
    expect(mcpConnectorStatus(0)).toEqual({ connected: false, label: "Not connected" });
  });

  it("stays neutral (never falsely 'not connected') when the count is unreadable", () => {
    const status = mcpConnectorStatus(null);
    expect(status.connected).toBe(false);
    expect(status.label).not.toBe("Not connected");
    expect(status.label).toMatch(/manage keys/i);
  });
});

describe("AI/MCP card jump target (AC9)", () => {
  it("points at the dedicated API-keys section", () => {
    expect(MCP_KEYS_SECTION).toBe("apikeys");
    expect(isSettingsSectionId(MCP_KEYS_SECTION)).toBe(true);
  });
});
