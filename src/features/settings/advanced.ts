/**
 * Advanced settings — pure logic (DF-19g, AC11).
 *
 * The reset/export/diagnostics *effects* (IndexedDB, localStorage, fflate zip,
 * clipboard) live in the `advanced-section.tsx` component; the shaping and the
 * key/name lists that need proving live here so they can be unit-tested without
 * dragging a component `.tsx` (and its `@/lib/utils` import) into the vitest
 * graph — see docs/gotchas.md, the "unit test must not import a component .tsx"
 * bullet. Nothing in this file touches `window`/`localStorage`/`indexedDB`.
 */

// ── Data export ──────────────────────────────────────────────────────────────

/** The modules a workspace export gathers (Assumption 6). */
export type ExportModuleKey =
  | "tasks"
  | "notes"
  | "contacts"
  | "calendar"
  | "habits"
  | "attachments";

/** One module's read outcome — the impure gather wraps every runtime read in a
 * try/catch and reports failures here rather than throwing the whole export. */
export type ModuleReadResult =
  | { module: ExportModuleKey; ok: true; data: unknown }
  | { module: ExportModuleKey; ok: false; error: string };

/** One attachment as the export lists it (AT-1, AT1-8). */
export type AttachmentManifestInput = {
  id: string;
  entityType: string;
  entityId: string;
  uploaderId: string | null;
  fileName: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  status: string;
  deletedAt: string | null;
  createdAt: string;
};

/**
 * `attachments.json`: a manifest of the workspace's files, not the files
 * themselves (they can be hundreds of megabytes; each opens from its task).
 * Only finished uploads are listed; unfinished ones never held a file. A cut
 * read says so instead of looking complete.
 */
export function attachmentsManifest(
  records: AttachmentManifestInput[],
  truncation: { shown: number; total: number | null } | null,
) {
  const files = records
    .filter((r) => r.status === "ready")
    .map((r) => ({
      id: r.id,
      attached_to: { type: r.entityType, id: r.entityId },
      name: r.fileName,
      type: r.mime,
      size_bytes: r.sizeBytes,
      width: r.width,
      height: r.height,
      added_at: r.createdAt,
      uploaded_by: r.uploaderId,
      in_trash: r.deletedAt !== null,
    }));
  return {
    about:
      "Files attached in this workspace. The files themselves aren't in this export: open the task in Moduo to download one.",
    count: files.length,
    total_bytes: files.reduce((sum, f) => sum + f.size_bytes, 0),
    truncated: truncation ? { shown: truncation.shown, total: truncation.total } : null,
    files,
  };
}

/** Metadata stamped into the export's `_manifest.json`. */
export type ExportMeta = {
  workspaceId: string;
  workspaceName?: string | null;
  /** ISO timestamp — supplied by the caller (pure code stamps no clock). */
  exportedAt: string;
  appVersion: string;
  appBuild: string;
  platform: "web" | "desktop";
};

export type ExportBundle = {
  /** zip-relative filename → JSON string. The component encodes these to bytes. */
  entries: Record<string, string>;
  /** module → error message for any read that failed (mirrors `_errors.json`). */
  errors: Record<string, string>;
};

function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Shape a workspace export from the per-module read results. Every module is
 * accounted for: a successful read becomes `<module>.json`; a failed read lands
 * in the `_errors.json` manifest (never silently dropped, AC11 / edge case).
 * `_manifest.json` always lists all modules with an ok/error status.
 */
export function buildExportBundle(results: ModuleReadResult[], meta: ExportMeta): ExportBundle {
  const entries: Record<string, string> = {};
  const errors: Record<string, string> = {};
  const modules: Record<string, "ok" | "error"> = {};

  for (const result of results) {
    if (result.ok) {
      modules[result.module] = "ok";
      entries[`${result.module}.json`] = stableJson(result.data);
    } else {
      modules[result.module] = "error";
      errors[result.module] = result.error;
    }
  }

  entries["_manifest.json"] = stableJson({
    app: "Moduo",
    ...meta,
    modules,
  });

  // Only write the errors file when something actually failed — but never drop
  // a failure silently: if `errors` is non-empty it is always surfaced here.
  if (Object.keys(errors).length > 0) {
    entries["_errors.json"] = stableJson(errors);
  }

  return { entries, errors };
}

