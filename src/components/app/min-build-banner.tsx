import { ArrowDownToLine } from "lucide-react";
import { useEffect } from "react";
import { APP_VERSION, IS_DESKTOP } from "../../features/settings/about";
import { dispatchOpenSettings } from "../../features/settings/settings-events";
import { applyMinBuild, useMinBuild } from "../../lib/min-build";
import { useAuth } from "../../providers/auth-provider";

/**
 * "Update Moduo" (TV-D8, REPLAN §6.7). At boot the app reads the oldest
 * version that may still save (`app_settings.min_build`). Below it the app
 * keeps working read-only (the Supabase client refuses writes, see
 * lib/min-build.ts) and this strip says why. It can't be dismissed: every save
 * would fail without it.
 */
export function MinBuildBanner() {
  const { runtime } = useAuth();
  const { readOnly, minimum } = useMinBuild();

  useEffect(() => {
    if (!runtime) return;
    let cancelled = false;
    void runtime.preferences
      .getMinBuild()
      .then((min) => {
        if (!cancelled) applyMinBuild(min, APP_VERSION);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  if (!readOnly) return null;

  return (
    <div
      role="alert"
      className="flex flex-row items-center gap-3 border-b border-warning/30 bg-warning/15 px-5 py-2 text-xs text-warning"
    >
      <ArrowDownToLine className="size-3.5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-medium">Update Moduo.</span> This version ({APP_VERSION}) can't save
        changes any more{minimum ? ` (${minimum} or newer can)` : ""}. You can still read
        everything.{" "}
        <button
          type="button"
          onClick={() =>
            IS_DESKTOP ? dispatchOpenSettings({ section: "about" }) : window.location.reload()
          }
          className="rounded-sm font-medium underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {IS_DESKTOP ? "Check for updates →" : "Reload →"}
        </button>
      </p>
    </div>
  );
}
