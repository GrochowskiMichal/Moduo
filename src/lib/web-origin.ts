// The origin to put in a link someone will open elsewhere (copy link, invites).
// In the desktop webview `window.location.origin` is `tauri://localhost`, which
// a browser can't open (gotchas/ui.md), so desktop builds need PUBLIC_WEB_ORIGIN.

export function webOrigin(): string {
  const configured = (import.meta.env.PUBLIC_WEB_ORIGIN as string | undefined)?.replace(/\/+$/, "");
  return configured || (typeof window !== "undefined" ? window.location.origin : "");
}

/** The deep link that opens a task selected in Tasks (DF-1's `?id=`). */
export function taskUrl(taskId: string): string {
  return `${webOrigin()}/tasks?id=${encodeURIComponent(taskId)}`;
}
