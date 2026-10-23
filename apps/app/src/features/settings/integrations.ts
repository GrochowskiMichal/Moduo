// Pure helpers for Settings → Integrations (DF-19i). The AI/MCP connector card
// leads with connecting an app by URL (MCPO-4, AC11), reports what this
// workspace has connected (apps and keys) and jumps to the dedicated API-keys
// section. Kept out of the component so it's unit-testable (AC9). No React here.

import type { SettingsSectionId } from "./settings-events";

/** The AI/MCP connector card jumps here (in-modal) via dispatchOpenSettings. */
export const MCP_KEYS_SECTION: SettingsSectionId = "apikeys";

export type McpConnectorStatus = {
  /** True when the workspace has ≥1 live (unexpired, unrevoked) app or key. */
  connected: boolean;
  /** Subtitle for the connector row. */
  label: string;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Status line for the AI/MCP connector card, given the live connected apps
 * and keys. `null` means we couldn't read them (e.g. a non-admin, or a load
 * error) — we then avoid claiming a connection state either way.
 */
export function mcpConnectorStatus(
  counts: { apps: number; keys: number } | null,
): McpConnectorStatus {
  if (counts === null) {
    return { connected: false, label: "Manage connections to see what's connected" };
  }
  const parts = [
    counts.apps > 0 ? plural(counts.apps, "connected app") : null,
    counts.keys > 0 ? plural(counts.keys, "active key") : null,
  ].filter(Boolean);
  if (parts.length === 0) return { connected: false, label: "Not connected" };
  return { connected: true, label: parts.join(" · ") };
}
