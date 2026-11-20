import { describe, expect, it, rs } from "@rstest/core";

// "Show me as online" across a sign-out (CV-17): a prefs read still in flight
// when the person signs out keeps nothing, so the defaults it may come back
// with (show online: on) never land under anyone's id; signing back in with
// the switch off tracks nothing.

const h = rs.hoisted(() => ({
  userId: "ana" as string | null,
  pending: [] as { resolve: (v: { data: unknown; error: null }) => void }[],
}));

rs.mock("@/lib/runtime.web.client", () => ({
  supabaseClient: {
    auth: {
      getSession: async () => ({
        data: { session: h.userId ? { user: { id: h.userId } } : null },
      }),
    },
    rpc: () =>
      new Promise((resolve) => {
        h.pending.push({ resolve });
      }),
  },
}));

const prefs = await import("./chat-prefs");
const { PresenceSelfRegistry } = await import("@/features/chat/store/presence-self");

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe("chat prefs across a sign-out", () => {
  it("a read in flight at sign-out keeps nothing; signing back in with the switch off tracks nothing", async () => {
    const registry = new PresenceSelfRegistry({
      get: (id) => prefs.currentChatServerPrefs(id)?.showOnline ?? null,
      subscribe: prefs.subscribeChatServerPrefs,
      read: prefs.readChatServerPrefs,
    });
    registry.for("ana");
    await flush();
    expect(h.pending).toHaveLength(1);

    // Ana signs out while the read is out; it comes back with the defaults.
    registry.forget();
    prefs.forgetChatServerPrefs();
    h.userId = null;
    h.pending.shift()!.resolve({ data: null, error: null });
    await flush();
    expect(prefs.currentChatServerPrefs("ana")).toBeNull();

    // She signs back in; her switch is off.
    h.userId = "ana";
    const self = registry.for("ana");
    await flush();
    expect(self.get().track).toBe(false);
    h.pending.shift()!.resolve({ data: { show_online: false }, error: null });
    await flush();
    expect(prefs.currentChatServerPrefs("ana")?.showOnline).toBe(false);
    expect(self.get().track).toBe(false);
    registry.forget();
  });

  it("the same race where the old session is still read keeps nothing either", async () => {
    prefs.forgetChatServerPrefs();
    h.userId = "ana";
    const read = prefs.readChatServerPrefs();
    await flush();
    prefs.forgetChatServerPrefs();
    h.pending.shift()!.resolve({ data: { show_online: true }, error: null });
    await read;
    expect(prefs.currentChatServerPrefs("ana")).toBeNull();
  });

  it("a read that started before a save never puts the old value back", async () => {
    prefs.forgetChatServerPrefs();
    h.userId = "ana";
    const read = prefs.readChatServerPrefs();
    await flush();
    const save = prefs.setChatServerPrefs({ showOnline: false });
    await flush();
    expect(h.pending).toHaveLength(2);
    // The save lands first, then the older read with the value from before.
    h.pending[1]!.resolve({ data: { show_online: false }, error: null });
    await save;
    h.pending[0]!.resolve({ data: { show_online: true }, error: null });
    await read;
    h.pending.length = 0;
    expect(prefs.currentChatServerPrefs("ana")?.showOnline).toBe(false);
  });

  it("a read in flight across a save is dropped when it lands after the save", async () => {
    prefs.forgetChatServerPrefs();
    h.userId = "ana";
    const save = prefs.setChatServerPrefs({ showOnline: false });
    await flush();
    // A re-read starts after the save was sent, answered before it committed.
    const read = prefs.readChatServerPrefs();
    await flush();
    expect(h.pending).toHaveLength(2);
    h.pending[0]!.resolve({ data: { show_online: false }, error: null });
    await save;
    h.pending[1]!.resolve({ data: { show_online: true }, error: null });
    await read;
    h.pending.length = 0;
    expect(prefs.currentChatServerPrefs("ana")?.showOnline).toBe(false);
  });
});
