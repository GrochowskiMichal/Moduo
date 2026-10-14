// Browser notifications for the web app (TV-D12, REPLAN 73): opt-in per
// browser. Turning them on asks the browser's permission, registers the push
// service worker (`public/push-sw.js`) and sends the subscription to the
// server; reminders then arrive even when Moduo's tab is closed (Safari on a
// Mac even when Safari is). The desktop app never uses this: it shows OS
// notifications itself while it runs in the menu bar.
//
// A browser's notices are its signed-in person's only: the page tells the
// worker who that is (`postPushUser`), the worker shows the words only to
// them, and signing out unsubscribes this browser (`forgetBrowserPush`).

import type { ModuoRuntime } from "../runtime.types";

export const PUSH_WORKER_URL = "/push-sw.js";

/** Where this browser stands, in the words Settings uses. */
export type BrowserPushState =
  /** No Notification / Push API here (an embedded webview, an old browser). */
  | "unsupported"
  /** This build has no VAPID key: the server can't push. */
  | "unavailable"
  /** The person said no in the browser: only the browser's settings can undo it. */
  | "denied"
  /** Allowed by the browser, subscribed. */
  | "on"
  /** Not on (never asked, or turned off here). */
  | "off";

export function vapidPublicKey(): string | null {
  const key = import.meta.env.PUBLIC_VAPID_PUBLIC_KEY;
  return typeof key === "string" && key.trim() ? key.trim() : null;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

/** base64url → bytes (the VAPID key browsers want). */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** bytes → base64url, no padding (what the server stores). */
export function bytesToBase64Url(bytes: ArrayBuffer | null): string {
  if (!bytes) return "";
  let raw = "";
  for (const b of new Uint8Array(bytes)) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function existingSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(PUSH_WORKER_URL);
  return registration ? registration.pushManager.getSubscription() : null;
}

/** The server refuses an endpoint someone else registered (TV-D12). */
export function isTakenEndpointError(error: unknown): boolean {
  return error instanceof Error && /set up for someone else/i.test(error.message);
}

/** Tell the push worker who is signed in here (null: nobody). */
export async function postPushUser(userId: string | null): Promise<void> {
  if (!pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration(PUSH_WORKER_URL);
    const worker = registration?.active ?? registration?.waiting ?? registration?.installing;
    worker?.postMessage({ type: "moduo-user", userId });
  } catch {
    // No worker: nothing to tell.
  }
}

export async function browserPushState(): Promise<BrowserPushState> {
  if (!pushSupported()) return "unsupported";
  // The browser's "no" comes first: only its settings can undo it.
  if (Notification.permission === "denied") return "denied";
  if (!vapidPublicKey()) return "unavailable";
  if (Notification.permission !== "granted") return "off";
  try {
    return (await existingSubscription()) ? "on" : "off";
  } catch {
    return "off";
  }
}

/**
 * Ask the browser, subscribe and tell the server. Answers the state after:
 * "denied" when the person said no.
 */
export async function enableBrowserPush(
  runtime: Pick<ModuoRuntime, "spine">,
  userId: string,
  key: string | null = vapidPublicKey(),
): Promise<BrowserPushState> {
  if (!pushSupported()) return "unsupported";
  if (!key) return "unavailable";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const registration = await navigator.serviceWorker.register(PUSH_WORKER_URL, { scope: "/" });
  await navigator.serviceWorker.ready;
  const subscribe = () =>
    registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(key),
    });
  const register = (subscription: PushSubscription) =>
    runtime.spine.pushSubscribe({
      endpoint: subscription.endpoint,
      p256dh: bytesToBase64Url(subscription.getKey("p256dh")),
      auth: bytesToBase64Url(subscription.getKey("auth")),
      userAgent: navigator.userAgent,
    });
  const subscription = (await registration.pushManager.getSubscription()) ?? (await subscribe());
  try {
    await register(subscription);
  } catch (error) {
    if (!isTakenEndpointError(error)) throw error;
    // This browser still holds someone else's subscription (they never
    // signed out here): drop it and make this person a fresh one.
    await subscription.unsubscribe().catch(() => false);
    await register(await subscribe());
  }
  await postPushUser(userId);
  return "on";
}

/**
 * On sign-out (before the session ends): unsubscribe this browser, tell the
 * server and the worker. Never holds a sign-out up for long.
 */
export async function forgetBrowserPush(
  runtime: Pick<ModuoRuntime, "spine"> | null,
  timeoutMs = 2500,
): Promise<void> {
  if (!pushSupported()) return;
  const work = (async () => {
    await postPushUser(null);
    if (runtime) await disableBrowserPush(runtime);
    else await (await existingSubscription().catch(() => null))?.unsubscribe().catch(() => false);
  })().catch(() => undefined);
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}

/** Unsubscribe this browser here and on the server. */
export async function disableBrowserPush(
  runtime: Pick<ModuoRuntime, "spine">,
): Promise<BrowserPushState> {
  if (!pushSupported()) return "unsupported";
  const subscription = await existingSubscription().catch(() => null);
  if (subscription) {
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe().catch(() => false);
    await runtime.spine.pushUnsubscribe({ endpoint }).catch(() => undefined);
  }
  return Notification.permission === "denied" ? "denied" : "off";
}
