/**
 * Tauri in-app updater hook.
 *
 * On mount (and optionally on demand), checks the endpoint configured in
 * tauri.conf.json `plugins.updater.endpoints`. When an update is available:
 *   - `update` holds the Update object (version, notes, pub_date)
 *   - call `downloadAndInstall()` to apply it (no restart yet)
 *   - call `relaunch()` to restart the app after install completes
 *
 * On web, all exported values are inert so the same component tree renders
 * without conditional branches at the call site.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { IS_DESKTOP } from "../settings/about";

// Tauri updater types — only imported on desktop; guarded by IS_DESKTOP below.
type TauriUpdate = {
  version: string;
  body: string | null;
  date: string | null;
  download: (cb?: (progress: DownloadProgress) => void) => Promise<void>;
  install: () => Promise<void>;
};

type DownloadProgress = {
  event: "Started" | "Progress" | "Finished";
  data: {
    contentLength?: number;
    chunkLength?: number;
  };
};

export type UpdaterState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "up-to-date" }
  | { phase: "available"; update: TauriUpdate }
  | { phase: "downloading"; progressPct: number | null }
  | { phase: "ready" } // downloaded, waiting for relaunch
  | { phase: "error"; message: string };

export function useUpdater(checkOnMount = true) {
  const [state, setState] = useState<UpdaterState>({ phase: "idle" });
  const checkedRef = useRef(false);

  const check = useCallback(async () => {
    if (!IS_DESKTOP) return;
    setState({ phase: "checking" });
    try {
      const { check: checkUpdate } = await import("@tauri-apps/plugin-updater");
      const update = await checkUpdate();
      if (update?.available) {
        setState({ phase: "available", update: update as unknown as TauriUpdate });
      } else {
        setState({ phase: "up-to-date" });
      }
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (state.phase !== "available") return;
    const { update } = state;
    setState({ phase: "downloading", progressPct: null });
    try {
      let downloaded = 0;
      let total: number | null = null;
      await update.download((progress) => {
        if (progress.event === "Started") {
          total = progress.data.contentLength ?? null;
        }
        if (progress.event === "Progress") {
          downloaded += progress.data.chunkLength ?? 0;
          const pct = total ? Math.round((downloaded / total) * 100) : null;
          setState({ phase: "downloading", progressPct: pct });
        }
        if (progress.event === "Finished") {
          setState({ phase: "downloading", progressPct: 100 });
        }
      });
      await update.install();
      setState({ phase: "ready" });
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [state]);

  const relaunch = useCallback(async () => {
    if (!IS_DESKTOP) return;
    try {
      const { relaunch: tauriRelaunch } = await import("@tauri-apps/plugin-process");
      await tauriRelaunch();
    } catch {
      // Fallback: the app typically relaunches automatically after install
    }
  }, []);

  useEffect(() => {
    if (!checkOnMount || checkedRef.current) return;
    checkedRef.current = true;
    void check();
  }, [check, checkOnMount]);

  return { state, check, downloadAndInstall, relaunch };
}
