/**
 * OpenChamber-style update dialog for Moduo desktop.
 *
 * States:
 *   idle / checking   → nothing shown
 *   available         → "Update available vX → vY  [Download Update]"
 *   downloading       → progress bar + cancel (not implemented; Tauri doesn't expose cancel)
 *   ready             → "Downloaded · [Restart to Update]"
 *   error             → inline error with retry
 *
 * Usage: render in Settings → About. `useUpdater(false)` in About so the check
 * only fires when the user explicitly presses the button (or on the auto-check
 * from the top-level mount that passes `checkOnMount=true`).
 */

import { ArrowDownToLine, CheckCircle2, RefreshCw, TriangleAlert } from "lucide-react";

import { APP_VERSION, IS_DESKTOP } from "../settings/about";
import type { UpdaterState } from "./use-updater";

interface Props {
  state: UpdaterState;
  onCheck: () => void;
  onDownload: () => void;
  onRestart: () => void;
}

export function UpdateBanner({ state, onCheck, onDownload, onRestart }: Props) {
  if (!IS_DESKTOP) return null;

  // ── available ────────────────────────────────────────────────────
  if (state.phase === "available") {
    const nextVersion = (state.update as { version?: string }).version ?? "new version";
    return (
      <div className="mt-4 flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
        <ArrowDownToLine className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            Update available — {APP_VERSION} → {nextVersion}
          </p>
          {(state.update as { body?: string | null }).body ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {(state.update as { body?: string | null }).body}
            </p>
          ) : null}
          <button
            onClick={onDownload}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ArrowDownToLine className="h-3 w-3" aria-hidden />
            Download Update
          </button>
        </div>
      </div>
    );
  }

  // ── downloading ──────────────────────────────────────────────────
  if (state.phase === "downloading") {
    const pct = state.progressPct;
    return (
      <div className="mt-4 flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            Downloading update{pct !== null ? ` (${pct}%)` : "…"}
          </p>
          {pct !== null && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-[var(--motion-base)]"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── ready (downloaded, awaiting restart) ─────────────────────────
  if (state.phase === "ready") {
    return (
      <div className="mt-4 flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Update downloaded</p>
          <button
            onClick={onRestart}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            Restart to Update
          </button>
        </div>
      </div>
    );
  }

  // ── error ────────────────────────────────────────────────────────
  if (state.phase === "error") {
    return (
      <div className="mt-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-destructive">{state.message}</p>
          <button
            onClick={onCheck}
            className="mt-1.5 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // ── up-to-date ───────────────────────────────────────────────────
  if (state.phase === "up-to-date") {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
        Moduo is up to date.
      </p>
    );
  }

  // idle / checking — render nothing (the button in AboutSection drives this)
  return null;
}
