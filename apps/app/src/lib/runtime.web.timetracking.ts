/** The web runtime's timetracking (Supabase). */

import type { TimetrackingRuntime } from "./runtime.types";
import { desktopOnly } from "./runtime.web.shared";

export const webTimetracking: TimetrackingRuntime = {
  async list() {
    return { entries: [], categories: [], rules: [], projects: [] };
  },
  async upsertEntry() {
    throw new Error(desktopOnly().message);
  },
  async deleteEntry() {
    throw new Error(desktopOnly().message);
  },
  async upsertCategory() {
    throw new Error(desktopOnly().message);
  },
  async deleteCategory() {
    throw new Error(desktopOnly().message);
  },
  async upsertRule() {
    throw new Error(desktopOnly().message);
  },
  async deleteRule() {
    throw new Error(desktopOnly().message);
  },
  async upsertProject() {
    throw new Error(desktopOnly().message);
  },
  async deleteProject() {
    throw new Error(desktopOnly().message);
  },
  async upsertFocusSession() {
    throw new Error(desktopOnly().message);
  },
  async getActiveWindow() {
    return null;
  },
  async startTracking() {
    throw new Error(desktopOnly().message);
  },
  async stopTracking() {
    throw new Error(desktopOnly().message);
  },
  async getTrackingStatus() {
    return { isTracking: false };
  },
};
