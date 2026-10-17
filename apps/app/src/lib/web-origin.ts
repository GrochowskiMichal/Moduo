// The origin to put in a link someone will open elsewhere (copy link, invites).
// In the desktop webview `window.location.origin` is `tauri://localhost`, which
// a browser can't open (gotchas/ui.md), so desktop builds need PUBLIC_WEB_ORIGIN.

import { publicConfig } from "./public-config";

export function webOrigin(): string {
  const configured = publicConfig().webOrigin.replace(/\/+$/, "");
  return configured || (typeof window !== "undefined" ? window.location.origin : "");
}

/**
 * The deep link that opens a task selected in Tasks (DF-1's `?id=`). Pass
 * `taskLinkId(taskKey, task)` so it reads `/tasks?id=MOD-142` (MOD-28); a
 * task's id still works for one without a handle yet.
 */
export function taskUrl(target: string): string {
  return `${webOrigin()}/tasks?id=${encodeURIComponent(target)}`;
}
