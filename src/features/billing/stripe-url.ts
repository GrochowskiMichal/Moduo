import { getRuntime } from "../../lib/runtime";

/** True when running inside the Tauri desktop shell (runtime-init independent). */
export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Opens a Stripe URL. On Tauri desktop, opens in the system browser.
 * On web, navigates the current tab (same-tab for checkout/portal flow).
 * The desktop check is on the shell, not the runtime singleton — a null
 * runtime must never make the Tauri webview navigate itself to Stripe.
 */
export async function openStripeUrl(url: string) {
  if (isDesktopShell()) {
    const rt = getRuntime();
    if (!rt?.capabilities.isDesktop) {
      throw new Error("The app is still starting — try again in a moment.");
    }
    await rt.window.openExternalUrl(url);
  } else {
    window.location.href = url;
  }
}
