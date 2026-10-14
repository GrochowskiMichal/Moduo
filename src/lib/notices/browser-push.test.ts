// Browser notifications (TV-D12): a browser's notices are its signed-in
// person's only. Signing out unsubscribes it; someone else's leftover
// subscription is replaced by a fresh one; the worker shows a notice's words
// only to the person it's for (public/push-display.js).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";

import { enableBrowserPush, forgetBrowserPush, postPushUser } from "./browser-push";

type FakeSub = {
  endpoint: string;
  unsubscribe: ReturnType<typeof rs.fn>;
  getKey: () => ArrayBuffer;
};

function fakeSub(endpoint: string): FakeSub {
  return {
    endpoint,
    unsubscribe: rs.fn(async () => true),
    getKey: () => new Uint8Array([1, 2, 3]).buffer,
  };
}

const VAPID =
  "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";

let current: FakeSub | null;
let posted: unknown[];
let made: string[];

beforeEach(() => {
  current = fakeSub("https://fcm.googleapis.com/fcm/send/old");
  posted = [];
  made = [];
  const pushManager = {
    getSubscription: async () => current,
    subscribe: async () => {
      const sub = fakeSub(`https://fcm.googleapis.com/fcm/send/new-${made.length + 1}`);
      made.push(sub.endpoint);
      current = sub;
      return sub;
    },
  };
  const registration = {
    pushManager,
    active: { postMessage: (m: unknown) => posted.push(m) },
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: async () => registration,
      register: async () => registration,
      ready: Promise.resolve(registration),
    },
  });
  Object.defineProperty(window, "PushManager", {
    configurable: true,
    value: function PushManager() {},
  });
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: { permission: "granted", requestPermission: async () => "granted" },
  });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(window, "PushManager");
  Reflect.deleteProperty(window, "Notification");
});

function runtime(over: { subscribe?: (endpoint: string) => Promise<void> } = {}) {
  const calls = { subscribe: [] as string[], unsubscribe: [] as string[] };
  return {
    calls,
    rt: {
      spine: {
        pushSubscribe: async ({ endpoint }: { endpoint: string }) => {
          calls.subscribe.push(endpoint);
          await over.subscribe?.(endpoint);
        },
        pushUnsubscribe: async ({ endpoint }: { endpoint: string }) => {
          calls.unsubscribe.push(endpoint);
        },
      },
    } as unknown as Parameters<typeof forgetBrowserPush>[0] & object,
  };
}

describe("browser push and signing out (TV-D12)", () => {
  it("signing out unsubscribes this browser, tells the server and the worker", async () => {
    const before = current!;
    const { rt, calls } = runtime();
    await forgetBrowserPush(rt);
    expect(before.unsubscribe).toHaveBeenCalled();
    expect(calls.unsubscribe).toEqual(["https://fcm.googleapis.com/fcm/send/old"]);
    expect(posted).toContainEqual({ type: "moduo-user", userId: null });
  });

  it("a sign-out without a session still unsubscribes locally", async () => {
    const before = current!;
    await forgetBrowserPush(null);
    expect(before.unsubscribe).toHaveBeenCalled();
    expect(posted).toContainEqual({ type: "moduo-user", userId: null });
  });

  it("tells the worker who's signed in", async () => {
    await postPushUser("u2");
    expect(posted).toEqual([{ type: "moduo-user", userId: "u2" }]);
  });

  it("replaces someone else's leftover subscription with a fresh one", async () => {
    const old = current!;
    const { rt, calls } = runtime({
      subscribe: async (endpoint) => {
        if (endpoint.endsWith("/old")) throw new Error("This browser is set up for someone else.");
      },
    });
    const state = await enableBrowserPush(rt, "u2", VAPID);
    expect(state).toBe("on");
    expect(old.unsubscribe).toHaveBeenCalled();
    expect(calls.subscribe).toEqual(["https://fcm.googleapis.com/fcm/send/old", made[0]]);
    expect(posted).toContainEqual({ type: "moduo-user", userId: "u2" });
  });
});

describe("what a pushed notice shows (public/push-display.js)", () => {
  const root: { moduoPushDisplay?: (data: unknown, uid: string | null) => Record<string, string> } =
    {};
  new Function("self", readFileSync(resolve(__dirname, "../../../public/push-display.js"), "utf8"))(
    root,
  );
  const show = root.moduoPushDisplay!;
  const data = {
    uid: "u1",
    title: "Reminder",
    body: "Call Anna",
    url: "/tasks?id=t1",
    tag: "reminder-t1",
  };

  it("shows the words to the person it's for", () => {
    expect(show(data, "u1")).toEqual({
      title: "Reminder",
      body: "Call Anna",
      url: "/tasks?id=t1",
      tag: "reminder-t1",
    });
  });

  it("shows a plain line to anyone else, or nobody", () => {
    for (const who of ["u2", null]) {
      const shown = show(data, who);
      expect(shown.body).not.toContain("Call Anna");
      expect(shown.url).toBe("/");
    }
    expect(show({ ...data, uid: undefined }, "u1").body).not.toContain("Call Anna");
  });

  it("opens only a path inside Moduo", () => {
    expect(show({ ...data, url: "https://evil.example" }, "u1").url).toBe("/");
    expect(show({ ...data, url: "//evil.example" }, "u1").url).toBe("/");
  });
});
