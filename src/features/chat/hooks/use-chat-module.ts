// Chat page state for v1's screens (specs/chat.md), read from the chat store
// (CV-3, `../store`). The store owns the conversations, memberships, people,
// counts, message windows and chains, the outbox and the live merge; this hook
// shapes its snapshot the way v1's screens read it and turns their actions
// into the store's (a quiet toast on a refusal, "Offline" when the network is
// gone). v1's screens, and this hook, go with CV-8a.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { supabaseClient } from "@/lib/runtime.web";
import { type ComposerPick, encodeComposerText } from "../markup";
import type { ChatChannel, ChatMember, ChatMessage, ChatNotifyLevel, ChatPerson } from "../model";
import { chatPresence } from "../store/presence";
import { chatTypingStore, useChatSnapshot, useChatStore } from "../store/react";
import type { ChatSnapshot, ChatWriteResult } from "../store/store";
import type { ChatLink } from "./use-chat-live";

export type ChannelWindow = {
  items: ChatMessage[];
  hasMore: boolean;
  /** A window around a linked message that doesn't reach the newest one. */
  hasNewer: boolean;
  loading: boolean;
  loaded: boolean;
};

export type ThreadWindow = {
  items: ChatMessage[];
  /** The thread's root — held here, not spliced into the channel's paged window. */
  parent: ChatMessage | null;
  loading: boolean;
  loaded: boolean;
};

export type ChatStatus = "loading" | "locked" | "ready" | "error";

type Counts = { unread: number; mentions: number };

type State = {
  status: ChatStatus;
  error: string | null;
  channels: Record<string, ChatChannel>;
  mine: Record<string, ChatMember>;
  unread: Record<string, Counts>;
  people: Record<string, ChatPerson>;
  messages: Record<string, ChannelWindow>;
  threads: Record<string, ThreadWindow>;
};

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function peopleFromMembers(rows: unknown[]): Record<string, ChatPerson> {
  const out: Record<string, ChatPerson> = {};
  for (const raw of rows) {
    const row = raw as {
      user_id?: unknown;
      role?: unknown;
      profiles?: { display_name?: unknown; avatar_url?: unknown } | null;
    };
    if (typeof row?.user_id !== "string") continue;
    const name =
      typeof row.profiles?.display_name === "string" ? row.profiles.display_name.trim() : "";
    out[row.user_id] = {
      userId: row.user_id,
      name: name || "Member",
      avatarUrl: typeof row.profiles?.avatar_url === "string" ? row.profiles.avatar_url : null,
      role: typeof row.role === "string" ? row.role : null,
    };
  }
  return out;
}

/** v1's flags from the store's send state. */
function v1Row(m: ChatMessage): ChatMessage {
  if (!m.sendState) return m;
  return {
    ...m,
    pending: m.sendState === "sending" || m.sendState === "waiting",
    failed: m.sendState === "failed",
  };
}

/** v1 draws messages only (a move's event line is v2's), top-level in the channel. */
const isV1Message = (m: ChatMessage) => m.kind === "message";

function v1State(snap: ChatSnapshot, members: Record<string, ChatPerson>): State {
  const status: ChatStatus =
    snap.status === "ready" || snap.status === "locked" || snap.status === "error"
      ? snap.status
      : "loading";
  const unread: Record<string, Counts> = {};
  for (const [id, u] of Object.entries(snap.unread)) {
    unread[id] = { unread: u.unread, mentions: u.mentions };
  }
  const messages: Record<string, ChannelWindow> = {};
  for (const [id, w] of Object.entries(snap.windows)) {
    messages[id] = {
      items: w.rows.filter((m) => isV1Message(m) && !m.parentId).map(v1Row),
      hasMore: w.hasOlder,
      hasNewer: w.hasNewer,
      loading: w.loading,
      // Rows from the device show before the server answers.
      loaded: w.loaded || w.rows.length > 0,
    };
  }
  const threads: Record<string, ThreadWindow> = {};
  for (const [root, chain] of Object.entries(snap.chains)) {
    threads[root] = {
      items: chain.replies.filter(isV1Message).map(v1Row),
      parent: chain.root ? v1Row(chain.root) : null,
      loading: chain.loading,
      loaded: chain.loaded,
    };
  }
  return {
    status,
    error: snap.error,
    channels: snap.channels,
    mine: snap.mine,
    unread,
    people: { ...snap.people, ...members },
    messages,
    threads,
  };
}

