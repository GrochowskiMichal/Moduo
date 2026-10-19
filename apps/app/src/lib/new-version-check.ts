// Web only (REL-4, AC10): a tab left open across a release learns about it and
// offers "Moduo was updated · Reload". It never reloads by itself, so nothing
// typed is lost; old chunks stay deployed for 3 builds, so the old tab keeps
// working until the person reloads.
//
// The edge Worker answers /config.json with the live build id (`build`, the
// deploy's short commit). It's read when the tab comes back into view or
// focus, and every 10 minutes while visible. A build that differs from the one
// this page was built with (MODUO_BUILD) on two checks in a row prompts once,
// so a deploy caught mid-way doesn't. Offline, an error, or a `build` that's
// missing or empty (an older Worker, local dev) counts as no check at all.

import { toast } from "sonner";

export const NEW_VERSION_POLL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const TOAST_ID = "moduo-new-version";

/** The live build id, or null when it can't be read. */
export async function fetchLiveBuild(
  fetcher: typeof fetch = (...args) => fetch(...args),
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetcher("/config.json", { cache: "no-store", signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { build?: unknown } | null;
    const build = typeof body?.build === "string" ? body.build.trim() : "";
    return build || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** How many checks in a row have seen a different build. */
export function nextMismatchStreak(streak: number, bundled: string, live: string | null): number {
  if (live === null) return streak;
  return live === bundled ? 0 : streak + 1;
}

export type NewVersionCheckOptions = {
  /** The build this page was built with. */
  bundledBuild: string;
  /** Reads the live build (null = no answer). */
  readLiveBuild?: () => Promise<string | null>;
  /** Shows the prompt; its Reload is the only thing that reloads. */
  prompt?: () => void;
  doc?: Document;
  win?: Window;
  pollMs?: number;
};

/** Starts watching; returns a stop function. Stops by itself once it has prompted. */
export function startNewVersionCheck(opts: NewVersionCheckOptions): () => void {
  const {
    bundledBuild,
    readLiveBuild = () => fetchLiveBuild(),
    prompt = showReloadPrompt,
    doc = document,
    win = window,
    pollMs = NEW_VERSION_POLL_MS,
  } = opts;

  let streak = 0;
  let stopped = false;
  let inFlight = false;
  let interval: ReturnType<typeof setInterval> | null = null;

  const check = async () => {
    if (stopped || inFlight || doc.visibilityState !== "visible") return;
    inFlight = true;
    try {
      const live = await readLiveBuild();
      if (stopped) return;
      streak = nextMismatchStreak(streak, bundledBuild, live);
      if (streak >= 2) {
        stop();
        prompt();
      }
    } finally {
      inFlight = false;
    }
  };

  // The 10-minute clock runs only while the tab is visible.
  const syncInterval = () => {
    if (stopped) return;
    if (doc.visibilityState === "visible" && interval === null) {
      interval = setInterval(() => void check(), pollMs);
    } else if (doc.visibilityState !== "visible" && interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  };

  const onVisibility = () => {
    syncInterval();
    void check();
  };
  const onFocus = () => void check();

  function stop() {
    stopped = true;
    if (interval !== null) clearInterval(interval);
    interval = null;
    doc.removeEventListener("visibilitychange", onVisibility);
    win.removeEventListener("focus", onFocus);
  }

  doc.addEventListener("visibilitychange", onVisibility);
  win.addEventListener("focus", onFocus);
  syncInterval();
  return stop;
}

/** "Moduo was updated · Reload": stays until acted on or closed. */
export function showReloadPrompt(): void {
  toast("Moduo was updated", {
    id: TOAST_ID,
    duration: Number.POSITIVE_INFINITY,
    action: { label: "Reload", onClick: () => window.location.reload() },
  });
}