/** Safe filename stem for a workspace name (no separators / control chars). */
function safeName(name: string | null | undefined): string {
  const clean = (name || "workspace")
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return clean || "workspace";
}

/** `moduo-<workspace>-<YYYY-MM-DD>.zip`, derived from the export meta. Pure. */
export function exportZipName(meta: ExportMeta): string {
  const date = (meta.exportedAt || "").slice(0, 10) || "export";
  return `moduo-${safeName(meta.workspaceName)}-${date}.zip`;
}

// ── Reset local cache ────────────────────────────────────────────────────────

/** Every on-device Moduo cache key shares this localStorage prefix. */
export const MODUO_CACHE_PREFIX = "moduo.";

/**
 * The localStorage keys a cache reset clears: Moduo's own `moduo.*` caches
 * only. The Supabase auth session (`sb-*-auth-token`) and any non-Moduo keys
 * are deliberately left untouched, so the reset never signs the user out and
 * cloud data re-syncs on the reload that follows.
 */
export function moduoCacheKeysToClear(allKeys: string[]): string[] {
  return allKeys.filter((key) => key.startsWith(MODUO_CACHE_PREFIX));
}

/**
 * Whether an IndexedDB database name is one of Moduo's own on-device stores:
 * the notes meta/outbox DB (`moduo-notes-v2`), every per-note y-indexeddb doc DB
 * (`moduo:notes-v2:doc:<ws>:<note>`) and the upload queue (`moduo-uploads`, AT-2).
 * The reset deletes exactly these; other apps' databases are left alone.
 */
export function isModuoIdbName(name: string | null | undefined): boolean {
  if (!name) return false;
  return (
    name === "moduo-notes-v2" || name.startsWith("moduo:notes-v2:") || name === "moduo-uploads"
  );
}

/**
 * Why "Reset local cache" is blocked: unsynced note changes and files still
 * waiting to upload (AT-2) live only on this device, so a reset would lose them.
 */
export function resetBlockedMessage(input: {
  pendingNotes: number;
  pendingUploads: number;
  online: boolean;
}): string {
  const { pendingNotes, pendingUploads, online } = input;
  const parts: string[] = [];
  if (pendingNotes > 0) {
    parts.push(
      `${pendingNotes} note ${pendingNotes === 1 ? "change hasn't" : "changes haven't"} synced to the cloud yet`,
    );
  }
  if (pendingUploads > 0) {
    parts.push(
      `${pendingUploads} ${pendingUploads === 1 ? "file hasn't" : "files haven't"} finished uploading`,
    );
  }
  const total = pendingNotes + pendingUploads;
  const lead = `${parts.join(", and ")}. Resetting now would lose ${total === 1 ? "it" : "them"}.`;
  return online
    ? `${lead} Wait for them to finish (notes sync in Notes; files upload on their task), then re-check.`
    : `${lead} Reconnect to the internet so they can finish, then re-check.`;
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

export type Diagnostics = {
  appVersion: string;
  appBuild: string;
  platform: "web" | "desktop";
  online: boolean;
  workspaceId: string | null;
  /** Human sync summary from describeSyncStatus. */
  syncStatus: string;
  /** ISO of the most recent prefs sync, or null when never synced. */
  lastSyncAt: string | null;
};

/**
 * A short human sync summary for the diagnostics readout. Pending (unpushed)
 * note edits are the only local-write lane a user can lose, so they lead the
 * message; otherwise it reflects connectivity.
 */
export function describeSyncStatus(input: { online: boolean; pendingNotes: number }): string {
  const { online, pendingNotes } = input;
  if (pendingNotes > 0) {
    const noun = pendingNotes === 1 ? "change" : "changes";
    return online
      ? `Syncing ${pendingNotes} ${noun}…`
      : `${pendingNotes} unsynced ${noun} (offline)`;
  }
  return online ? "Synced" : "Offline";
}

/** The plain-text blob behind "Copy debug info" (version + platform + ids). */
export function formatDebugInfo(d: Diagnostics): string {
  return [
    `Moduo ${d.appVersion} (build ${d.appBuild})`,
    `Platform: ${d.platform}`,
    `Online: ${d.online ? "yes" : "no"}`,
    `Workspace: ${d.workspaceId ?? "—"}`,
    `Sync: ${d.syncStatus}`,
    `Last sync: ${d.lastSyncAt ?? "—"}`,
  ].join("\n");
}
