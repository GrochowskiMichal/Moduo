import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Download, Loader2, RotateCcw } from "lucide-react";
import { strToU8 } from "fflate";
import { toast } from "sonner";

import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import type { ModuoRuntime } from "../../../lib/runtime";
import { allTimeCalendarWindow } from "../../calendar/window";
import { downloadZip } from "../../notes/export";
import { closeNotesDb, countPendingOutbox } from "../../notes/sync/idb";
import { getSyncMeta, type SyncDomain } from "../../../lib/prefs-sync";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";

import {
  buildExportBundle,
  describeSyncStatus,
  exportZipName,
  formatDebugInfo,
  isModuoIdbName,
  moduoCacheKeysToClear,
  type Diagnostics,
  type ExportMeta,
  type ModuleReadResult,
} from "../advanced";
import { SettingsSectionShell } from "./section-shell";

const SYNC_DOMAINS: SyncDomain[] = ["appearance", "focus", "calendar", "email"];

function isDesktop(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  );
}

const APP_VERSION: string = (import.meta.env.MODUO_VERSION as string | undefined) ?? "0.0.0";
const APP_BUILD: string = (import.meta.env.MODUO_BUILD as string | undefined) ?? "dev";

/** Most recent *confirmed* cloud-sync timestamp across all domains (the "last
 * sync"). `updatedAt` is stamped on every local write — including ones whose
 * push failed (`dirty: true`) — so only clean (pushed) meta counts here; a
 * pending offline edit must not read as "synced just now". */
function latestSyncAt(): string | null {
  let latest: string | null = null;
  for (const domain of SYNC_DOMAINS) {
    const meta = getSyncMeta(domain);
    if (meta.dirty) continue;
    const at = meta.updatedAt;
    if (at && (!latest || at > latest)) latest = at;
  }
  return latest;
}

/** Gather every module's data best-effort — a failed read becomes a
 * ModuleReadResult error (surfaced in `_errors.json`), never a thrown export. */
