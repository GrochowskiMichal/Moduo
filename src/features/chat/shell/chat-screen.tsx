// Chat's screen (specs/chat-v2.md §2–§3, §12, prototype frames 1, 3–7), on
// the v2 store (CV-3). Three panels, nothing else (Tasks 48b): left =
// conversations, centre = the open conversation (or Browse channels), right =
// the panel's views (Details, Reply chains; Files with CV-9) with its
// "← item" stack (a person, a message in context, a reply chain). The page
// (`routes/pages/chat-page.tsx`) is a thin adapter for `/chat?c=&m=&t=&view=`.
//
// Page-level keys: ⌥↑ / ⌥↓ previous / next conversation, ⌥⇧↑ / ⌥⇧↓ previous /
// next unread one.

import type { WorkspaceRole } from "@contracts/vocabularies";
import { CornerUpLeft, Loader2, MessageSquareText, MessagesSquare, User, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { onCreateNew } from "@/components/app/create-events";
import { FeaturePanelsShell } from "@/components/app/feature-panels-shell";
import { dispatchOpenPalette } from "@/components/app/global-command-palette";
import { type PanelItem, RightPanel, usePanelStack } from "@/components/app/right-panel";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { dispatchLayoutPanelsSet, readFeaturePanelState } from "@/features/layout/panel-events";
import { dispatchOpenSettings } from "@/features/settings/settings-events";
import { dispatchOpenCapture } from "@/lib/capture-open";
import type { ModuoRuntime } from "@/lib/runtime.types";
import {
  type ChainRights,
  chainGroups,
  chainsStamp,
  excerptOf,
  mayAttach,
  mayWrap,
  replyToChoices,
} from "../chains";
import { ChatComposer, type ChatComposerHandle } from "../composer/chat-composer";
import { CHANNEL_REFUSED_COPY } from "../composer/grammar";
import { ReplyToDialog, WrapUpDialog } from "../dialogs/chain-dialogs";
import { NewConversationDialog } from "../dialogs/new-conversation-dialog";
import { mentionsOf, messageTree, parseStored, toBodyText } from "../markup-v2";
import type { ChatMessage, ChatNotifyLevel, ChatPerson } from "../model";
import { ChainItem } from "../panel/chain-item";
import { detailsStamp } from "../panel/details-model";
import { DetailsView } from "../panel/details-view";
import { MessageInContext } from "../panel/message-in-context";
import { PersonCard } from "../panel/person-card";
import { ReplyChainsView } from "../panel/reply-chains-view";
import { useConversationDetails } from "../panel/use-conversation-details";
import { useReplyChains } from "../panel/use-reply-chains";
import {
  chatTypingStore,
  useChatPresence,
  useChatSnapshot,
  useChatStore,
  useChatTypingSnapshot,
} from "../store/react";
import type { ChatWindow, ChatWriteResult } from "../store/store";
import { MessageStream, type MessageStreamHandle } from "../stream/message-stream";
import { authorName } from "../stream/rows";
import { readThroughHidden, wrappedReplyIds } from "../timeline";
import { BrowseChannels } from "./browse-channels";
import { ChatSidebar, useCollapsedSections } from "./chat-sidebar";
import { composerLine } from "./composer-state";
import { ComposerLineView, ConversationStart, OfflineLine } from "./conversation-states";
import { ConversationToolbar } from "./conversation-toolbar";
import { buildChatSidebar, conversationTitle, dmPeople, sidebarOrder } from "./sidebar-model";
import { useChannelManagers, useChatRights } from "./use-chat-rights";

/** "Deleted · Undo" stays this long; then the server deletes (§6 #10). */
const DELETE_UNDO_MS = 8000;
/** "Wrapped up · Undo" stays this long (§5). */
const WRAP_UNDO_MS = 8000;

const EMPTY_WINDOW: ChatWindow = {
  rows: [],
  hasOlder: false,
  hasNewer: false,
  loading: true,
  loaded: false,
  newAfter: null,
  target: null,
};

/** Someone in the workspace, as the composer's @ and the names read them. */
export type ChatScreenPerson = ChatPerson;

/** What the right panel's "← item" stack holds (spec #10): items, not views. */
type ChatPanelEntry =
  | { key: string; type: "person"; id: string }
  | { key: string; type: "message"; id: string; channelId: string; author: string }
  | { key: string; type: "chain"; id: string };

function typingLine(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return "Several people are typing…";
}

function webOrigin(): string {
  const configured = (import.meta.env.PUBLIC_WEB_ORIGIN as string | undefined)?.replace(/\/+$/, "");
  return configured || window.location.origin;
}

function failed(res: ChatWriteResult, fallback: string): boolean {
  if (res.ok) return false;
  toast(res.offline ? "Offline" : res.message || fallback);
  return true;
}

const errorText = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

export type ChatScreenProps = {
  runtime: ModuoRuntime | null;
  userId: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  role: WorkspaceRole | null;
  /** Chat is view-only for your role. */
  readOnly: boolean;
  /** Everyone in the workspace (the composer's @, names of people not in chat yet). */
  members: readonly ChatPerson[];
  /** The owner's name, for the paused line. */
  ownerName: string | null;
  /** The conversation the link names (`c`). */
  conversationId: string | null;
  /** A message the link names (`m`): the stream lands on it. */
  messageId: string | null;
  /** A reply chain the link names (`t`): it opens on the right (CV-12). */
  chainId?: string | null;
  /** The centre shows Browse channels (`view=browse`). */
  browsing?: boolean;
  /** Open Browse channels. */
  onBrowse?: () => void;
  /** Open a conversation (null: none named, so Chat lands on General). */
  onOpen: (
    conversationId: string | null,
    /** `chainId`: a reply chain's root (the link's `t`: it opens on the right). */
    opts?: { messageId?: string; chainId?: string; replace?: boolean },
  ) => void;
};

export function ChatScreen({
  runtime,
  userId,
  workspaceId,
  workspaceName,
  role,
  readOnly,
  members,
  ownerName,
  conversationId,
  messageId,
  chainId = null,
  browsing = false,
  onOpen,
  onBrowse,
}: ChatScreenProps) {
  const selfId = userId ?? "";
  const store = useChatStore(runtime, userId, workspaceId);
  const snap = useChatSnapshot(store);
  const ready = snap.status === "ready";
  const presence = useChatPresence(workspaceId, userId, ready && !snap.paused);
  const typingStore = useMemo(
    () => (runtime && userId ? chatTypingStore(runtime, userId) : null),
    [runtime, userId],
  );
  const typing = useChatTypingSnapshot(typingStore);
  const rights = useChatRights(workspaceId, role, readOnly);

  // ── people ────────────────────────────────────────────────────────────────
  const peopleById = useMemo(() => {
    const out: Record<string, ChatPerson> = {};
    for (const p of members) out[p.userId] = p;
    for (const p of Object.values(snap.people)) out[p.userId] = { ...out[p.userId], ...p };
    return out;
  }, [members, snap.people]);
  const personOf = useCallback((id: string) => peopleById[id], [peopleById]);
  const people = useMemo(
    () =>
      Object.values(peopleById)
        .filter((p) => !p.former)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [peopleById],
  );
  const online = useCallback((id: string) => presence.online.has(id), [presence.online]);

  // ── the left panel ────────────────────────────────────────────────────────
  const model = useMemo(
    () =>
      buildChatSidebar({
        channels: snap.channels,
        mine: snap.mine,
        unread: snap.unread,
        selfId,
        personOf,
      }),
    [snap.channels, snap.mine, snap.unread, selfId, personOf],
  );
  const [collapsed, toggleSection] = useCollapsedSections();
  const ordered = useMemo(() => sidebarOrder(model, collapsed), [model, collapsed]);

  const channel = conversationId ? snap.channels[conversationId] : undefined;
  const member = conversationId ? snap.mine[conversationId] : undefined;
  const streamWin = conversationId ? snap.windows[conversationId] : undefined;
  const managers = useChannelManagers(channel?.id ?? null, channel?.kind ?? null);
  const canManage = !!channel && (rights.manageAny || (managers ?? []).includes(selfId));
  // An announcement channel's line waits for its managers (a manager never sees "Only managers post").
  const managersPending = managers === null && !!channel?.managersOnly && !rights.manageAny;

  // ── landing ───────────────────────────────────────────────────────────────
  // No conversation named: General (or the first one in the panel).
  useEffect(() => {
    if (!ready || conversationId || browsing) return;
    const general = Object.values(snap.channels).find((c) => c.isDefault && !c.archivedAt);
    const first = general ?? ordered[0]?.channel;
    if (first) onOpen(first.id, { replace: true });
  }, [ready, conversationId, browsing, snap.channels, ordered, onOpen]);

  // Open once per conversation (re-opening would drop a window around a linked message).
  const known = !!conversationId && !!snap.channels[conversationId];
  useEffect(() => {
    if (store && ready && conversationId && known) void store.open(conversationId);
  }, [store, ready, conversationId, known]);

  // Leaving Chat closes the open conversation, so coming back counts as a return (the "New" pill).
  useEffect(() => () => store?.close(), [store]);

  // A message named by the link that isn't in the window: load the window around it.
  const landed = useRef<string | null>(null);
  useEffect(() => {
    if (!store || !ready || !conversationId || !messageId || !streamWin?.loaded) return;
    if (landed.current === messageId) return;
    landed.current = messageId;
    if (streamWin.rows.some((m) => m.id === messageId)) return;
    void store.openAt(conversationId, messageId).then((at) => {
      if (!at) toast("That message isn't available.");
    });
  }, [store, ready, conversationId, messageId, streamWin]);

  // Who's typing: join the open conversation's topic only as a member (CV-1).
  useEffect(() => {
    if (!typingStore || !ready || !conversationId || !member) return;
    return typingStore.watch(conversationId);
  }, [typingStore, ready, conversationId, member]);

  // ── the right panel (CV-8b) ───────────────────────────────────────────────
  const [panelView, setPanelView] = useState("details");
  const panelStack = usePanelStack<ChatPanelEntry>();
  const clearPanelItems = panelStack.clear;
  // Another conversation: its own panel, from its view (items belong to the last one).
  // biome-ignore lint/correctness/useExhaustiveDependencies: a switch of conversation is the trigger
  useEffect(() => clearPanelItems(), [conversationId]);
  const pushPanelItem = panelStack.push;
  const openInPanel = useCallback(
    (entry: ChatPanelEntry) => {
      pushPanelItem(entry);
      const state = readFeaturePanelState("chat");
      if (!state.right) dispatchLayoutPanelsSet({ feature: "chat", left: state.left, right: true });
    },
    [pushPanelItem],
  );
  const openPerson = useCallback(
    (id: string) => openInPanel({ key: `person:${id}`, type: "person", id }),
    [openInPanel],
  );
  const openMessageInPanel = useCallback(
    (m: ChatMessage) =>
      openInPanel({
        key: `message:${m.id}`,
        type: "message",
        id: m.id,
        channelId: m.channelId,
        author: authorName(m, m.authorId ? personOf(m.authorId) : undefined),
      }),
    [openInPanel, personOf],
  );
  const openChain = useCallback(
    (rootId: string) => openInPanel({ key: `chain:${rootId}`, type: "chain", id: rootId }),
    [openInPanel],
  );
  const loadChain = useCallback((rootId: string) => void store?.openChain(rootId), [store]);
  const rowById = useCallback((id: string) => store?.rowById(id), [store]);
  // A link's chain (`t`) opens on the right once the conversation is there.
  const openedChain = useRef<string | null>(null);
  useEffect(() => {
    // The link let go of its chain: the same `t` opens it again later.
    if (!chainId) openedChain.current = null;
    if (!ready || !known || !chainId || openedChain.current === chainId) return;
    openedChain.current = chainId;
    openChain(chainId);
    // Let go of `t` once it's open, so the next link to this chain opens it again.
    if (conversationId)
      onOpen(conversationId, { messageId: messageId ?? undefined, replace: true });
  }, [ready, known, chainId, openChain, conversationId, messageId, onOpen]);
  const chainRoots = useReplyChains(
    runtime?.chat ?? null,
    channel?.id ?? null,
    chainsStamp(streamWin?.rows),
    rowById,
  );
  const chainList = useMemo(() => {
    if (!chainRoots) return null;
    const held = new Map<string, ChatMessage[]>();
    for (const m of streamWin?.rows ?? []) {
      if (!m.parentId) continue;
      const list = held.get(m.parentId) ?? [];
      list.push(m);
      held.set(m.parentId, list);
    }
    return chainGroups(chainRoots, {
      selfId,
      lastReadAt: member?.lastReadAt ?? null,
      repliesOf: (id) => held.get(id) ?? [],
    });
  }, [chainRoots, streamWin?.rows, selfId, member?.lastReadAt]);
  const details = useConversationDetails(
    runtime?.chat ?? null,
    workspaceId,
    channel?.id ?? null,
    [
      channel?.name,
      channel?.topic,
      channel?.archivedAt,
      channel?.isPrivate,
      channel?.managersOnly,
      member ? member.joinedAt : "-",
      detailsStamp(streamWin?.rows),
    ].join("|"),
  );

  // ── New conversation (⌘N, the bottom bar's +, the left panel's row) ───────
  const [newOpen, setNewOpen] = useState(false);
  const canStart = rights.canPost && !snap.paused;
  useEffect(
    () =>
      onCreateNew(() => {
        if (canStart) setNewOpen(true);
      }),
    [canStart],
  );

  // ── keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (document.querySelector("[role='dialog'], [role='menu']")) return;
      const list = e.shiftKey
        ? ordered.filter((r) => r.unread || r.channel.id === conversationId)
        : ordered;
      if (list.length === 0) return;
      e.preventDefault();
      const i = list.findIndex((r) => r.channel.id === conversationId);
      const d = e.key === "ArrowDown" ? 1 : -1;
      const next = list[(i + d + list.length) % list.length];
      if (next) onOpen(next.channel.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ordered, conversationId, onOpen]);

  // ── writes ────────────────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a switch of conversation is the trigger
  useEffect(() => setEditingId(null), [conversationId]);

  const streamRef = useRef<MessageStreamHandle | null>(null);
  const composerRef = useRef<ChatComposerHandle | null>(null);
  const returnToComposer = useCallback((typed?: string) => {
    if (typed) composerRef.current?.insertText(typed);
    else composerRef.current?.focus();
  }, []);

  /** ↑ in an empty composer edits your last message; with none, it steps into the stream. */
  const editLast = useCallback(
    (items: ChatMessage[], skip: ReadonlySet<string>) => {
      const mine = [...items]
        .reverse()
        .find(
          (m) =>
            !skip.has(m.id) &&
            m.authorId === selfId &&
            m.kind !== "event" &&
            !m.deletedAt &&
            !m.sendState,
        );
      if (mine) setEditingId(mine.id);
      else streamRef.current?.focusLast();
    },
    [selfId],
  );

  // `@channel` from a role that may not mention everyone is sent as text; the
  // server decides (CV-2a) and the composer says so once the message is back.
  const [channelNote, setChannelNote] = useState<{ id: string; note: string | null } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a switch of conversation is the trigger
  useEffect(() => setChannelNote(null), [conversationId]);
  useEffect(() => {
    if (!channelNote || channelNote.note) return;
    const row = store?.rowById(channelNote.id);
    if (row && !row.mentionsEveryone)
      setChannelNote({ ...channelNote, note: CHANNEL_REFUSED_COPY });
    else if (row) setChannelNote(null);
  });

  // Delete hides the message at once with "Deleted · Undo" for 8 s, no
  // confirm (§6 #10); the server deletes it when the toast's time is up.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const pendingDeletes = useRef(new Map<string, ChatMessage>());
  const unhide = useCallback((id: string) => {
    setHidden((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);
  const commitDelete = useCallback(
    (id: string) => {
      const message = pendingDeletes.current.get(id);
      if (!message || !store) return;
      pendingDeletes.current.delete(id);
      toast.dismiss(`chat-delete-${id}`);
      void store
        .remove(message.id)
        .then((res) => failed(res, "Couldn't delete the message."))
        .finally(() => unhide(id));
    },
    [store, unhide],
  );
  const commitRef = useRef(commitDelete);
  commitRef.current = commitDelete;
  // Leaving the page (or Chat) sends the deletes still waiting for their time.
  useEffect(() => {
    const flush = () => {
      for (const id of [...pendingDeletes.current.keys()]) commitRef.current(id);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
  const deleteWithUndo = useCallback(
    (m: ChatMessage) => {
      if (m.sendState) {
        store?.discard(m.id);
        return;
      }
      if (pendingDeletes.current.has(m.id)) return;
      setHidden((prev) => new Set(prev).add(m.id));
      pendingDeletes.current.set(m.id, m);
      toast("Deleted", {
        id: `chat-delete-${m.id}`,
        duration: DELETE_UNDO_MS,
        onAutoClose: () => commitRef.current(m.id),
        onDismiss: () => commitRef.current(m.id),
        action: {
          label: "Undo",
          onClick: () => {
            pendingDeletes.current.delete(m.id);
            unhide(m.id);
          },
        },
      });
    },
    [store, unhide],
  );

  // Wrapped-up chains: their replies leave the stream (a drawing rule, CV-12),
  // on the same path as the deletes inside their Undo.
  const streamHidden = useMemo(
    () => wrappedReplyIds(streamWin?.rows ?? [], rowById, hidden),
    [streamWin?.rows, rowById, hidden],
  );

  // Reply (R, the toolbar): the main box answers a message ("Replying to …").
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a switch of conversation is the trigger
  useEffect(() => setReplyingTo(null), [conversationId]);

  // Wrap up ("Which reply settled it?") and Reply to… (CV-12).
  const [wrapFor, setWrapFor] = useState<string | null>(null);
  const [attachFor, setAttachFor] = useState<ChatMessage | null>(null);
  const askWrapUp = useCallback(
    (rootId: string) => {
      void store?.openChain(rootId);
      setWrapFor(rootId);
    },
    [store],
  );
  const wrapUp = useCallback(
    (rootId: string, settledId: string) => {
      if (!store) return;
      setWrapFor(null);
      void store.wrapUp(rootId, settledId).then((res) => {
        if (failed(res, "Couldn't wrap it up.")) return;
        toast("Wrapped up", {
          id: `chat-wrap-${rootId}`,
          duration: WRAP_UNDO_MS,
          action: {
            label: "Undo",
            onClick: () =>
              void store.reopen(rootId).then((r) => failed(r, "Couldn't undo the wrap-up.")),
          },
        });
      });
    },
    [store],
  );
  const reopen = useCallback(
    (rootId: string) =>
      void store?.reopen(rootId).then((res) => {
        if (!failed(res, "Couldn't reopen it.")) toast("Reopened");
      }),
    [store],
  );

  // T / "Make a task": the app's capture opens as Task with the message's words (AC2.7).
  const makeTaskFrom = useCallback((m: ChatMessage) => {
    const text = toBodyText(messageTree(m.id, m.updatedAt, m.body))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    dispatchOpenCapture({ type: "task", draft: text });
  }, []);

  const copyLink = useCallback((m: ChatMessage) => {
    const params = new URLSearchParams({ c: m.channelId, m: m.id });
    void navigator.clipboard
      ?.writeText(`${webOrigin()}/chat?${params.toString()}`)
      .then(() => toast("Link copied"))
      .catch(() => toast("Couldn't copy the link."));
  }, []);

  const openDmWith = useCallback(
    (ids: string[]) => {
      const others = ids.filter((id) => id !== selfId).slice(0, 8);
      if (!store || others.length === 0) return;
      void store
        .openDm(others)
        .then((c) => onOpen(c.id))
        .catch((err: unknown) => toast(errorText(err, "Couldn't open the conversation.")));
    },
    [store, selfId, onOpen],
  );

  const markRead = useCallback(() => {
    if (!store || !conversationId) return;
    const rows = store.getSnapshot().windows[conversationId]?.rows ?? [];
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const m = rows[i];
      if (!m || m.sendState) continue;
      store.markSeen(conversationId, m.id);
      return;
    }
  }, [store, conversationId]);

  const guarded = useCallback(
    (run: () => Promise<unknown>, fallback: string) =>
      void run().catch((err: unknown) => toast(errorText(err, fallback))),
    [],
  );

  // ── render: before the store answers ──────────────────────────────────────
  if (!workspaceId || snap.status === "idle" || snap.status === "loading") {
    return (
      <FeaturePanelsShell
        feature="chat"
        hideRight
        center={
          <div className="grid h-full place-items-center text-muted-foreground">
            <Loader2 className="size-icon animate-spin" aria-label="Loading chat" />
          </div>
        }
      />
    );
  }
  if (snap.status === "error") {
    return (
      <FeaturePanelsShell
        feature="chat"
        hideRight
        center={
          <EmptyState
            icon={MessagesSquare}
            title="Chat couldn't load"
            description={snap.error ?? "Check your connection and try again."}
            action={
              <Button size="sm" onClick={() => void store?.sync("manual")}>
                Try again
              </Button>
            }
          />
        }
      />
    );
  }

  const left = (
    <ChatSidebar
      model={model}
      activeId={browsing ? null : conversationId}
      personOf={personOf}
      online={online}
      collapsed={collapsed}
      onToggleSection={toggleSection}
      onOpen={(id) => onOpen(id)}
      onNewConversation={canStart ? () => setNewOpen(true) : undefined}
      onBrowse={onBrowse}
      onOpenCatchup={() => {
        // Catch up's own view is CV-11's: until then, the first conversation waiting for you.
        const all = [...model.pinned, ...model.channels, ...model.dms];
        const waiting = all.find((r) => r.count > 0) ?? all.find((r) => r.unread);
        if (waiting) onOpen(waiting.channel.id);
      }}
    />
  );

  // Who may wrap up and Reply to… (a mirror of the ops' rules; the server decides).
  // Role, plan and archive decide. "Manage any channel" works from outside a public
  // channel; a listed manager manages only while a member (the server's rule).
  // The chain's own box still needs the main box's rule.
  const chainManage =
    !!channel && (rights.manageAny || (!!member && (managers ?? []).includes(selfId)));
  const chainRights: ChainRights = {
    canPost: rights.canPost && (!channel?.managersOnly || chainManage),
    paused: snap.paused,
    canManage: chainManage,
    selfId,
  };
  // The box's line (why you can't write here, if you can't): one rule for both boxes.
  const composerRefusal = channel
    ? composerLine({
        channel,
        member,
        selfId,
        personOf,
        paused: snap.paused,
        isOwner: role === "owner",
        ownerName,
        canPost: rights.canPost,
        canManage,
      })
    : null;
  const canWriteHere = !!channel && composerRefusal === null && !managersPending;
  const canWrapUp = (root: ChatMessage) => !!channel && mayWrap(root, channel, chainRights);

  let center: React.ReactNode;
  if (browsing) {
    center = (
      <BrowseChannels
        chat={runtime?.chat ?? null}
        channels={snap.channels}
        mine={snap.mine}
        canJoin={!snap.paused}
        onNewChannel={
          canStart && (rights.createPublic || rights.createPrivate)
            ? () => setNewOpen(true)
            : undefined
        }
        onOpen={(id) => onOpen(id)}
        onJoin={async (id) => {
          try {
            await store?.join(id);
            onOpen(id);
          } catch (err) {
            toast(errorText(err, "Couldn't join the channel."));
          }
        }}
      />
    );
  } else if (!channel && conversationId && snap.fromDevice) {
    // The device copy may not hold a newer conversation yet: wait for the server.
    center = (
      <div className="grid h-full place-items-center text-muted-foreground">
        <Loader2 className="size-icon animate-spin" aria-label="Loading chat" />
      </div>
    );
  } else if (!channel) {
    // A link to a conversation this workspace doesn't hold: say so, don't bounce
    // (a notice from another workspace switches there; CV-6b's landing).
    center = conversationId ? (
      <EmptyState
        icon={MessagesSquare}
        title="That conversation isn't available"
        description="It may have been deleted, or you're not in it."
      />
    ) : (
      <EmptyState
        icon={MessagesSquare}
        title="No conversation open"
        description="Pick a conversation on the left."
      />
    );
  } else {
    const title = conversationTitle(channel, selfId, personOf);
    const others = channel.kind === "dm" ? dmPeople(channel, selfId) : [];
    const line = composerRefusal;
    const canWrite = canWriteHere;
    const typingNames = typing.entries
      .filter((t) => t.channelId === channel.id && t.parentId === null && t.userId !== selfId)
      .map((t) => personOf(t.userId)?.name ?? "Someone");
    const peopleCount =
      channel.kind === "dm"
        ? others.length + 1
        : (details.members?.length ?? (channel.isDefault ? members.length || null : null));
    center = (
      <div className="flex h-full min-h-0 flex-col" data-conversation={channel.id}>
        <ConversationToolbar
          row={{ channel, people: others, title }}
          member={member}
          personOf={personOf}
          online={online}
          peopleCount={peopleCount}
          canManage={canManage}
          paused={snap.paused}
          onSearch={() => dispatchOpenPalette()}
          onPin={(starred) =>
            guarded(
              () => store?.setPrefs(channel.id, { starred }) ?? Promise.resolve(),
              "Couldn't pin it.",
            )
          }
          onNotify={(notifyLevel: ChatNotifyLevel) =>
            guarded(
              () => store?.setPrefs(channel.id, { notifyLevel }) ?? Promise.resolve(),
              "Couldn't save that setting.",
            )
          }
          onMarkRead={markRead}
          onLeave={() =>
            guarded(async () => {
              await store?.leave(channel.id);
              onOpen(null, { replace: true });
            }, "Couldn't leave the channel.")
          }
          onArchive={(archived) =>
            guarded(
              () => store?.archiveChannel(channel.id, archived) ?? Promise.resolve(),
              "Couldn't archive the channel.",
            )
          }
        />
        <MessageStream
          key={channel.id}
          ref={streamRef}
          conversationId={channel.id}
          window={streamWin ?? EMPTY_WINDOW}
          selfId={selfId}
          personOf={personOf}
          rowById={rowById}
          hidden={streamHidden}
          editingId={editingId}
          canWrite={canWrite}
          // Readers keep the message tools (AC10.9, §1 paused); the server decides each.
          canUseTools={!channel.archivedAt}
          intro={
            <ConversationStart
              channel={channel}
              title={title}
              people={others}
              personOf={personOf}
              workspaceName={workspaceName}
            />
          }
          onLoadOlder={() => void store?.loadOlder(channel.id)}
          onLoadNewer={() => void store?.loadNewer(channel.id)}
          onJumpToLatest={() => void store?.jumpToLatest(channel.id)}
          onSeen={(id) =>
            store?.markSeen(channel.id, readThroughHidden(streamWin?.rows ?? [], id, streamHidden))
          }
          onStartEdit={(m) => setEditingId(m.id)}
          renderEditor={(m) => (
            <ChatComposer
              mode="edit"
              className="mt-0.5"
              runtime={runtime}
              workspaceId={workspaceId}
              selfId={selfId}
              people={people}
              placeholder="Edit message"
              initial={m.body}
              autoFocus
              onCancel={() => {
                setEditingId(null);
                returnToComposer();
              }}
              onSend={(body) => {
                setEditingId(null);
                returnToComposer();
                void store?.edit(m.id, body, "v2").then((res) => {
                  if (!res.ok) toast(res.offline ? "Offline" : res.message);
                });
              }}
            />
          )}
          onDelete={deleteWithUndo}
          onReact={(m, key, on) => {
            if (!store || m.sendState) return;
            void store
              .react(m.id, key, on)
              .then((res) => failed(res, "Couldn't add the reaction."));
          }}
          onPin={(m) => {
            if (!store) return;
            const pinned = !m.pinnedAt;
            void store.pin(m.id, pinned).then((res) => {
              if (!failed(res, "Couldn't update the pin.")) {
                toast(pinned ? "Pinned to the conversation" : "Unpinned");
              }
            });
          }}
          onTask={makeTaskFrom}
          onCopyLink={copyLink}
          onMarkUnread={(m) => {
            void store
              ?.markUnread(m.channelId, m.id)
              .then((res) => failed(res, "Couldn't mark as unread."));
          }}
          onOpenChain={(m) => openChain(m.parentId ?? m.id)}
          onReply={(m) => {
            if (!canWrite) {
              openChain(m.parentId ?? m.id);
              return;
            }
            setReplyingTo(m);
            composerRef.current?.focus();
          }}
          onJumpTo={(m) => {
            // A reply of a wrapped chain isn't drawn: its chain opens instead.
            if (streamHidden.has(m.id)) {
              openChain(m.parentId ?? m.id);
              return;
            }
            if (streamRef.current?.jumpTo(m.id)) return;
            void store?.openAt(m.channelId, m.id).then((at) => {
              if (!at) toast("That message isn't available.");
            });
          }}
          wrapUpFor={(m) =>
            !m.parentId && m.replyCount > 0 && !m.wrappedAt && canWrapUp(m)
              ? () => askWrapUp(m.id)
              : undefined
          }
          replyToFor={(m) =>
            mayAttach(m, channel, chainRights) ? () => setAttachFor(m) : undefined
          }
          onRetry={(m) => store?.retry(m.id)}
          onDiscard={(m) => store?.discard(m.id)}
          onPersonClick={openPerson}
          personPreview={(id) => (
            <PersonCard
              compact
              userId={id}
              person={personOf(id)}
              self={id === selfId}
              online={id === selfId || online(id)}
              canMessage={canStart}
              onMessage={(uid) => openDmWith([uid])}
            />
          )}
          onReturnToComposer={returnToComposer}
        />
        <div data-chat-composer className="shrink-0 px-3 pb-3">
          {snap.offline ? <OfflineLine /> : null}
          {managersPending ? null : line ? (
            <ComposerLineView
              line={line}
              onUnarchive={() =>
                guarded(
                  () => store?.archiveChannel(channel.id, false) ?? Promise.resolve(),
                  "Couldn't unarchive the channel.",
                )
              }
              onChoosePlan={() => dispatchOpenSettings({ section: "billing" })}
              onReplyPrivately={
                managers?.some((id) => id !== selfId) ? () => openDmWith(managers) : undefined
              }
              onJoin={() =>
                guarded(
                  () => store?.join(channel.id) ?? Promise.resolve(),
                  "Couldn't join the channel.",
                )
              }
            />
          ) : (
            <>
              <p
                className="h-5 truncate px-3 pt-0.5 text-xs text-muted-foreground"
                aria-live="polite"
              >
                {typingLine(typingNames)}
              </p>
              {replyingTo ? (
                <div
                  data-slot="replying-to"
                  className="flex h-(--row-h-sm) min-w-0 items-center gap-2 px-3 text-xs text-muted-foreground"
                >
                  <CornerUpLeft aria-hidden className="size-icon-xs shrink-0" />
                  <span className="shrink-0">
                    Replying to{" "}
                    <b className="font-medium text-foreground">
                      {authorName(
                        replyingTo,
                        replyingTo.authorId ? personOf(replyingTo.authorId) : undefined,
                      )}
                    </b>
                  </span>
                  <span className="min-w-0 flex-1 truncate">· {excerptOf(replyingTo)}</span>
                  <button
                    type="button"
                    aria-label="Cancel reply"
                    className="shrink-0 rounded-sm p-0.5 hover:bg-state-hover hover:text-foreground"
                    onClick={() => {
                      setReplyingTo(null);
                      returnToComposer();
                    }}
                  >
                    <X aria-hidden className="size-icon-xs" />
                  </button>
                </div>
              ) : null}
              <ChatComposer
                key={channel.id}
                ref={composerRef}
                runtime={runtime}
                workspaceId={workspaceId}
                selfId={selfId}
                people={people}
                placeholder={`Message ${title}`}
                initial={store?.draft(channel.id) ?? ""}
                autoFocus
                note={channelNote?.note ?? null}
                onSend={(body) => {
                  if (!store || !body.trim()) return false;
                  const replyRoot = replyingTo ? (replyingTo.parentId ?? replyingTo.id) : null;
                  const id = store.send({
                    channelId: channel.id,
                    body,
                    replyToId: replyingTo?.id ?? null,
                    format: "v2",
                  });
                  setReplyingTo(null);
                  typingStore?.send(channel.id, replyRoot, true);
                  setChannelNote(mentionsOf(parseStored(body)).channel ? { id, note: null } : null);
                  streamRef.current?.showLatest();
                  return true;
                }}
                onDraftChange={(stored) => store?.setDraft(channel.id, null, stored)}
                onTyping={(active) =>
                  typingStore?.send(
                    channel.id,
                    replyingTo ? (replyingTo.parentId ?? replyingTo.id) : null,
                    !active,
                  )
                }
                onEditLast={() =>
                  editLast(
                    // The row past the window's edge isn't drawn; ids inside their Undo are gone.
                    (streamWin?.hasOlder ? streamWin.rows.slice(1) : streamWin?.rows) ?? [],
                    streamHidden,
                  )
                }
                onEscapeEmpty={() => {
                  // Esc first lets go of the reply, then steps into the stream.
                  if (replyingTo) setReplyingTo(null);
                  else streamRef.current?.focusLast();
                }}
              />
            </>
          )}
        </div>
      </div>
    );
  }

  // ── the right panel ───────────────────────────────────────────────────────
  const items: PanelItem[] = panelStack.stack.map((entry) => {
    if (entry.type === "person") {
      const person = personOf(entry.id);
      return {
        key: entry.key,
        title: person?.name ?? "Former member",
        icon: User,
        render: () => (
          <PersonCard
            userId={entry.id}
            person={person}
            self={entry.id === selfId}
            online={entry.id === selfId || online(entry.id)}
            canMessage={canStart}
            onMessage={(uid) => openDmWith([uid])}
          />
        ),
      };
    }
    if (entry.type === "chain") {
      const chain = snap.chains[entry.id];
      const root = chain?.root;
      return {
        key: entry.key,
        title: "Reply chain",
        icon: MessagesSquare,
        render: () => (
          <ChainItem
            chat={runtime?.chat ?? null}
            rootId={entry.id}
            chain={chain}
            selfId={selfId}
            personOf={personOf}
            onLoad={loadChain}
            onPersonClick={openPerson}
            onWrapUp={root && canWrapUp(root) ? () => askWrapUp(entry.id) : undefined}
            onReopen={root && canWrapUp(root) ? () => reopen(entry.id) : undefined}
            renderComposer={
              channel && canWriteHere && root?.channelId === channel.id
                ? (placeholder) => (
                    <ChatComposer
                      key={`chain:${entry.id}`}
                      runtime={runtime}
                      workspaceId={workspaceId}
                      selfId={selfId}
                      people={people}
                      placeholder={placeholder}
                      initial={store?.draft(channel.id, entry.id) ?? ""}
                      onSend={(body) => {
                        if (!store || !body.trim()) return false;
                        store.send({
                          channelId: channel.id,
                          body,
                          replyToId: entry.id,
                          format: "v2",
                        });
                        typingStore?.send(channel.id, entry.id, true);
                        return true;
                      }}
                      onDraftChange={(stored) => store?.setDraft(channel.id, entry.id, stored)}
                      onTyping={(active) => typingStore?.send(channel.id, entry.id, !active)}
                      onEscapeEmpty={panelStack.back}
                    />
                  )
                : undefined
            }
          />
        ),
      };
    }
    return {
      key: entry.key,
      title: `Message from ${entry.author}`,
      icon: MessageSquareText,
      open: {
        label: "Open in conversation",
        onOpen: () => {
          panelStack.clear();
          onOpen(entry.channelId, { messageId: entry.id });
        },
      },
      render: () => (
        <MessageInContext
          chat={runtime?.chat ?? null}
          messageId={entry.id}
          selfId={selfId}
          personOf={personOf}
          onPersonClick={openPerson}
        />
      ),
    };
  });
  const right = channel ? (
    <RightPanel
      module="chat"
      views={{
        details: () => (
          <DetailsView
            channel={channel}
            member={member ?? null}
            selfId={selfId}
            personOf={personOf}
            online={online}
            members={details.members}
            pinned={details.pinned}
            history={details.history}
            canArchive={
              channel.kind === "channel" &&
              canManage &&
              !snap.paused &&
              (!channel.isDefault || !!channel.archivedAt)
            }
            onNotify={(notifyLevel) =>
              guarded(
                () => store?.setPrefs(channel.id, { notifyLevel }) ?? Promise.resolve(),
                "Couldn't save that setting.",
              )
            }
            onPinToSidebar={(starred) =>
              guarded(
                () => store?.setPrefs(channel.id, { starred }) ?? Promise.resolve(),
                "Couldn't pin it.",
              )
            }
            onArchive={(archived) =>
              guarded(
                () => store?.archiveChannel(channel.id, archived) ?? Promise.resolve(),
                "Couldn't archive the channel.",
              )
            }
            onLeave={() =>
              guarded(async () => {
                await store?.leave(channel.id);
                onOpen(null, { replace: true });
              }, "Couldn't leave the channel.")
            }
            onOpenPerson={openPerson}
            onOpenMessage={openMessageInPanel}
            chains={chainList}
            onOpenChain={(root) => openChain(root.id)}
          />
        ),
        chains: () => (
          <ReplyChainsView
            groups={chainList}
            selfId={selfId}
            personOf={personOf}
            rowById={rowById}
            onOpen={(root) => openChain(root.id)}
          />
        ),
      }}
      activeId={panelView}
      onChange={setPanelView}
      items={items}
      onBack={panelStack.back}
      onClearItems={panelStack.clear}
    />
  ) : undefined;

  const wrapReplies = (wrapFor ? snap.chains[wrapFor]?.replies : undefined)?.filter(
    (r) => !r.deletedAt && !r.sendState,
  );

  return (
    <>
      <FeaturePanelsShell
        feature="chat"
        hideRight={!right}
        left={left}
        flushCenter
        center={center}
        right={right}
      />
      <WrapUpDialog
        open={!!wrapFor}
        onOpenChange={(open) => {
          if (!open) setWrapFor(null);
        }}
        replies={wrapReplies ?? []}
        personOf={personOf}
        onConfirm={(settledId) => wrapFor && wrapUp(wrapFor, settledId)}
      />
      <ReplyToDialog
        open={!!attachFor}
        onOpenChange={(open) => {
          if (!open) setAttachFor(null);
        }}
        choices={
          attachFor
            ? replyToChoices(
                attachFor,
                // Only what the stream draws (no wrapped replies, no deletes inside their Undo).
                (streamWin?.rows ?? []).filter((m) => !streamHidden.has(m.id)),
              )
            : []
        }
        personOf={personOf}
        onPick={(target) => {
          const m = attachFor;
          setAttachFor(null);
          if (!store || !m) return;
          void store.attachToChain(m.id, target.id).then((res) => {
            if (!failed(res, "Couldn't add it to the chain.")) toast("Added to the chain");
          });
        }}
      />
      <NewConversationDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        selfId={selfId}
        people={people}
        canCreatePublic={rights.createPublic}
        canCreatePrivate={rights.createPrivate}
        onCreateChannel={async (input) => {
          if (!store) return;
          const created = await store.createChannel(input);
          onOpen(created.id);
        }}
        onOpenDm={async (userIds) => {
          if (!store) return;
          const dm = await store.openDm(userIds);
          onOpen(dm.id);
        }}
        onCaptureNote={() => dispatchOpenCapture({ type: "note" })}
        onBrowse={() => onBrowse?.()}
      />
    </>
  );
}
