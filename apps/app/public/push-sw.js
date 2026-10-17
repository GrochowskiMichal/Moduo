// Moduo's push service worker (TV-D12): shows a reminder the server pushed to
// this browser, and opens Moduo on the task when it's clicked. Registered only
// when someone turns on browser notifications (src/lib/notices/browser-push.ts).
// It does nothing else: no caching of the app, no fetch handling.
//
// The page tells the worker who is signed in (a "moduo-user" message, kept in
// a one-entry cache); a notice for anyone else shows a plain line only
// (public/push-display.js).

importScripts("/push-display.js");

const USER_CACHE = "moduo-push-user";
const USER_KEY = "/__moduo_push_user";

async function signedInUser() {
  try {
    const cache = await caches.open(USER_CACHE);
    const hit = await cache.match(USER_KEY);
    const id = hit ? (await hit.text()).trim() : "";
    return id || null;
  } catch {
    return null;
  }
}

async function rememberUser(userId) {
  const cache = await caches.open(USER_CACHE);
  if (userId) await cache.put(USER_KEY, new Response(userId));
  else await cache.delete(USER_KEY);
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "moduo-user") return;
  // Only Moduo's own pages talk to it.
  if (event.origin && event.origin !== self.location.origin) return;
  event.waitUntil(rememberUser(typeof data.userId === "string" ? data.userId : null));
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    (async () => {
      const user = await signedInUser();
      const shown = self.moduoPushDisplay(data, user);
      // Moduo in front shows its own toast for its person's reminder: no
      // second one. A chat notice (CV-6b) is pushed only when no open Moduo
      // acknowledged it within 8 s (Chat in front acknowledges it at once), so
      // a focused window on another module or workspace still gets it.
      const chat = shown.tag.indexOf("chat:") === 0;
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (!chat && user && data && data.uid === user && windows.some((c) => c.focused)) return;
      await self.registration.showNotification(shown.title, {
        body: shown.body,
        tag: shown.tag,
        data: { url: shown.url },
        icon: "/icon-192.png",
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.url;
  const url = new URL(
    typeof path === "string" && path.startsWith("/") ? path : "/",
    self.location.origin,
  ).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) await client.navigate(url).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