async function gatherExport(
  runtime: ModuoRuntime,
  workspaceId: string,
): Promise<ModuleReadResult[]> {
  const read = async (
    module: ModuleReadResult["module"],
    fn: () => Promise<unknown>,
  ): Promise<ModuleReadResult> => {
    try {
      return { module, ok: true, data: await fn() };
    } catch (err) {
      return { module, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  return Promise.all([
    read("tasks", () => runtime.tasks.list(workspaceId)),
    read("notes", async () => {
      const bundle = await runtime.notesV2.listMeta(workspaceId);
      const ids = bundle.notes.map((n) => n.id);
      const docs = ids.length
        ? await runtime.notesV2.fetchExportDocs({ workspaceId, ids })
        : [];
      const bodyById = new Map(docs.map((d) => [d.id, d.bodyMd]));
      return {
        degraded: bundle.degraded,
        notes: bundle.notes.map((n) => ({ ...n, bodyMd: bodyById.get(n.id) ?? "" })),
      };
    }),
    read("contacts", () => runtime.contacts.list(workspaceId)),
    // An export labelled "everything" must not inherit the calendar page's
    // date window (SCALE-1) — read all of history explicitly.
    read("calendar", () => runtime.calendar.listModule(workspaceId, allTimeCalendarWindow())),
    read("habits", () => runtime.habits.list(workspaceId)),
  ]);
}

export function AdvancedSection() {
  const { runtime } = useAuth();
  const { selectedWorkspace } = useWorkspace();
  const workspaceId = selectedWorkspace?.id ?? null;
  const platform: "web" | "desktop" = isDesktop() ? "desktop" : "web";

  const [exporting, setExporting] = useState(false);

  // Reset-cache confirm + unsynced-notes guard.
  const [resetOpen, setResetOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [pendingNotes, setPendingNotes] = useState(0);

  // Diagnostics.
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [diagPending, setDiagPending] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [copiedDebug, setCopiedDebug] = useState(false);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void countPendingOutbox().then((n) => {
      if (active) setDiagPending(n);
    });
    setLastSyncAt(latestSyncAt());
    return () => {
      active = false;
    };
  }, []);

  const diagnostics: Diagnostics = {
    appVersion: APP_VERSION,
    appBuild: APP_BUILD,
    platform,
    online,
    workspaceId,
    syncStatus: describeSyncStatus({ online, pendingNotes: diagPending }),
    lastSyncAt,
  };

  const handleExport = useCallback(async () => {
    if (!runtime || !workspaceId || exporting) return;
    setExporting(true);
    try {
      const results = await gatherExport(runtime, workspaceId);
      const meta: ExportMeta = {
        workspaceId,
        workspaceName: selectedWorkspace?.name ?? null,
        exportedAt: new Date().toISOString(),
        appVersion: APP_VERSION,
        appBuild: APP_BUILD,
        platform,
      };
      const bundle = buildExportBundle(results, meta);
      const entries: Record<string, Uint8Array> = {};
      for (const [name, json] of Object.entries(bundle.entries)) {
        entries[name] = strToU8(json);
      }
      downloadZip(exportZipName(meta), entries);
      const failed = Object.keys(bundle.errors);
      if (failed.length > 0) {
        toast(`Exported — ${failed.length} module(s) skipped (see _errors.json).`);
      } else {
        toast("Workspace data exported.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't export your data.");
    } finally {
      setExporting(false);
    }
  }, [runtime, workspaceId, exporting, selectedWorkspace, platform]);

  const openReset = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    try {
      const n = await countPendingOutbox();
      setPendingNotes(n);
      setDiagPending(n);
      setResetOpen(true);
    } finally {
      setChecking(false);
    }
  }, [checking]);

  const recheckPending = useCallback(async () => {
    setChecking(true);
    try {
      const n = await countPendingOutbox();
      setPendingNotes(n);
      setDiagPending(n);
    } finally {
      setChecking(false);
    }
  }, []);

  const performReset = useCallback(async () => {
    if (resetting) return;
    setResetting(true);
    try {
      // Clear only Moduo's own on-device caches — the auth session and other
      // apps' keys are left intact; cloud data re-syncs on the reload below.
      for (const key of moduoCacheKeysToClear(Object.keys(localStorage))) {
        localStorage.removeItem(key);
      }
      await closeNotesDb();
      // The meta/outbox DB is deleted by name always; per-note doc DBs are
      // enumerated via databases() (unsupported on Firefox/older Safari — there
      // only the named DB is dropped, which is harmless since the outbox is
      // already empty and the cloud is the source of truth).
      const list = (await indexedDB.databases?.()) ?? [];
      const names = new Set<string>(["moduo-notes-v2"]);
      for (const db of list) if (isModuoIdbName(db.name)) names.add(db.name as string);
      await Promise.all(
        [...names].map(
          (name) =>
            new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(name);
              req.onsuccess = req.onerror = req.onblocked = () => resolve();
            }),
        ),
      );
      window.location.reload();
    } catch (err) {
      setResetting(false);
      toast.error(err instanceof Error ? err.message : "Couldn't reset the local cache.");
    }
  }, [resetting]);

  const copyDebug = useCallback(async () => {
    await navigator.clipboard.writeText(formatDebugInfo(diagnostics)).catch(() => {});
    setCopiedDebug(true);
    setTimeout(() => setCopiedDebug(false), 2000);
  }, [diagnostics]);

  const blocked = pendingNotes > 0;

  return (
    <SettingsSectionShell
      title="Advanced"
      description="Export your data, reset on-device caches, and read app diagnostics."
    >
      {/* Data export */}
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-base text-foreground">Export workspace data</h3>
          <p className="text-sm text-muted-foreground">
            Download this workspace&apos;s tasks, notes, contacts, calendar events, and habits as a
            single <code className="font-mono text-xs">.zip</code> of JSON files. A read-only copy of
            your own data — nothing is changed or removed.
          </p>
        </div>
        <div>
          <Button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting || !workspaceId}
          >
            {exporting ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Download className="size-3.5" aria-hidden />
            )}
            {exporting ? "Preparing…" : "Export data"}
          </Button>
        </div>
      </section>

      {/* Reset local cache */}
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-base text-foreground">Reset local cache</h3>
          <p className="text-sm text-muted-foreground">
            Clears cached data stored on this device and reloads the app. Your cloud data is safe and
            re-syncs automatically; you stay signed in. Use this if something looks out of date.
          </p>
        </div>
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void openReset()}
            disabled={checking}
          >
            {checking ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <RotateCcw className="size-3.5" aria-hidden />
            )}
            Reset local cache…
          </Button>
        </div>
      </section>

      {/* Diagnostics */}
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-base text-foreground">Diagnostics</h3>
          <p className="text-sm text-muted-foreground">Details useful when reporting an issue.</p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Version</dt>
          <dd className="font-mono text-xs text-foreground">
            {diagnostics.appVersion} · {diagnostics.appBuild}
          </dd>
          <dt className="text-muted-foreground">Platform</dt>
          <dd className="text-foreground">{platform === "desktop" ? "Desktop" : "Web"}</dd>
          <dt className="text-muted-foreground">Connection</dt>
          <dd className="text-foreground">{online ? "Online" : "Offline"}</dd>
          <dt className="text-muted-foreground">Sync</dt>
          <dd className="text-foreground">{diagnostics.syncStatus}</dd>
          <dt className="text-muted-foreground">Last sync</dt>
          <dd className="text-foreground">
            {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : "—"}
          </dd>
          <dt className="text-muted-foreground">Workspace</dt>
          <dd className="truncate font-mono text-xs text-foreground">{workspaceId ?? "—"}</dd>
        </dl>
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => void copyDebug()}>
            {copiedDebug ? (
              <Check className="size-3.5 text-success" aria-hidden />
            ) : (
              <Copy className="size-3.5" aria-hidden />
            )}
            {copiedDebug ? "Copied" : "Copy debug info"}
          </Button>
        </div>
      </section>

      {/* Reset confirm / unsynced-notes guard (DF-5 confirm-first grammar) */}
      <Dialog open={resetOpen} onOpenChange={(open) => !open && !resetting && setResetOpen(false)}>
        <DialogContent className="max-w-sm">
          {blocked ? (
            <>
              <DialogHeader>
                <DialogTitle>You have unsynced note changes</DialogTitle>
                <DialogDescription>
                  {pendingNotes} note{" "}
                  {pendingNotes === 1 ? "change hasn't" : "changes haven't"} synced to the cloud yet.
                  Resetting now would lose {pendingNotes === 1 ? "it" : "them"}.
                  {online
                    ? " Open Notes and wait for the sync indicator to finish, then re-check."
                    : " Reconnect to the internet so they can sync, then re-check."}
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                <span>Reset is blocked until every note change is synced.</span>
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setResetOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void recheckPending()} disabled={checking}>
                  {checking ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                  Re-check
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Reset local cache?</DialogTitle>
                <DialogDescription>
                  This clears cached data on this device and reloads Moduo. Your cloud data is safe
                  and re-syncs automatically, and you&apos;ll stay signed in. Device-only display
                  settings (density and tab style) reset to their defaults. This can&apos;t be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setResetOpen(false)}
                  disabled={resetting}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void performReset()}
                  disabled={resetting}
                >
                  {resetting ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                  {resetting ? "Resetting…" : "Reset & reload"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </SettingsSectionShell>
  );
}
