/**
 * Desktop-only: checks for a new release once, shortly after launch, and offers
 * a one-click "Update & restart" toast with the release's highlights. Renders nothing; inert on web.
 */

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { IS_DESKTOP } from "../settings/about";
import { showUpdateToast, UPDATE_TOAST_ID } from "./update-toast";
import { useUpdater } from "./use-updater";

const LAUNCH_CHECK_DELAY_MS = 8_000;

export function UpdateOnLaunch() {
  const { state, check, downloadAndInstall, relaunch } = useUpdater(false);
  const toastedRef = useRef(false);

  useEffect(() => {
    if (!IS_DESKTOP) return;
    const timer = window.setTimeout(() => void check(), LAUNCH_CHECK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [check]);

  useEffect(() => {
    if (state.phase !== "available" || toastedRef.current) return;
    toastedRef.current = true;
    showUpdateToast(state.update, () => void downloadAndInstall());
  }, [state, downloadAndInstall]);

  useEffect(() => {
    if (state.phase === "downloading")
      toast.loading("Downloading update…", { id: UPDATE_TOAST_ID });
    if (state.phase === "ready") {
      toast.dismiss(UPDATE_TOAST_ID);
      void relaunch();
    }
    if (state.phase === "error" && toastedRef.current) {
      toast.error("Update failed — try again from Settings → About", { id: UPDATE_TOAST_ID });
    }
  }, [state.phase, relaunch]);

  return null;
}
