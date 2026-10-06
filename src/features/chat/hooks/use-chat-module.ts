// Chat page state (specs/chat.md). Owns the loaded channels, my memberships,
// unread counts, people, per-channel message windows and open threads, and
// folds realtime events into them. Every write is optimistic where a user would
// feel the latency (send, react, edit, delete, star, mute) and reconciles with
// the op's returned row; a failure rolls back with a quiet toast.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { type ComposerPick, encodeComposerText, toPlainText } from "../markup";
import type { ChatChannel, ChatMember, ChatMessage, ChatNotifyLevel, ChatPerson } from "../model";
import {
  acquireChatLink,
  type ChatDbEvent,
  type ChatLink,
  dispatchChatReadChanged,
} from "../realtime";
import { mergeMessages, toggleReaction, upsertMessage } from "../timeline";

const PAGE_SIZE = 50;
const MARK_READ_DEBOUNCE_MS = 600;

export type ChannelWindow = {
  items: ChatMessage[];
  hasMore: boolean;
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

const EMPTY_STATE: State = {
  status: "loading",
  error: null,
  channels: {},
  mine: {},
  unread: {},
  people: {},
  messages: {},
  threads: {},
};

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function newUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ ((Math.random() * 16) >> (Number(c) / 4))).toString(16),
  );
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

/** A top-level row changed — keep an open thread's copy of its root in step. */
function withThreadParent(state: State, msg: ChatMessage): State {
  const thread = state.threads[msg.id];
  if (msg.parentId || !thread) return state;
  return { ...state, threads: { ...state.threads, [msg.id]: { ...thread, parent: msg } } };
}

function byKey<T>(items: T[], key: (t: T) => string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) out[key(item)] = item;
  return out;
}

