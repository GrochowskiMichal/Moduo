import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { dispatchOpenSettings, isSettingsSectionId } from "../../features/settings/settings-events";

/**
 * The settings UI is a globally-mounted modal — see
 * `src/features/settings/settings-modal.tsx`. This route exists for
 * backwards compatibility with the legacy `/settings` and
 * `/settings?section=…` URLs: it fires the modal-open event, then
 * redirects to `/grid` so the modal sits over a real feature surface
 * instead of an empty page.
 */
export function SettingsPage() {
  const navigate = useNavigate();

  useEffect(() => {
    let section: string | null = null;
    if (typeof window !== "undefined") {
      section = new URLSearchParams(window.location.search).get("section");
    }
    // sticky: the modal remounts during boot, so the dispatch must survive
    // in the pending-open buffer until the final mount picks it up.
    dispatchOpenSettings(section && isSettingsSectionId(section) ? { section } : {}, {
      sticky: true,
    });
    void navigate({ to: "/", replace: true });
  }, [navigate]);

  return null;
}