function toastFailure(res: ChatWriteResult, fallback: string): boolean {
  if (res.ok) return false;
  toast(res.offline ? "Offline" : res.message || fallback);
  return true;
}

export function useChatModule({
  runtime,
  workspaceId,
  userId,
  activeChannelId,
  activeThreadId,
  focusMessageId = null,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  userId: string | null;
  activeChannelId: string | null;
  activeThreadId: string | null;
  /** A deep link, a notice or a search hit names a message: the stream lands on it (AC1.6). */
  focusMessageId?: string | null;
}) {
  const store = useChatStore(runtime, userId, workspaceId);
  const snap = useChatSnapshot(store);
  const ready = snap.status === "ready";

  // Everyone in the workspace (roles, the people picker): v1's screens list them all.
  const [members, setMembers] = useState<Record<string, ChatPerson>>({});
  useEffect(() => {
    setMembers({});
    if (!runtime || !workspaceId || !ready) return;
    let live = true;
    runtime.workspace
      .listMembers(workspaceId)
      .then((rows) => live && setMembers(peopleFromMembers(rows)))
      .catch(() => {
        /* chat_people still names everyone in your conversations */
      });
    return () => {
      live = false;
    };
  }, [runtime, workspaceId, ready]);

  const state = useMemo(() => v1State(snap, members), [snap, members]);

  // ── typing and presence (their own small stores) ──────────────────────────
  const typing = useMemo(
    () => (runtime && userId ? chatTypingStore(runtime, userId) : null),
    [runtime, userId],
  );
  const presence = useMemo(
    () => (workspaceId && userId ? chatPresence(supabaseClient, workspaceId, userId) : null),
    [workspaceId, userId],
  );
  useEffect(() => (ready ? presence?.acquire() : undefined), [presence, ready]);
  const link = useMemo<ChatLink | null>(() => {
    if (!typing || !presence || !ready) return null;
    return {
      sendTyping: (channelId, parentId, stop) => typing.send(channelId, parentId, stop),
      watchTyping: (channelId) => typing.watch(channelId),
      subscribePresence: presence.subscribe,
      getOnline: () => presence.getSnapshot().online,
      subscribeTyping: typing.subscribe,
      getTyping: () => typing.getSnapshot().entries,
    };
  }, [typing, presence, ready]);

  // Who's typing is followed per conversation: join the open one's topic and
  // leave it on switch (a thread's typing rides its conversation's topic).
  useEffect(() => {
    if (!link || !activeChannelId) return;
    return link.watchTyping(activeChannelId);
  }, [link, activeChannelId]);

  // ── opening ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (store && ready && activeChannelId) void store.open(activeChannelId);
  }, [store, ready, activeChannelId]);

  useEffect(() => {
    if (store && ready && activeThreadId) void store.openChain(activeThreadId);
  }, [store, ready, activeThreadId]);

  // A message named by the link that isn't in the window: load the window around it.
  const landed = useRef<string | null>(null);
  const win = activeChannelId ? snap.windows[activeChannelId] : undefined;
  useEffect(() => {
    if (!store || !ready || !activeChannelId || !focusMessageId || !win?.loaded) return;
    if (landed.current === focusMessageId) return;
    landed.current = focusMessageId;
    if (win.rows.some((m) => m.id === focusMessageId)) return;
    void store.openAt(activeChannelId, focusMessageId).then((at) => {
      if (!at) toast("That message isn't available.");
    });
  }, [store, ready, activeChannelId, focusMessageId, win]);

  // ── the read mark: the newest message on screen ───────────────────────────
  // v1's list shows the newest messages when a conversation opens; v2's stream
  // (CV-7a) reports the last row it actually drew.
  const markSeen = useCallback(() => {
    if (!store || !activeChannelId || !win || win.hasNewer) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    for (let i = win.rows.length - 1; i >= 0; i -= 1) {
      const m = win.rows[i]!;
      if (m.sendState) continue;
      store.markSeen(activeChannelId, m.id);
      return;
    }
  }, [store, activeChannelId, win]);
  useEffect(() => {
    if (win?.loaded) markSeen();
  }, [win, markSeen]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") markSeen();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markSeen]);

  // ── message writes ────────────────────────────────────────────────────────
  const send = useCallback(
    (args: {
      channelId: string;
      text: string;
      picks: ComposerPick[];
      parentId?: string | null;
    }) => {
      if (!store) return;
      const encoded = encodeComposerText(args.text.replace(/\s+$/, ""), args.picks);
      if (!encoded.body.trim()) return;
      // v1's composer writes v1 markup: the server converts it, under our id.
      store.send({
        channelId: args.channelId,
        body: encoded.body,
        replyToId: args.parentId ?? null,
        format: "v1",
      });
      link?.sendTyping(args.channelId, args.parentId ?? null, true);
    },
    [store, link],
  );

  const retry = useCallback((msg: ChatMessage) => store?.retry(msg.id), [store]);

  const edit = useCallback(
    async (msg: ChatMessage, text: string, picks: ComposerPick[]) => {
      if (!store) return;
      const encoded = encodeComposerText(text.replace(/\s+$/, ""), picks);
      if (!encoded.body.trim() || encoded.body === msg.body) return;
      toastFailure(await store.edit(msg.id, encoded.body, "v1"), "Couldn't save the edit.");
    },
    [store],
  );

  const remove = useCallback(
    async (msg: ChatMessage) => {
      if (!store) return;
      toastFailure(await store.remove(msg.id), "Couldn't delete the message.");
    },
    [store],
  );

  const react = useCallback(
    async (msg: ChatMessage, emoji: string) => {
      if (!store || !userId || msg.sendState) return;
      const on = !(msg.reactions[emoji] ?? []).includes(userId);
      toastFailure(await store.react(msg.id, emoji, on), "Couldn't add the reaction.");
    },
    [store, userId],
  );

  const pin = useCallback(
    async (msg: ChatMessage, pinned: boolean) => {
      if (!store) return;
      const res = await store.pin(msg.id, pinned);
      if (!toastFailure(res, "Couldn't update the pin.")) {
        toast(pinned ? "Pinned to the conversation" : "Unpinned");
      }
    },
    [store],
  );

  /** "Mark as read": the read mark moves to the newest message held. */
  const markRead = useCallback(
    (channelId: string) => {
      const rows = snap.windows[channelId]?.rows ?? [];
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const m = rows[i]!;
        if (m.sendState) continue;
        store?.markSeen(channelId, m.id);
        return;
      }
    },
    [store, snap.windows],
  );

  const markUnread = useCallback(
    async (msg: ChatMessage) => {
      if (!store) return;
      toastFailure(await store.markUnread(msg.channelId, msg.id), "Couldn't mark as unread.");
    },
    [store],
  );

  const loadOlder = useCallback(
    async (channelId: string) => {
      await store?.loadOlder(channelId);
    },
    [store],
  );

  /** Back to the newest messages from a window around a linked message. */
  const jumpToLatest = useCallback(
    async (channelId: string) => {
      await store?.jumpToLatest(channelId);
    },
    [store],
  );

  const loadThread = useCallback(
    async (parentId: string) => {
      await store?.openChain(parentId);
    },
    [store],
  );

  // ── channel writes ────────────────────────────────────────────────────────
  const createChannel = useCallback(
    async (args: {
      name: string;
      topic: string;
      isPrivate: boolean;
      memberIds: string[];
      managersOnly?: boolean;
    }) => {
      if (!store) throw new Error("Chat isn't ready.");
      const channel = await store.createChannel({
        name: args.name,
        topic: args.topic,
        isPrivate: args.isPrivate,
        memberIds: args.memberIds,
      });
      if (args.managersOnly) {
        const { error } = await supabaseClient.rpc("share_op_announce", {
          p_channel_id: channel.id,
          p_on: true,
        });
        if (error) throw new Error(error.message);
      }
      return channel;
    },
    [store],
  );

  const openDm = useCallback(
    async (userIds: string[]) => {
      if (!store) throw new Error("Chat isn't ready.");
      return store.openDm(userIds);
    },
    [store],
  );

  const join = useCallback(
    async (channelId: string) => {
      try {
        await store?.join(channelId);
      } catch (err) {
        toast(errorText(err, "Couldn't join the channel."));
      }
    },
    [store],
  );

  const leave = useCallback(
    async (channelId: string) => {
      try {
        await store?.leave(channelId);
      } catch (err) {
        toast(errorText(err, "Couldn't leave the channel."));
      }
    },
    [store],
  );

  const updateChannel = useCallback(
    async (channelId: string, patch: { name?: string; topic?: string }) => {
      try {
        await store?.updateChannel(channelId, patch);
      } catch (err) {
        toast(errorText(err, "Couldn't update the channel."));
        throw err;
      }
    },
    [store],
  );

  const archiveChannel = useCallback(
    async (channelId: string, archived: boolean) => {
      try {
        await store?.archiveChannel(channelId, archived);
      } catch (err) {
        toast(errorText(err, "Couldn't archive the channel."));
      }
    },
    [store],
  );

  const setPrefs = useCallback(
    async (channelId: string, prefs: { notifyLevel?: ChatNotifyLevel; starred?: boolean }) => {
      try {
        await store?.setPrefs(channelId, prefs);
      } catch (err) {
        toast(errorText(err, "Couldn't save that setting."));
      }
    },
    [store],
  );

  const addMembers = useCallback(
    async (channelId: string, userIds: string[]) => {
      if (!runtime) return 0;
      try {
        const n = await runtime.chat.addMembers({ channelId, userIds });
        toast(n === 1 ? "Added 1 person" : `Added ${n} people`);
        return n;
      } catch (err) {
        toast(errorText(err, "Couldn't add people."));
        return 0;
      }
    },
    [runtime],
  );

  const removeMember = useCallback(
    async (channelId: string, memberId: string) => {
      if (!runtime) return;
      try {
        await runtime.chat.removeMember({ channelId, userId: memberId });
      } catch (err) {
        toast(errorText(err, "Couldn't remove that person."));
      }
    },
    [runtime],
  );

  const reload = useCallback(async () => {
    await store?.sync("manual");
  }, [store]);

  const actions = useMemo(
    () => ({
      send,
      retry,
      edit,
      remove,
      react,
      pin,
      markRead,
      markUnread,
      loadOlder,
      jumpToLatest,
      loadThread,
      createChannel,
      openDm,
      join,
      leave,
      updateChannel,
      archiveChannel,
      setPrefs,
      addMembers,
      removeMember,
      reload,
    }),
    [
      send,
      retry,
      edit,
      remove,
      react,
      pin,
      markRead,
      markUnread,
      loadOlder,
      jumpToLatest,
      loadThread,
      createChannel,
      openDm,
      join,
      leave,
      updateChannel,
      archiveChannel,
      setPrefs,
      addMembers,
      removeMember,
      reload,
    ],
  );

  return { state, link, actions };
}

export type ChatModule = ReturnType<typeof useChatModule>;
export type ChatActions = ChatModule["actions"];
