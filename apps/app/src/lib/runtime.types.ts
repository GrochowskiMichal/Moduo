/**
 * Shared types and the ModuoRuntime interface.
 * Implementations live in runtime.tauri.ts (desktop) and runtime.web.ts (web).
 */

import type { ChatRuntime } from "../features/chat/model";
import type { FocusRunRuntime } from "../features/focus/run-model";
import type { AttachmentsRuntime } from "./runtime.types.attachments";
import type { AuthRuntime } from "./runtime.types.auth";
import type { CalendarRuntime } from "./runtime.types.calendar";
import type { ContactsRuntime } from "./runtime.types.contacts";
import type { EmailRuntime } from "./runtime.types.email";
import type { HabitsRuntime } from "./runtime.types.habits";
import type { NotesRuntime, NotesV2Runtime } from "./runtime.types.notes";
import type { DashboardRuntime, PreferencesRuntime } from "./runtime.types.preferences";
import type { SpineRuntime } from "./runtime.types.spine";
import type { TasksRuntime } from "./runtime.types.tasks";
import type { TimetrackingRuntime } from "./runtime.types.timetracking";
import type { WorkspaceRuntime } from "./runtime.types.workspace";

// Each module's port (and the types only it uses) lives in runtime.types.<module>.ts;
// this file holds the shared types and the ModuoRuntime that composes them.
export type * from "./runtime.types.attachments";
export type * from "./runtime.types.auth";
export type * from "./runtime.types.calendar";
export type * from "./runtime.types.contacts";
export type * from "./runtime.types.email";
export type * from "./runtime.types.habits";
export type * from "./runtime.types.notes";
export type * from "./runtime.types.preferences";
export type * from "./runtime.types.spine";
export type * from "./runtime.types.tasks";
export type * from "./runtime.types.timetracking";
export type * from "./runtime.types.workspace";

/** Per-platform capability flags. Components read this to hide desktop-only UI on web. */
export type RuntimeCapabilities = {
  isDesktop: boolean;
  isWeb: boolean;
  hasEmail: boolean;
  hasTimeTracking: boolean;
  hasCalendarOAuth: boolean;
  hasLocalMnemonic: boolean;
  hasOfflineMode: boolean;
};

export type IntegrationStatusItem = {
  provider: string;
  connected: boolean;
};

export type ModuoRuntime = {
  capabilities: RuntimeCapabilities;
  auth: AuthRuntime;
  workspace: WorkspaceRuntime;
  /**
   * LEGACY read-only notes surface. Two survivors: the one-time redb import
   * (desktop reads the local store through them) and the legacy dashboard
   * notes-preview widget. The write half died with the Wave-3 rebuild —
   * mutations go through `notesV2`.
   */
  notes: NotesRuntime;
  /**
   * Wave-3 Notes rebuild surface (specs/notes.md NO-1). Cloud-first on both
   * platforms (desktop delegates wholesale). Writes = notes_op_* intent RPCs;
   * reads degrade pre-migration (`degraded: true` on the bundle). The legacy
   * `notes` namespace above retires with NO-2/NO-3.
   */
  notesV2: NotesV2Runtime;
  migration: {
    importLegacy(payload: any): Promise<any>;
  };
  localStore: {
    get(namespace: string, key: string): Promise<any>;
    set(namespace: string, key: string, value: unknown): Promise<void>;
    remove(namespace: string, key: string): Promise<void>;
  };
  /**
   * Cross-device user settings (appearance + focus). Cloud-first: web hits
   * Supabase directly; desktop delegates to the web runtime. Both return null
   * when signed out. `set` upserts only the domains present in the patch.
   */
  preferences: PreferencesRuntime;
  /**
   * The Home dashboard layout for one user+workspace (DB-4). Preference-class:
   * a direct RLS upsert (no intent op, no activity, no registry) into the
   * `dashboard_layouts` table keyed by (user_id, workspace_id, 'home'). The whole
   * `{version, pages}` composition is one atomic JSONB blob; `updatedAt` is
   * client-set so the local cache and cloud reconcile last-write-wins. Returns
   * null when signed out or when no row exists yet (fresh user → curated default).
   */
  dashboard: DashboardRuntime;
  /**
   * Habits (DB-7) — preference-class, user-scoped CRUD (no intent ops). `list`
   * degrades to [] pre-migration (the table is deploy-gated); writes throw so the
   * widget's optimistic update can roll back.
   */
  habits: HabitsRuntime;
  /**
   * Attachments (AT-1 storage, AT-2 upload) — files on tasks. `list` returns
   * every row this person can see (trash included; the workspace export reads
   * it), and [] until the migration reaches the database. Uploads go begin →
   * `uploadObject` (original, then preview) → finalize; refusals throw
   * `AttachmentOpError` with AT-1's machine code and numbers.
   */
  attachments: AttachmentsRuntime;
  window: {
    toggleFullscreen(): Promise<boolean>;
    openExternalUrl(url: string): Promise<void>;
  };
  timetracking: TimetrackingRuntime;
  email: EmailRuntime;
  integrations: {
    getStatus(): Promise<IntegrationStatusItem[]>;
    connectZoom(): Promise<IntegrationStatusItem>;
    connectGoogleMeet(): Promise<IntegrationStatusItem>;
    disconnect(provider: string): Promise<void>;
  };
  calendar: CalendarRuntime;
  /**
   * Tasks module v1 — buckets / tasks / tags. Desktop reads/writes the
   * local-first redb store via Tauri commands; web talks to Supabase directly.
   * Both seed the reserved Inbox bucket lazily on first `list`.
   */
  tasks: TasksRuntime;
  /** Chat (specs/chat.md) — Supabase-direct on both surfaces; Duo/Team/Founder workspaces. */
  chat: ChatRuntime;
  /** Focus runs and claims (TV-F6) — Supabase-direct on both surfaces. */
  focus: FocusRunRuntime;
  /**
   * Connective-tissue spine — the link substrate (specs/connective-tissue.md
   * block CT-1). Any entity links/attaches/relates to any other through one
   * typed `entity_links` table FK'd into the central `entities` registry.
   * Cloud-first: web hits Supabase directly; desktop delegates to the web
   * runtime (same code path). All mutations go through `links_op_*` /
   * `entities_op_*` RPCs (permission guard + write + attributed activity row in
   * one transaction); reads are direct SELECTs over the indexed tables.
   */
  spine: SpineRuntime;
  /**
   * Contacts module (light CRM) — block CO-1. People + companies are hub
   * entities whose pages roll up from the spine. Cloud-first: web hits Supabase
   * directly; desktop delegates to the web runtime (same code path). All
   * invariant-bearing writes go through `contacts_op_*` / `companies_op_*` RPCs
   * (permission guard + write + `entities` registry upsert + attributed activity
   * in one transaction); reads are direct SELECTs over the indexed tables.
   */
  contacts: ContactsRuntime;
};
