// The push-send request (TV-D12): only the database's kick runs it; each
// delivery goes to every browser of its person and is settled once.

import { describe, expect, it } from "@rstest/core";

import type { PushOutcome } from "../_shared/web-push.ts";
import { type ClaimedDelivery, handlePushRequest, pushMessage, type SettledDelivery } from "./handler.ts";

const SECRET = "a".repeat(64);

function deps(over: Partial<Parameters<typeof handlePushRequest>[1]> = {}) {
  const settled: SettledDelivery[][] = [];
  const sent: string[] = [];
  const delivery: ClaimedDelivery = {
    id: "d1",
    user_id: "u1",
    title: "Call Anna",
    body: null,
    url: "/tasks?id=t1",
    task_id: "t1",
    subscriptions: [
      { endpoint: "https://fcm.googleapis.com/a", p256dh: "k", auth: "a" },
      { endpoint: "https://web.push.apple.com/b", p256dh: "k", auth: "a" },
    ],
  };
  return {
    settled,
    sent,
    deps: {
      configured: true,
      authorize: async (s: string) => s === SECRET,
      claim: async () => [delivery],
      settle: async (r: SettledDelivery[]) => {
        settled.push(r);
      },
      send: async (sub: { endpoint: string }): Promise<PushOutcome> => {
        sent.push(sub.endpoint);
        return sub.endpoint.includes("apple") ? { ok: false, gone: true, status: 410 } : { ok: true, status: 201 };
      },
      ...over,
    },
  };
}

describe("push-send", () => {
  it("refuses anything but the database's kick", async () => {
    const { deps: d } = deps();
    expect((await handlePushRequest({ method: "GET", secret: SECRET }, d)).status).toBe(405);
    expect((await handlePushRequest({ method: "POST", secret: null }, d)).status).toBe(401);
    expect((await handlePushRequest({ method: "POST", secret: "b".repeat(64) }, d)).status).toBe(401);
  });

  it("sends each delivery to every browser and settles it once", async () => {
    const t = deps();
    const answer = await handlePushRequest({ method: "POST", secret: SECRET }, t.deps);
    expect(answer.status).toBe(200);
    expect(t.sent).toEqual(["https://fcm.googleapis.com/a", "https://web.push.apple.com/b"]);
    expect(t.settled).toEqual([[{ id: "d1", ok: true, error: undefined, gone: ["https://web.push.apple.com/b"] }]]);
  });

  it("says when the keys aren't set up, and sends nothing", async () => {
    const t = deps({ configured: false });
    const answer = await handlePushRequest({ method: "POST", secret: SECRET }, t.deps);
    expect(answer.status).toBe(503);
    expect(t.sent).toEqual([]);
  });

  it("a browser's notice carries ids and a short title, and opens a path inside Moduo only", () => {
    const base = { id: "d", user_id: "u1", title: "T", body: "a long description", task_id: null, subscriptions: [] };
    expect(pushMessage({ ...base, url: "/tasks?id=1" }).url).toBe("/tasks?id=1");
    expect(pushMessage({ ...base, url: "https://evil.example" }).url).toBe("/");
    expect(pushMessage({ ...base, url: "//evil.example" }).url).toBe("/");
    const message = pushMessage({ ...base, url: null });
    expect(message).toEqual({ uid: "u1", title: "Reminder", body: "T", url: "/", tag: "notice-d" });
    expect(pushMessage({ ...base, title: "x".repeat(200), url: null }).body).toHaveLength(80);
  });

  it("says an agent's state with the task's title (TV-D16)", () => {
    const base = { id: "d", user_id: "u1", subscriptions: [] };
    const message = pushMessage({
      ...base,
      kind: "agent",
      title: "Claude is ready for review",
      body: "Ship the importer",
      task_id: "t9",
      url: "/tasks?id=t9",
    });
    expect(message).toEqual({
      uid: "u1",
      title: "Claude is ready for review",
      body: "Ship the importer",
      url: "/tasks?id=t9",
      tag: "agent-t9",
    });
  });
});