export function useChatModule({
  runtime,
  workspaceId,
  userId,
  activeChannelId,
  activeThreadId,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  userId: string | null;
  activeChannelId: string | null;
  activeThreadId: string | null;
}) {
  const [state, setState] = useState<State>(EMPTY_STATE);
  const [link, setLink] = useState<ChatLink | null>(null);
  const activeRef = useRef({ channelId: activeChannelId, threadId: activeThreadId });
  activeRef.current = { channelId: activeChannelId, threadId: activeThreadId };
  const stateRef = useRef(state);
  stateRef.current = state;
  const markTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const chat = runtime?.chat ?? null;

  // ── initial load ──────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!chat || !runtime || !workspaceId || !userId) return null;
    const [channels, mine, unread, members] = await Promise.all([
      chat.listChannels(workspaceId),
      chat.listMyMemberships(workspaceId, userId),
      chat.unreadCounts(workspaceId),
      runtime.workspace.listMembers(workspaceId).catch(() => [] as unknown[]),
    ]);
    return { channels, mine, unread, members };
  }, [chat, runtime, workspaceId, userId]);

  const applyLoaded = useCallback((loaded: NonNullable<Awaited<ReturnType<typeof loadAll>>>) => {
    setState((prev) => ({
      ...prev,
      status: "ready",
      error: null,
      channels: byKey(loaded.channels, (c) => c.id),
      mine: byKey(loaded.mine, (m) => m.channelId),
      unread: Object.fromEntries(
        loaded.unread.map((u) => [u.channelId, { unread: u.unread, mentions: u.mentions }]),
      ),
      people: { ...prev.people, ...peopleFromMembers(loaded.members) },
    }));
  }, []);

  useEffect(() => {
    setState(EMPTY_STATE);
    setLink(null);
    if (!chat || !workspaceId || !userId) return;
    let cancelled = false;
    let release: (() => void) | null = null;

    void (async () => {
      try {
        const enabled = await chat.isEnabled(workspaceId);
        if (cancelled) return;
        if (!enabled) {
          setState({ ...EMPTY_STATE, status: "locked" });
          return;
        }
        await chat.bootstrap(workspaceId);
        let loaded = await loadAll();
        if (cancelled || !loaded) return;

        // First visit to chat in this workspace: join #general (Slack's default).
        const flag = `moduo:chat:autojoined:${workspaceId}:${userId}`;
        let seen = false;
        try {
          seen = window.localStorage.getItem(flag) === "1";
        } catch {
          seen = false;
        }
        if (!seen) {
          const general = loaded.channels.find((c) => c.kind === "channel" && c.name === "general");
          if (general && !loaded.mine.some((m) => m.channelId === general.id)) {
            try {
              await chat.join(general.id);
              loaded = (await loadAll()) ?? loaded;
            } catch {
              /* non-fatal — the channel stays one click away in Browse */
            }
          }
          try {
            window.localStorage.setItem(flag, "1");
          } catch {
            /* storage disabled */
          }
        }
        if (cancelled) return;
        applyLoaded(loaded);
        const held = acquireChatLink(workspaceId, userId);
        release = held.release;
        setLink(held.link);
      } catch (err) {
        if (!cancelled) {
          setState({
            ...EMPTY_STATE,
            status: "error",
            error: errorText(err, "Chat couldn't load."),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      release?.();
    };
  }, [chat, workspaceId, userId, loadAll, applyLoaded]);

  // ── read marks ────────────────────────────────────────────────────────────
  const markReadSoon = useCallback(
    (channelId: string) => {
      if (!chat) return;
      if (markTimer.current) clearTimeout(markTimer.current);
      markTimer.current = setTimeout(() => {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        const now = new Date().toISOString();
        setState((prev) => {
          const member = prev.mine[channelId];
          if (!member) return prev;
          return {
            ...prev,
            unread: { ...prev.unread, [channelId]: { unread: 0, mentions: 0 } },
            mine: { ...prev.mine, [channelId]: { ...member, lastReadAt: now } },
          };
        });
        void chat
          .markRead({ channelId })
          .then(dispatchChatReadChanged)
          .catch(() => {
            /* the next open retries; unread is ambient */
          });
      }, MARK_READ_DEBOUNCE_MS);
    },
    [chat],
  );

  // Coming back to the tab with the channel open marks it read.
  useEffect(() => {
    const onVisible = () => {
      const id = activeRef.current.channelId;
      if (document.visibilityState === "visible" && id && stateRef.current.unread[id]?.unread) {
        markReadSoon(id);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markReadSoon]);

  useEffect(
    () => () => {
      if (markTimer.current) clearTimeout(markTimer.current);
    },
    [],
  );

  // ── messages ──────────────────────────────────────────────────────────────
  const loadLatest = useCallback(
    async (channelId: string) => {
      if (!chat) return;
      setState((prev) => ({
        ...prev,
        messages: {
          ...prev.messages,
          [channelId]: {
            items: prev.messages[channelId]?.items ?? [],
            hasMore: prev.messages[channelId]?.hasMore ?? true,
            loaded: prev.messages[channelId]?.loaded ?? false,
            loading: true,
          },
        },
      }));
      try {
        const page = await chat.listMessages({ channelId, limit: PAGE_SIZE });
        setState((prev) => {
          const existing = prev.messages[channelId];
          const merged = mergeMessages(existing?.loaded ? existing.items : [], page);
          return {
            ...prev,
            messages: {
              ...prev.messages,
              [channelId]: {
                items: merged,
                hasMore: existing?.loaded ? existing.hasMore : page.length >= PAGE_SIZE,
                loading: false,
                loaded: true,
              },
            },
          };
        });
      } catch (err) {
        toast(errorText(err, "Couldn't load messages."));
        setState((prev) => ({
          ...prev,
          messages: {
            ...prev.messages,
            [channelId]: { items: [], hasMore: false, loaded: true, loading: false },
          },
        }));
      }
    },
    [chat],
  );

  const loadOlder = useCallback(
    async (channelId: string) => {
      const win = stateRef.current.messages[channelId];
      if (!chat || !win || win.loading || !win.hasMore) return;
      const oldest = win.items.find((m) => !m.pending);
      setState((prev) => ({
        ...prev,
        messages: { ...prev.messages, [channelId]: { ...win, loading: true } },
      }));
      try {
        const page = await chat.listMessages({
          channelId,
          before: oldest?.createdAt ?? null,
          limit: PAGE_SIZE,
        });
        setState((prev) => {
          const cur = prev.messages[channelId] ?? win;
          return {
            ...prev,
            messages: {
              ...prev.messages,
              [channelId]: {
                items: mergeMessages(cur.items, page),
                hasMore: page.length >= PAGE_SIZE,
                loading: false,
                loaded: true,
              },
            },
          };
        });
      } catch {
        setState((prev) => ({
          ...prev,
          messages: { ...prev.messages, [channelId]: { ...win, loading: false } },
        }));
      }
    },
    [chat],
  );

  const loadThread = useCallback(
    async (parentId: string) => {
      if (!chat) return;
      setState((prev) => ({
        ...prev,
        threads: {
          ...prev.threads,
          [parentId]: {
            items: prev.threads[parentId]?.items ?? [],
            parent: prev.threads[parentId]?.parent ?? null,
            loading: true,
            loaded: false,
          },
        },
      }));
      try {
        const [replies, parent] = await Promise.all([
          chat.listReplies(parentId),
          chat.getMessage(parentId),
        ]);
        setState((prev) => ({
          ...prev,
          threads: {
            ...prev.threads,
            [parentId]: {
              items: mergeMessages(prev.threads[parentId]?.items ?? [], replies),
              parent,
              loading: false,
              loaded: true,
            },
          },
        }));
      } catch (err) {
        toast(errorText(err, "Couldn't load the thread."));
        setState((prev) => ({
          ...prev,
          threads: {
            ...prev.threads,
            [parentId]: { items: [], parent: null, loading: false, loaded: true },
          },
        }));
      }
    },
    [chat],
  );

  // Open channel → load its latest page once, mark it read.
  useEffect(() => {
    if (state.status !== "ready" || !activeChannelId) return;
    if (!stateRef.current.messages[activeChannelId]?.loaded) void loadLatest(activeChannelId);
    if (stateRef.current.mine[activeChannelId]) markReadSoon(activeChannelId);
  }, [state.status, activeChannelId, loadLatest, markReadSoon]);

  useEffect(() => {
    if (state.status !== "ready" || !activeThreadId) return;
    if (!stateRef.current.threads[activeThreadId]?.loaded) void loadThread(activeThreadId);
  }, [state.status, activeThreadId, loadThread]);

  // ── realtime ──────────────────────────────────────────────────────────────
  const resync = useCallback(async () => {
    try {
      const loaded = await loadAll();
      if (loaded) applyLoaded(loaded);
    } catch {
      return;
    }
    const { channelId, threadId } = activeRef.current;
    if (channelId) void loadLatest(channelId);
    if (threadId) void loadThread(threadId);
  }, [loadAll, applyLoaded, loadLatest, loadThread]);

  useEffect(() => {
    if (!link || !userId) return;
    const onEvent = (event: ChatDbEvent) => {
      if (event.type === "resync") {
        void resync();
        return;
      }
      if (event.type === "channel") {
        setState((prev) => ({
          ...prev,
          channels: { ...prev.channels, [event.channel.id]: event.channel },
        }));
        return;
      }
      if (event.type === "membership") {
        const known = Boolean(stateRef.current.channels[event.member.channelId]);
        setState((prev) => ({
          ...prev,
          mine: { ...prev.mine, [event.member.channelId]: event.member },
        }));
        // Added to a private channel / DM we couldn't see before → fetch it.
        if (!known) void resync();
        return;
      }
      if (event.type === "membership-removed") {
        setState((prev) => {
          const mine = { ...prev.mine };
          delete mine[event.channelId];
          return { ...prev, mine };
        });
        return;
      }

      const m = event.message;
      setState((prev) => {
        let next = prev;
        if (m.parentId) {
          const thread = prev.threads[m.parentId];
          if (thread?.loaded) {
            next = {
              ...next,
              threads: {
                ...next.threads,
                [m.parentId]: { ...thread, items: upsertMessage(thread.items, m) },
              },
            };
          }
          return next;
        }
        next = withThreadParent(next, m);
        const win = prev.messages[m.channelId];
        if (win?.loaded) {
          next = {
            ...next,
            messages: {
              ...next.messages,
              [m.channelId]: { ...win, items: upsertMessage(win.items, m) },
            },
          };
        }
        const channel = prev.channels[m.channelId];
        if (event.isInsert && channel) {
          next = {
            ...next,
            channels: {
              ...next.channels,
              [m.channelId]: { ...channel, lastMessageAt: m.createdAt },
            },
          };
          const fromOther = m.authorId !== userId;
          const isOpen =
            activeRef.current.channelId === m.channelId &&
            typeof document !== "undefined" &&
            document.visibilityState === "visible";
          if (fromOther && prev.mine[m.channelId] && !isOpen) {
            const cur = prev.unread[m.channelId] ?? { unread: 0, mentions: 0 };
            next = {
              ...next,
              unread: {
                ...next.unread,
                [m.channelId]: {
                  unread: cur.unread + 1,
                  mentions: cur.mentions + (m.mentionedUserIds.includes(userId) ? 1 : 0),
                },
              },
            };
          }
        }
        return next;
      });
      if (
        event.isInsert &&
        !m.parentId &&
        m.authorId !== userId &&
        activeRef.current.channelId === m.channelId &&
        stateRef.current.mine[m.channelId]
      ) {
        markReadSoon(m.channelId);
      }
    };
    return link.subscribe(onEvent);
  }, [link, userId, resync, markReadSoon]);

  // ── message writes ────────────────────────────────────────────────────────
  const patchMessage = useCallback((msg: ChatMessage) => {
    setState((prev) => {
      if (msg.parentId) {
        const thread = prev.threads[msg.parentId];
        if (!thread) return prev;
        return {
          ...prev,
          threads: {
            ...prev.threads,
            [msg.parentId]: { ...thread, items: upsertMessage(thread.items, msg) },
          },
        };
      }
      const synced = withThreadParent(prev, msg);
      const win = synced.messages[msg.channelId];
      if (!win) return synced;
      return {
        ...synced,
        messages: {
          ...synced.messages,
          [msg.channelId]: { ...win, items: upsertMessage(win.items, msg) },
        },
      };
    });
  }, []);

  const dropLocal = useCallback((msg: ChatMessage) => {
    setState((prev) => {
      const without = (items: ChatMessage[]) => items.filter((m) => m.id !== msg.id);
      if (msg.parentId) {
        const thread = prev.threads[msg.parentId];
        if (!thread) return prev;
        return {
          ...prev,
          threads: { ...prev.threads, [msg.parentId]: { ...thread, items: without(thread.items) } },
        };
      }
      const win = prev.messages[msg.channelId];
      if (!win) return prev;
      return {
        ...prev,
        messages: { ...prev.messages, [msg.channelId]: { ...win, items: without(win.items) } },
      };
    });
  }, []);

  const nameOf = useCallback((id: string) => stateRef.current.people[id]?.name ?? "someone", []);

  const deliver = useCallback(
    async (optimistic: ChatMessage, notifyChannel: boolean) => {
      if (!chat) return;
      try {
        const saved = await chat.send({
          channelId: optimistic.channelId,
          body: optimistic.body,
          parentId: optimistic.parentId,
          mentionedUserIds: optimistic.mentionedUserIds,
          notifyChannel,
          clientId: optimistic.clientId ?? undefined,
          excerpt: toPlainText(optimistic.body, nameOf).slice(0, 140),
        });
        patchMessage(saved);
        if (!optimistic.parentId) {
          setState((prev) => {
            const member = prev.mine[saved.channelId];
            const channel = prev.channels[saved.channelId];
            return {
              ...prev,
              channels: channel
                ? {
                    ...prev.channels,
                    [saved.channelId]: { ...channel, lastMessageAt: saved.createdAt },
                  }
                : prev.channels,
              mine: member
                ? prev.mine
                : {
                    ...prev.mine,
                    // Posting in a public channel joins it server-side.
                    [saved.channelId]: {
                      channelId: saved.channelId,
                      userId: saved.authorId ?? "",
                      workspaceId: saved.workspaceId,
                      notifyLevel: "mentions",
                      starred: false,
                      lastReadAt: saved.createdAt,
                      joinedAt: saved.createdAt,
                    },
                  },
            };
          });
        }
      } catch (err) {
        patchMessage({ ...optimistic, pending: false, failed: true });
        toast(errorText(err, "Message not sent."));
      }
    },
    [chat, nameOf, patchMessage],
  );

  const send = useCallback(
    (args: {
      channelId: string;
      text: string;
      picks: ComposerPick[];
      parentId?: string | null;
    }) => {
      if (!userId || !workspaceId) return;
      const encoded = encodeComposerText(args.text.replace(/\s+$/, ""), args.picks);
      if (!encoded.body.trim()) return;
      const clientId = newUuid();
      const optimistic: ChatMessage = {
        id: `local:${clientId}`,
        workspaceId,
        channelId: args.channelId,
        parentId: args.parentId ?? null,
        authorId: userId,
        authorKind: "user",
        authorLabel: null,
        body: encoded.body,
        mentionedUserIds: encoded.mentionedUserIds,
        reactions: {},
        replyCount: 0,
        lastReplyAt: null,
        replyUserIds: [],
        pinnedAt: null,
        pinnedBy: null,
        editedAt: null,
        deletedAt: null,
        clientId,
        createdAt: new Date().toISOString(),
        pending: true,
      };
      patchMessage(optimistic);
      link?.sendTyping(args.channelId, args.parentId ?? null, true);
      void deliver(optimistic, encoded.notifyChannel);
    },
    [userId, workspaceId, patchMessage, deliver, link],
  );

  const retry = useCallback(
    (msg: ChatMessage) => {
      const again = { ...msg, pending: true, failed: false, createdAt: new Date().toISOString() };
      patchMessage(again);
      void deliver(again, msg.body.includes("<!channel>"));
    },
    [patchMessage, deliver],
  );

  const edit = useCallback(
    async (msg: ChatMessage, text: string, picks: ComposerPick[]) => {
      if (!chat) return;
      const encoded = encodeComposerText(text.replace(/\s+$/, ""), picks);
      if (!encoded.body.trim() || encoded.body === msg.body) return;
      patchMessage({ ...msg, body: encoded.body, editedAt: new Date().toISOString() });
      try {
        patchMessage(
          await chat.edit({
            messageId: msg.id,
            body: encoded.body,
            mentionedUserIds: encoded.mentionedUserIds,
          }),
        );
      } catch (err) {
        patchMessage(msg);
        toast(errorText(err, "Couldn't save the edit."));
      }
    },
    [chat, patchMessage],
  );

  const remove = useCallback(
    async (msg: ChatMessage) => {
      if (!chat) return;
      if (msg.failed || msg.id.startsWith("local:")) {
        dropLocal(msg);
        return;
      }
      patchMessage({ ...msg, deletedAt: new Date().toISOString(), body: "", reactions: {} });
      try {
        patchMessage(await chat.remove(msg.id));
      } catch (err) {
        patchMessage(msg);
        toast(errorText(err, "Couldn't delete the message."));
      }
    },
    [chat, patchMessage, dropLocal],
  );

  const react = useCallback(
    async (msg: ChatMessage, emoji: string) => {
      if (!chat || !userId || msg.pending || msg.failed) return;
      patchMessage({ ...msg, reactions: toggleReaction(msg.reactions, emoji, userId) });
      try {
        patchMessage(await chat.react({ messageId: msg.id, emoji }));
      } catch (err) {
        patchMessage(msg);
        toast(errorText(err, "Couldn't add the reaction."));
      }
    },
    [chat, userId, patchMessage],
  );

  const pin = useCallback(
    async (msg: ChatMessage, pinned: boolean) => {
      if (!chat) return;
      const now = new Date().toISOString();
      patchMessage({ ...msg, pinnedAt: pinned ? now : null, pinnedBy: pinned ? userId : null });
      try {
        patchMessage(await chat.pin({ messageId: msg.id, pinned }));
        toast(pinned ? "Pinned to the conversation" : "Unpinned");
      } catch (err) {
        patchMessage(msg);
        toast(errorText(err, "Couldn't update the pin."));
      }
    },
    [chat, patchMessage, userId],
  );

  const markUnread = useCallback(
    async (msg: ChatMessage) => {
      if (!chat) return;
      const win = stateRef.current.messages[msg.channelId];
      const count =
        win?.items.filter(
          (m) => m.createdAt >= msg.createdAt && m.authorId !== userId && !m.deletedAt,
        ).length ?? 1;
      setState((prev) => {
        const member = prev.mine[msg.channelId];
        if (!member) return prev;
        return {
          ...prev,
          mine: { ...prev.mine, [msg.channelId]: { ...member, lastReadAt: msg.createdAt } },
          unread: { ...prev.unread, [msg.channelId]: { unread: count, mentions: 0 } },
        };
      });
      try {
        await chat.markUnread({ channelId: msg.channelId, before: msg.createdAt });
        dispatchChatReadChanged();
      } catch (err) {
        toast(errorText(err, "Couldn't mark as unread."));
      }
    },
    [chat, userId],
  );

  // ── channel writes ────────────────────────────────────────────────────────
  const refreshMembership = useCallback(async () => {
    if (!chat || !workspaceId || !userId) return;
    const [channels, mine] = await Promise.all([
      chat.listChannels(workspaceId),
      chat.listMyMemberships(workspaceId, userId),
    ]);
    setState((prev) => ({
      ...prev,
      channels: byKey(channels, (c) => c.id),
      mine: byKey(mine, (m) => m.channelId),
    }));
  }, [chat, workspaceId, userId]);

  const createChannel = useCallback(
    async (args: { name: string; topic: string; isPrivate: boolean; memberIds: string[] }) => {
      if (!chat || !workspaceId) throw new Error("Chat isn't ready.");
      const channel = await chat.createChannel({ workspaceId, ...args });
      await refreshMembership();
      return channel;
    },
    [chat, workspaceId, refreshMembership],
  );

  const openDm = useCallback(
    async (userIds: string[]) => {
      if (!chat || !workspaceId) throw new Error("Chat isn't ready.");
      const channel = await chat.openDm({ workspaceId, userIds });
      await refreshMembership();
      return channel;
    },
    [chat, workspaceId, refreshMembership],
  );

  const join = useCallback(
    async (channelId: string) => {
      if (!chat) return;
      try {
        const member = await chat.join(channelId);
        setState((prev) => ({ ...prev, mine: { ...prev.mine, [channelId]: member } }));
      } catch (err) {
        toast(errorText(err, "Couldn't join the channel."));
      }
    },
    [chat],
  );

  const leave = useCallback(
    async (channelId: string) => {
      if (!chat) return;
      try {
        await chat.leave(channelId);
        setState((prev) => {
          const mine = { ...prev.mine };
          delete mine[channelId];
          return { ...prev, mine };
        });
        dispatchChatReadChanged();
      } catch (err) {
        toast(errorText(err, "Couldn't leave the channel."));
      }
    },
    [chat],
  );

  const updateChannel = useCallback(
    async (channelId: string, patch: { name?: string; topic?: string }) => {
      if (!chat) return;
      try {
        const channel = await chat.updateChannel({ channelId, ...patch });
        setState((prev) => ({ ...prev, channels: { ...prev.channels, [channel.id]: channel } }));
      } catch (err) {
        toast(errorText(err, "Couldn't update the channel."));
        throw err;
      }
    },
    [chat],
  );

  const archiveChannel = useCallback(
    async (channelId: string, archived: boolean) => {
      if (!chat) return;
      try {
        const channel = await chat.archiveChannel({ channelId, archived });
        setState((prev) => ({ ...prev, channels: { ...prev.channels, [channel.id]: channel } }));
        dispatchChatReadChanged();
      } catch (err) {
        toast(errorText(err, "Couldn't archive the channel."));
      }
    },
    [chat],
  );

  const setPrefs = useCallback(
    async (channelId: string, prefs: { notifyLevel?: ChatNotifyLevel; starred?: boolean }) => {
      if (!chat) return;
      const before = stateRef.current.mine[channelId];
      if (!before) return;
      setState((prev) => ({
        ...prev,
        mine: { ...prev.mine, [channelId]: { ...before, ...prefs } },
      }));
      try {
        const member = await chat.setPrefs({ channelId, ...prefs });
        setState((prev) => ({ ...prev, mine: { ...prev.mine, [channelId]: member } }));
        dispatchChatReadChanged();
      } catch (err) {
        setState((prev) => ({ ...prev, mine: { ...prev.mine, [channelId]: before } }));
        toast(errorText(err, "Couldn't save that setting."));
      }
    },
    [chat],
  );

  const addMembers = useCallback(
    async (channelId: string, userIds: string[]) => {
      if (!chat) return 0;
      try {
        const n = await chat.addMembers({ channelId, userIds });
        toast(n === 1 ? "Added 1 person" : `Added ${n} people`);
        return n;
      } catch (err) {
        toast(errorText(err, "Couldn't add people."));
        return 0;
      }
    },
    [chat],
  );

  const removeMember = useCallback(
    async (channelId: string, memberId: string) => {
      if (!chat) return;
      try {
        await chat.removeMember({ channelId, userId: memberId });
      } catch (err) {
        toast(errorText(err, "Couldn't remove that person."));
      }
    },
    [chat],
  );

  const actions = useMemo(
    () => ({
      send,
      retry,
      edit,
      remove,
      react,
      pin,
      markUnread,
      loadOlder,
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
      reload: resync,
    }),
    [
      send,
      retry,
      edit,
      remove,
      react,
      pin,
      markUnread,
      loadOlder,
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
      resync,
    ],
  );

  return { state, link, actions };
}

export type ChatModule = ReturnType<typeof useChatModule>;
export type ChatActions = ChatModule["actions"];
