/**
 * Desktop-only: checks for a new release once, shortly after launch, and offers
 * a one-click "Update & restart" toast. Renders nothing; inert on web.
 */

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { IS_DESKTOP } from "../settings/about";
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
    const version = state.update.version;
    toast(`Moduo ${version} is available`, {
      id: "moduo-update",
      duration: Number.POSITIVE_INFINITY,
      action: { label: "Update & restart", onClick: () => void downloadAndInstall() },
    });
  }, [state, downloadAndInstall]);

  useEffect(() => {
    if (state.phase === "downloading") toast.loading("Downloading update…", { id: "moduo-update" });
    if (state.phase === "ready") {
      toast.dismiss("moduo-update");
      void relaunch();
    }
    if (state.phase === "error" && toastedRef.current) {
      toast.error("Update failed — try again from Settings → About", { id: "moduo-update" });
    }
  }, [state.phase, relaunch]);

  return null;
}
