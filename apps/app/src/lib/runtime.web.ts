/**
 * Web (browser) implementation of ModuoRuntime: the composition root. Each
 * module's data access lives in its own runtime.web.<module>.ts, the client in
 * runtime.web.client.ts and the helpers several modules share in
 * runtime.web.shared.ts.
 *
 * Desktop-only features (email, time-tracking, calendar OAuth, P2P, local mnemonic)
 * return { error: { message: "Desktop only" } } — the UI hides them via capabilities.
 */

import { webChatRuntime } from "./runtime.chat.web";
import { webFocusRuntime } from "./runtime.focus.web";
import type { IntegrationStatusItem, ModuoRuntime, RuntimeCapabilities } from "./runtime.types";
import { webAttachments } from "./runtime.web.attachments";
import { webAuth } from "./runtime.web.auth";
import { webCalendar } from "./runtime.web.calendar";
import { webContacts } from "./runtime.web.contacts";
import { webEmail } from "./runtime.web.email";
import { webHabits } from "./runtime.web.habits";
import { webNotes } from "./runtime.web.notes";
import { webPreferences } from "./runtime.web.preferences";
import { desktopOnly } from "./runtime.web.shared";
import { webSpine } from "./runtime.web.spine";
import { webTasks } from "./runtime.web.tasks";
import { webTimetracking } from "./runtime.web.timetracking";
import { webWorkspace } from "./runtime.web.workspace";

// LocalStore backed by localStorage for web
const LS_PREFIX = "moduo:ls:";

// ── Capabilities ──────────────────────────────────────────────────────────────

export const webCapabilities: RuntimeCapabilities = {
  isDesktop: false,
  isWeb: true,
  hasEmail: false,
  hasTimeTracking: false,
  hasCalendarOAuth: false,
  hasLocalMnemonic: false,
  hasOfflineMode: false,
};

export const webRuntime: ModuoRuntime = {
  capabilities: webCapabilities,

  // Chat (specs/chat.md) and focus runs (TV-F6) keep their own files.
  chat: webChatRuntime,
  focus: webFocusRuntime,

  auth: webAuth,
  workspace: webWorkspace,
  ...webNotes,
  migration: {
    async importLegacy() {
      throw new Error(desktopOnly().message);
    },
  },
  localStore: {
    async get(namespace, key) {
      if (typeof window === "undefined") return null;
      try {
        const raw = window.localStorage.getItem(`${LS_PREFIX}${namespace}:${key}`);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    async set(namespace, key, value) {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(`${LS_PREFIX}${namespace}:${key}`, JSON.stringify(value));
    },
    async remove(namespace, key) {
      if (typeof window === "undefined") return;
      window.localStorage.removeItem(`${LS_PREFIX}${namespace}:${key}`);
    },
  },
  ...webPreferences,
  attachments: webAttachments,
  habits: webHabits,
  window: {
    async toggleFullscreen() {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return false;
      } else {
        await document.documentElement.requestFullscreen();
        return true;
      }
    },
    async openExternalUrl(url) {
      window.open(url, "_blank", "noopener,noreferrer");
    },
  },
  timetracking: webTimetracking,
  email: webEmail,
  integrations: {
    async getStatus(): Promise<IntegrationStatusItem[]> {
      return [];
    },
    async connectZoom(): Promise<IntegrationStatusItem> {
      throw new Error(desktopOnly().message);
    },
    async connectGoogleMeet(): Promise<IntegrationStatusItem> {
      throw new Error(desktopOnly().message);
    },
    async disconnect(): Promise<void> {
      throw new Error(desktopOnly().message);
    },
  },
  calendar: webCalendar,
  tasks: webTasks,
  spine: webSpine,
  contacts: webContacts,
};
