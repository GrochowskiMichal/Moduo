// Pure helpers for Settings → Integrations (DF-19i). The AI/MCP connector card
// reports whether this workspace has an active API key and jumps to the
// dedicated API-keys section. Kept out of the component so it's unit-testable
// (AC9). No React here.

import type { SettingsSectionId } from "./settings-events";

/** The AI/MCP connector card jumps here (in-modal) via dispatchOpenSettings. */
export const MCP_KEYS_SECTION: SettingsSectionId = "apikeys";

export type McpConnectorStatus = {
  /** True when the workspace has ≥1 active (non-revoked) API key. */
  connected: boolean;
  /** Subtitle for the connector row. */
  label: string;
};

/**
 * Status line for the AI/MCP connector card, given the count of active API
 * keys. `null` means we couldn't read the keys (e.g. a non-admin, or a load
 * error) — we then avoid claiming a connection state either way.
 */
export function mcpConnectorStatus(activeKeyCount: number | null): McpConnectorStatus {
  if (activeKeyCount === null) {
    return { connected: false, label: "Manage keys to connect your AI assistants" };
  }
  if (activeKeyCount <= 0) {
    return { connected: false, label: "Not connected" };
  }
  return {
    connected: true,
    label: `${activeKeyCount} active key${activeKeyCount === 1 ? "" : "s"}`,
  };
}
