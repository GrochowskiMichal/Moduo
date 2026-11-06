// The local mirror of mail settings items (MR-7, AC36 sync): pulls changes
// since its high-water mark, merges per row by last writer, drops tombstones,
// survives a reload from its cache, and refreshes on change and on focus.

import { describe, expect, it } from "@rstest/core";

import type { EmailSettingsItem } from "@/lib/runtime.types.email";

import { createEmailSettingsMirror, type EmailSettingsPort, pushClassifyItems } from "./mirror";

function item(
  id: string,
  updatedAt: string,
  extra: Partial<EmailSettingsItem> = {},
): EmailSettingsItem {
  return { id, kind: "rule", position: 0, value: {}, updatedAt, deletedAt: null, ...extra };
}

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

function fakePort(server: EmailSettingsItem[]) {
  const calls: (string | null | undefined)[] = [];
  let n = 0;
  const port: EmailSettingsPort = {
    async listSettings(input) {
      calls.push(input?.since);
      const since = input?.since;
      return server.filter((r) => (since ? r.updatedAt > since : r.deletedAt === null));
    },
    async upsertSetting({ id, kind, value, position }) {
      n += 1;
      const row = item(id, `2026-11-04T00:00:${String(10 + n).padStart(2, "0")}Z`, {
        kind,
        value,
        position: position ?? 0,
      });
      const i = server.findIndex((r) => r.id === id);
      if (i >= 0) server[i] = row;
      else server.push(row);
      return row;
    },
    async deleteSetting({ id }) {
      const r = server.find((x) => x.id === id);
      if (!r) return false;
      r.deletedAt = r.updatedAt = "2026-11-04T00:01:00Z";
      return true;
    },
  };
  return { port, calls };
}

describe("email settings mirror", () => {
  it("loads everything first, then only changes since the high-water mark", async () => {
    const server = [item("a", "2026-11-04T00:00:01Z"), item("b", "2026-11-04T00:00:02Z")];
    const { port, calls } = fakePort(server);
    const mirror = createEmailSettingsMirror({ port, storage: memoryStorage(), userId: "u1" });
    await mirror.refresh();
    expect(mirror.items().map((i) => i.id)).toEqual(["a", "b"]);
    server.push(item("c", "2026-11-04T00:00:03Z"));
    await mirror.refresh();
    expect(calls).toEqual([null, "2026-11-04T00:00:02Z"]);
    expect(mirror.items().map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("drops a row another device deleted and keeps the newer of two writes", async () => {
    const server = [item("a", "2026-11-04T00:00:01Z"), item("b", "2026-11-04T00:00:02Z")];
    const { port } = fakePort(server);
    const mirror = createEmailSettingsMirror({ port, storage: memoryStorage(), userId: "u1" });
    await mirror.refresh();
    server[0] = item("a", "2026-11-04T00:00:05Z", { deletedAt: "2026-11-04T00:00:05Z" });
    await mirror.refresh();
    expect(mirror.items().map((i) => i.id)).toEqual(["b"]);
    mirror.apply([item("b", "2026-11-04T00:00:01Z", { value: { stale: true } })]);
    expect(mirror.items()[0]?.value).toEqual({});
  });

  it("filters by kind in position order", async () => {
    const server = [
      item("t2", "2026-11-04T00:00:01Z", { kind: "custom_tab", position: 2 }),
      item("t1", "2026-11-04T00:00:02Z", { kind: "custom_tab", position: 1 }),
      item("r", "2026-11-04T00:00:03Z"),
    ];
    const mirror = createEmailSettingsMirror({
      port: fakePort(server).port,
      storage: memoryStorage(),
      userId: "u1",
    });
    await mirror.refresh();
    expect(mirror.byKind("custom_tab").map((i) => i.id)).toEqual(["t1", "t2"]);
  });

  it("writes through the port, updates at once and notifies subscribers", async () => {
    const server: EmailSettingsItem[] = [];
    const mirror = createEmailSettingsMirror({
      port: fakePort(server).port,
      storage: memoryStorage(),
      userId: "u1",
    });
    let pings = 0;
    mirror.subscribe(() => (pings += 1));
    await mirror.upsert({ id: "x", kind: "snippet", value: { name: "hi" } });
    expect(mirror.items().map((i) => i.id)).toEqual(["x"]);
    await mirror.remove("x");
    expect(mirror.items()).toEqual([]);
    expect(pings).toBeGreaterThanOrEqual(2);
  });

  it("restores from its cache per user, and never shows another user's cache", async () => {
    const storage = memoryStorage();
    const server = [item("a", "2026-11-04T00:00:01Z")];
    const first = createEmailSettingsMirror({ port: fakePort(server).port, storage, userId: "u1" });
    await first.refresh();
    const again = createEmailSettingsMirror({ port: fakePort([]).port, storage, userId: "u1" });
    expect(again.items().map((i) => i.id)).toEqual(["a"]);
    const other = createEmailSettingsMirror({ port: fakePort([]).port, storage, userId: "u2" });
    expect(other.items()).toEqual([]);
  });

  it("finds the sender override for an address, case-insensitively, newest first", async () => {
    const server = [
      item("o1", "2026-11-04T00:00:01Z", {
        kind: "sender_override",
        value: { address: "anna@x.com", section: "personal" },
      }),
      item("o2", "2026-11-04T00:00:02Z", {
        kind: "sender_override",
        value: { address: "anna@x.com", section: "newsletters" },
      }),
    ];
    const mirror = createEmailSettingsMirror({
      port: fakePort(server).port,
      storage: memoryStorage(),
      userId: "u1",
    });
    await mirror.refresh();
    expect(mirror.senderOverride("Anna@X.com")?.id).toBe("o2");
  });

  it("a failed refresh keeps what it had", async () => {
    const server = [item("a", "2026-11-04T00:00:01Z")];
    const { port } = fakePort(server);
    const mirror = createEmailSettingsMirror({ port, storage: memoryStorage(), userId: "u1" });
    await mirror.refresh();
    port.listSettings = async () => {
      throw new Error("offline");
    };
    await expect(mirror.refresh()).resolves.toBe(false);
    expect(mirror.items().map((i) => i.id)).toEqual(["a"]);
  });

  it("pushes the classifier's kinds to the engine now and on every change", async () => {
    const server = [
      item("r", "2026-11-04T00:00:01Z", { kind: "rule" }),
      item("s", "2026-11-04T00:00:02Z", { kind: "snippet" }),
    ];
    const { port } = fakePort(server);
    const mirror = createEmailSettingsMirror({ port, storage: null, userId: "u" });
    const pushed: string[][] = [];
    const stop = pushClassifyItems(mirror, async (items) => {
      pushed.push(items.map((i) => i.id));
    });
    await mirror.refresh();
    await mirror.upsert({ id: "b", kind: "blocked_sender", value: { address: "x@y.io" } });
    stop();
    await mirror.upsert({ id: "p", kind: "priority_person", value: { address: "p@y.io" } });
    expect(pushed).toEqual([[], ["r"], ["r", "b"]]);
  });
});
