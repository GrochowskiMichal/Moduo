import { describe, expect, it } from "vitest";

import { type Diagnostics, describeSyncStatus, formatDebugInfo } from "./advanced";

describe("describeSyncStatus (AC11)", () => {
  it("reports Synced / Offline when there are no pending note changes", () => {
    expect(describeSyncStatus({ online: true, pendingNotes: 0 })).toBe("Synced");
    expect(describeSyncStatus({ online: false, pendingNotes: 0 })).toBe("Offline");
  });

  it("leads with pending note changes, pluralized, and reflects connectivity", () => {
    expect(describeSyncStatus({ online: true, pendingNotes: 1 })).toBe("Syncing 1 change…");
    expect(describeSyncStatus({ online: true, pendingNotes: 3 })).toBe("Syncing 3 changes…");
    expect(describeSyncStatus({ online: false, pendingNotes: 1 })).toBe(
      "1 unsynced change (offline)",
    );
    expect(describeSyncStatus({ online: false, pendingNotes: 2 })).toBe(
      "2 unsynced changes (offline)",
    );
  });
});

describe("formatDebugInfo (AC11)", () => {
  const diag: Diagnostics = {
    appVersion: "1.0.0",
    appBuild: "abc1234",
    platform: "desktop",
    online: true,
    workspaceId: "ws-1",
    syncStatus: "Synced",
    lastSyncAt: "2026-07-11T09:30:00.000Z",
  };

  it("includes version, build, platform, workspace, sync and last-sync", () => {
    const text = formatDebugInfo(diag);
    expect(text).toContain("Moduo 1.0.0 (build abc1234)");
    expect(text).toContain("Platform: desktop");
    expect(text).toContain("Online: yes");
    expect(text).toContain("Workspace: ws-1");
    expect(text).toContain("Sync: Synced");
    expect(text).toContain("Last sync: 2026-07-11T09:30:00.000Z");
  });

  it("renders em-dash placeholders when workspace / last-sync are absent", () => {
    const text = formatDebugInfo({ ...diag, workspaceId: null, lastSyncAt: null, online: false });
    expect(text).toContain("Online: no");
    expect(text).toContain("Workspace: —");
    expect(text).toContain("Last sync: —");
  });
});
