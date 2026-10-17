// Telling "the network is gone" from "the server said no" (TV-D11a). A refusal
// rolls one field back; a lost connection keeps a capture or a check-off on
// the device and sends it later. supabase-js turns a failed fetch into an
// error object (it never throws), so the runtime's `new Error(message)` carries
// the browser's wording, which differs per engine.

const NETWORK_WORDS =
  /failed to fetch|fetch failed|networkerror|network request failed|load failed|network connection was lost|internet connection appears to be offline|err_internet_disconnected|err_network|econnrefused|enotfound|etimedout|socket hang up/i;

/** Whether `error` means the request never reached the server (or its answer never came back). */
export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error ?? "");
  return NETWORK_WORDS.test(message);
}

/** Whether the browser says it has no network at all. */
export function browserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
