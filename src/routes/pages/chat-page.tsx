// Chat (specs/chat.md) — channels, private channels, DMs and threads for Duo /
// Team / Founder workspaces. Three panes: conversation rail (left), the
// conversation (center), and one contextual panel (right): a thread, details
// (members · pinned · about) or search.
//
// URL holds the open conversation (`c`), thread (`t`) and a message to focus
// (`m`) so notification deep-links, copied links and back/forward all work.
// Page-level keys: ⌘J jump to · ⌥↑/⌥↓ previous/next conversation ·
// ⌥⇧↑/⌥⇧↓ previous/next unread · Esc closes the right panel.

import { useNavigate, useSearch } from "@tanstack/react-router";
import { Hash, Loader2, Lock, MessagesSquare } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { ChatComposer, type ChatComposerHandle } from "../../features/chat/composer/chat-composer";
import { CHANNEL_REFUSED_COPY } from "../../features/chat/composer/grammar";
import { useChatOnline, useChatTyping } from "../../features/chat/hooks/use-chat-live";
import { useChatModule } from "../../features/chat/hooks/use-chat-module";
import { decodeForComposer, toPlainText } from "../../features/chat/markup";
import { mentionsOf, messageTree, parseStored, toBodyText } from "../../features/chat/markup-v2";
import type { ChatChannel, ChatMember, ChatMessage, ChatPerson } from "../../features/chat/model";
import type { ChatSearch } from "../../features/chat/search";
import type { ChatWindow } from "../../features/chat/store/store";
import { MessageStream, type MessageStreamHandle } from "../../features/chat/stream/message-stream";
import {
  buildSidebar,
  buildTimeline,
  channelTitle,
  dmOtherIds,
  type SidebarEntry,
} from "../../features/chat/timeline";
import {
  BrowseChannelsDialog,
  ConversationSwitcher,
  CreateChannelDialog,
  PeoplePickerDialog,
} from "../../features/chat/ui/chat-dialogs";
import { ChatLocked } from "../../features/chat/ui/chat-locked";
import { ChatSidebar } from "../../features/chat/ui/chat-sidebar";
import { Composer } from "../../features/chat/ui/composer";
import { ConversationHeader } from "../../features/chat/ui/conversation-header";
import { type MessageActions, MessageItem } from "../../features/chat/ui/message-item";
import { PersonAvatar } from "../../features/chat/ui/person-avatar";
import { DetailsPanel, SearchPanel, ThreadPanel } from "../../features/chat/ui/side-panels";
import { dispatchLayoutPanelsSet, readFeaturePanelState } from "../../features/layout/panel-events";
import { createCapturedEntity } from "../../features/spine/capture-command";
import { dispatchOpenCapture } from "../../lib/capture-open";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";

type RightPanel = "details" | "search" | null;

/** "Deleted · Undo" stays this long; then the server deletes (§6 #10). */
const DELETE_UNDO_MS = 8000;

const EMPTY_WINDOW: ChatWindow = {
  rows: [],
  hasOlder: false,
  hasNewer: false,
  loading: true,
  loaded: false,
  newAfter: null,
  target: null,
};

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

export function ChatPage() {
  const { runtime, userId } = useAuth();
  const { selectedWorkspaceId, selectedWorkspace } = useWorkspace();
  const search = useSearch({ strict: false }) as ChatSearch;
  const navigate = useNavigate();

  const activeChannelId = search.c ?? null;
  const activeThreadId = search.t ?? null;
  const [panel, setPanel] = useState<RightPanel>(null);
  const [focusId, setFocusId] = useState<string | null>(search.m ?? null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "channel" | "dm" | "browse" | "switcher" | "add">(
    null,
  );
  const [channelMembers, setChannelMembers] = useState<ChatMember[]>([]);
  const [pinVersion, setPinVersion] = useState(0);

  const { state, link, actions, store, snap, markSeen } = useChatModule({
    runtime,
    workspaceId: selectedWorkspaceId,
    userId,
    activeChannelId,
    activeThreadId,
    focusMessageId: search.m ?? null,
  });
  const online = useChatOnline(link);
  const typing = useChatTyping(link);
  const selfId = userId ?? "";

  useEffect(() => {
    if (search.m) setFocusId(search.m);
  }, [search.m]);

  // ── navigation ────────────────────────────────────────────────────────────
  const go = useCallback(
    (next: ChatSearch, replace = false) => {
      void navigate({ to: "/chat", search: next as Record<string, string>, replace });
    },
    [navigate],
  );
  const openChannel = useCallback(
    (channelId: string, extra: Omit<ChatSearch, "c"> = {}) => {
      setEditingId(null);
      go({ c: channelId, ...extra });
    },
    [go],
  );

  // ── derived ───────────────────────────────────────────────────────────────
  const personOf = useCallback(
    (id: string): ChatPerson | undefined => state.people[id],
    [state.people],
  );
  const isOnline = useCallback((id: string) => online.has(id), [online]);
  const titleOf = useCallback(
    (c: ChatChannel) => channelTitle(c, selfId, personOf),
    [selfId, personOf],
  );
  const people = useMemo(
    () => Object.values(state.people).sort((a, b) => a.name.localeCompare(b.name)),
    [state.people],
  );

  const entries: SidebarEntry[] = useMemo(
    () =>
      Object.values(state.channels).map((channel) => {
        const member = state.mine[channel.id];
        return {
          channel,
          unread: state.unread[channel.id]?.unread ?? 0,
          mentions: state.unread[channel.id]?.mentions ?? 0,
          starred: member?.starred ?? false,
          muted: member?.notifyLevel === "none",
          isMember: Boolean(member),
        };
      }),
    [state.channels, state.mine, state.unread],
  );
  const sections = useMemo(() => buildSidebar(entries, titleOf), [entries, titleOf]);
  const ordered = useMemo(
    () => [...sections.starred, ...sections.channels, ...sections.dms],
    [sections],
  );

  const channel = activeChannelId ? state.channels[activeChannelId] : undefined;
  const member = activeChannelId ? state.mine[activeChannelId] : undefined;
  const win = activeChannelId ? state.messages[activeChannelId] : undefined;
  const thread = activeThreadId ? state.threads[activeThreadId] : undefined;
  const threadParent = activeThreadId
    ? (win?.items.find((m) => m.id === activeThreadId) ?? thread?.parent ?? null)
    : null;

  // v2's stream reads the store's window: the "New" pill sits at the read
  // mark the store kept when the conversation opened (it never jumps).
  const streamWin = activeChannelId ? snap.windows[activeChannelId] : undefined;

  // Default landing: the first conversation in the rail (or #general).
  useEffect(() => {
    if (state.status !== "ready" || activeChannelId) return;
    const general = Object.values(state.channels).find(
      (c) => c.name === "general" && !c.archivedAt,
    );
    const first = ordered[0]?.channel ?? general;
    if (first) go({ c: first.id }, true);
  }, [state.status, activeChannelId, ordered, state.channels, go]);

  // Unknown / vanished conversation in the URL → back to the default.
  useEffect(() => {
    if (state.status === "ready" && activeChannelId && !state.channels[activeChannelId]) {
      toast("That conversation isn't available.");
      go({}, true);
    }
  }, [state.status, activeChannelId, state.channels, go]);

  // Members of the open conversation (details panel + header count + mention scope).
  useEffect(() => {
    if (!runtime || !activeChannelId || state.status !== "ready") {
      setChannelMembers([]);
      return;
    }
    let cancelled = false;
    void runtime.chat
      .listChannelMembers(activeChannelId)
      .then((rows) => !cancelled && setChannelMembers(rows))
      .catch(() => !cancelled && setChannelMembers([]));
    return () => {
      cancelled = true;
    };
  }, [runtime, activeChannelId, state.status, member?.joinedAt, dialog]);

  // A thread / details / search is contextual: opening one reveals the right
  // rail even if the user had collapsed it (the toggle still closes it).
  const wantsRight = Boolean(activeThreadId || panel);
  useEffect(() => {
    if (!wantsRight) return;
    const current = readFeaturePanelState("chat");
    if (!current.right)
      dispatchLayoutPanelsSet({ feature: "chat", left: current.left, right: true });
  }, [wantsRight, activeThreadId, panel]);

  // The thread panel replaces details/search; closing it restores nothing.
  useEffect(() => {
    if (activeThreadId) setPanel(null);
  }, [activeThreadId]);

  // ── keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector("[role='dialog'], [role='menu']")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setDialog("switcher");
        return;
      }
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        const list = e.shiftKey
          ? ordered.filter((x) => x.unread > 0 || x.channel.id === activeChannelId)
          : ordered;
        if (list.length === 0) return;
        e.preventDefault();
        const i = list.findIndex((x) => x.channel.id === activeChannelId);
        const d = e.key === "ArrowDown" ? 1 : -1;
        const next = list[(i + d + list.length) % list.length];
        if (next) openChannel(next.channel.id);
        return;
      }
      if (e.key === "Escape" && !e.defaultPrevented) {
        if (activeThreadId) {
          go({ c: activeChannelId ?? undefined });
        } else if (panel) {
          setPanel(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ordered, activeChannelId, activeThreadId, panel, openChannel, go]);

  // ── message actions ───────────────────────────────────────────────────────
  const nameOf = useCallback((id: string) => state.people[id]?.name ?? "someone", [state.people]);

  const messageActions: MessageActions = useMemo(
    () => ({
      onReact: (m, emoji) => void actions.react(m, emoji),
      onReply: (m) => go({ c: m.channelId, t: m.id }),
      onStartEdit: (m) => setEditingId(m.id),
      onSaveEdit: (m, text, picks) => {
        setEditingId(null);
        void actions.edit(m, text, picks);
      },
      onCancelEdit: () => setEditingId(null),
      onDelete: (m) => {
        if (m.failed || m.id.startsWith("local:")) {
          void actions.remove(m);
          return;
        }
        toast("Delete this message?", {
          description: "It's removed for everyone. This can't be undone.",
          action: { label: "Delete", onClick: () => void actions.remove(m) },
        });
      },
      onPin: (m, pinned) => {
        void actions.pin(m, pinned).then(() => setPinVersion((v) => v + 1));
      },
      onMarkUnread: (m) => {
        void actions.markUnread(m);
      },
      onCopyLink: (m) => {
        const params = new URLSearchParams({
          c: m.channelId,
          ...(m.parentId ? { t: m.parentId } : {}),
          m: m.id,
        });
        void navigator.clipboard
          ?.writeText(`${webOrigin()}/chat?${params.toString()}`)
          .then(() => toast("Link copied"))
          .catch(() => toast("Couldn't copy the link."));
      },
      onCopyText: (m) => {
        void navigator.clipboard
          ?.writeText(toPlainText(m.body, nameOf))
          .then(() => toast("Copied"))
          .catch(() => toast("Couldn't copy."));
      },
      onCreateTask: (m) => {
        if (!runtime || !selectedWorkspaceId) return;
        const text = toPlainText(m.body, nameOf).slice(0, 200);
        void createCapturedEntity({
          runtime,
          workspaceId: selectedWorkspaceId,
          target: "task",
          body: text,
        })
          .then((created) =>
            toast(`Task created: ${created.title}`, {
              description: created.description,
              action: { label: "Open", onClick: () => void navigate({ to: "/tasks" }) },
            }),
          )
          .catch((err: unknown) =>
            toast(err instanceof Error ? err.message : "Couldn't create the task."),
          );
      },
      onRetry: (m) => actions.retry(m),
      onPersonClick: (id) => {
        if (id === selfId) return;
        void actions
          .openDm([id])
          .then((c) => openChannel(c.id))
          .catch((err: unknown) =>
            toast(err instanceof Error ? err.message : "Couldn't open the conversation."),
          );
      },
    }),
    [actions, go, nameOf, runtime, selectedWorkspaceId, navigate, selfId, openChannel],
  );

  const composerBase = useMemo(
    () => ({ runtime, workspaceId: selectedWorkspaceId, selfId, people }),
    [runtime, selectedWorkspaceId, selfId, people],
  );

  const editInitialFor = useCallback(
    (m: ChatMessage) => decodeForComposer(m.body, nameOf),
    [nameOf],
  );

  const renderMessage = useCallback(
    (m: ChatMessage, grouped: boolean, inThread = false) => (
      <MessageItem
        message={m}
        grouped={grouped}
        selfId={selfId}
        personOf={personOf}
        isOnline={isOnline}
        editing={editingId === m.id}
        editInitial={editingId === m.id ? editInitialFor(m) : undefined}
        composerBase={composerBase}
        highlighted={focusId === m.id}
        inThread={inThread}
        actions={messageActions}
      />
    ),
    [selfId, personOf, isOnline, editingId, editInitialFor, composerBase, focusId, messageActions],
  );

  const typingNames = useCallback(
    (channelId: string, parentId: string | null) =>
      typing
        .filter((t) => t.channelId === channelId && t.parentId === parentId)
        .map((t) => state.people[t.userId]?.name ?? "Someone"),
    [typing, state.people],
  );

  // ── v2's stream (CV-7a) ───────────────────────────────────────────────────
  const streamRef = useRef<MessageStreamHandle | null>(null);

  /** ↑ in an empty composer edits your last message; with none, it steps into the stream. */
  const editLast = useCallback(
    (items: ChatMessage[], inStream = false, skip: ReadonlySet<string> = new Set()) => {
      const mine = [...items]
        .reverse()
        .find(
          (m) =>
            !skip.has(m.id) &&
            m.authorId === selfId &&
            m.kind !== "event" &&
            !m.deletedAt &&
            !m.sendState &&
            !m.pending &&
            !m.failed,
        );
      if (mine) setEditingId(mine.id);
      else if (inStream) streamRef.current?.focusLast();
    },
    [selfId],
  );

  const composerRef = useRef<ChatComposerHandle | null>(null);
  const returnToComposer = useCallback((typed?: string) => {
    if (typed) composerRef.current?.insertText(typed);
    else composerRef.current?.focus();
  }, []);

  // `@channel` from a role that may not mention everyone is sent as text; the
  // server decides (CV-2a) and the composer says so once the message is back.
  const [channelNote, setChannelNote] = useState<{ id: string; note: string | null } | null>(null);
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
  // The toast's own clock decides (it pauses while hovered or the tab is
  // hidden), so "Undo" is never offered after the server has deleted.
  const pendingDeletes = useRef(new Map<string, { message: ChatMessage }>());
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
      const pending = pendingDeletes.current.get(id);
      if (!pending) return;
      pendingDeletes.current.delete(id);
      toast.dismiss(`chat-delete-${id}`);
      void actions.remove(pending.message).finally(() => unhide(id));
    },
    [actions, unhide],
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
      pendingDeletes.current.set(m.id, { message: m });
      toast("Deleted", {
        id: `chat-delete-${m.id}`,
        duration: DELETE_UNDO_MS,
        // Time up, or closed without Undo: the delete goes to the server.
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

  // T / "Make a task": the app's capture opens as Task with the message's
  // words on the title line (AC2.7). The "From:" chip linking it back to the
  // message is CV-10's.
  const makeTaskFrom = useCallback((m: ChatMessage) => {
    const text = toBodyText(messageTree(m.id, m.updatedAt, m.body))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    dispatchOpenCapture({ type: "task", draft: text });
  }, []);

  // ── render: states ────────────────────────────────────────────────────────
  if (!selectedWorkspaceId || state.status === "loading") {
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
  if (state.status === "locked") {
    return (
      <FeaturePanelsShell
        feature="chat"
        hideRight
        flushCenter
        center={<ChatLocked isOwner={selectedWorkspace?.role === "owner"} />}
      />
    );
  }
  if (state.status === "error") {
    return (
      <FeaturePanelsShell
        feature="chat"
        hideRight
        center={
          <EmptyState
            icon={MessagesSquare}
            title="Chat couldn't load"
            description={state.error ?? "Check your connection and try again."}
            action={
              <Button size="sm" onClick={() => void actions.reload()}>
                Try again
              </Button>
            }
          />
        }
      />
    );
  }

  const canManage =
    !!channel &&
    (channel.createdBy === selfId ||
      selectedWorkspace?.role === "owner" ||
      selectedWorkspace?.role === "admin");
  const title = channel ? titleOf(channel) : "";
  const placeholder = channel
    ? channel.kind === "channel"
      ? `Message #${channel.name}`
      : `Message ${title}`
    : "";
  const takenNames = new Set(
    Object.values(state.channels)
      .filter((c) => c.kind === "channel")
      .map((c) => c.name ?? ""),
  );

  const intro = channel ? (
    <div className="flex flex-col gap-2 px-2 pt-6 pb-4">
      {channel.kind === "channel" ? (
        <>
          <span className="grid size-10 place-items-center rounded-lg border border-border bg-background">
            {channel.isPrivate ? (
              <Lock className="size-icon text-muted-foreground" aria-hidden />
            ) : (
              <Hash className="size-icon text-muted-foreground" aria-hidden />
            )}
          </span>
          <h2 className="font-display text-xl font-semibold text-foreground">
            This is the start of #{channel.name}
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {channel.topic ? `${channel.topic}. ` : ""}Type{" "}
            <span className="font-medium text-foreground">#</span> to link a task, note or contact —
            everyone here sees it live.
          </p>
        </>
      ) : (
        <>
          <div className="flex -space-x-2">
            {(dmOtherIds(channel, selfId).length ? dmOtherIds(channel, selfId) : [selfId])
              .slice(0, 4)
              .map((id) => (
                <PersonAvatar
                  key={id}
                  person={personOf(id)}
                  size="lg"
                  className="rounded-avatar ring-2 ring-card"
                />
              ))}
          </div>
          <h2 className="font-display text-xl font-semibold text-foreground">{title}</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {dmOtherIds(channel, selfId).length === 0
              ? "Your own space — jot things down, park links, draft messages."
              : "This conversation is just between you. Mentions and messages here reach them on the Chat tab."}
          </p>
        </>
      )}
    </div>
  ) : null;

  const center = channel ? (
    <div className="flex h-full min-h-0 flex-col">
      <ConversationHeader
        channel={channel}
        title={title}
        member={member}
        selfId={selfId}
        memberCount={channel.kind === "channel" ? channelMembers.length : null}
        personOf={personOf}
        isOnline={isOnline}
        canManage={canManage}
        panel={activeThreadId ? "thread" : panel}
        onTogglePanel={(p) => {
          if (activeThreadId) go({ c: channel.id });
          setPanel((cur) => (cur === p ? null : p));
        }}
        onTopic={(topic) => actions.updateChannel(channel.id, { topic })}
        onStar={(starred) => void actions.setPrefs(channel.id, { starred })}
        onNotify={(notifyLevel) => void actions.setPrefs(channel.id, { notifyLevel })}
        onMarkRead={() => actions.markRead(channel.id)}
        onLeave={() => {
          void actions.leave(channel.id).then(() => go({}, true));
        }}
        onArchive={(archived) => void actions.archiveChannel(channel.id, archived)}
        onJoin={() => void actions.join(channel.id)}
      />
      <MessageStream
        key={channel.id}
        ref={streamRef}
        conversationId={channel.id}
        window={streamWin ?? EMPTY_WINDOW}
        selfId={selfId}
        personOf={personOf}
        rowById={(id) => store?.rowById(id)}
        hidden={hidden}
        editingId={editingId}
        canWrite={!!member && !channel.archivedAt}
        intro={intro}
        onLoadOlder={() => void actions.loadOlder(channel.id)}
        onLoadNewer={() => void store?.loadNewer(channel.id)}
        onJumpToLatest={() => void actions.jumpToLatest(channel.id)}
        onSeen={(id) => markSeen(channel.id, id)}
        onStartEdit={(m) => setEditingId(m.id)}
        renderEditor={(m) => (
          <ChatComposer
            mode="edit"
            className="mt-0.5"
            runtime={runtime}
            workspaceId={selectedWorkspaceId}
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
        onReact={(m, key) => void actions.react(m, key)}
        onPin={(m) => messageActions.onPin?.(m, !m.pinnedAt)}
        onTask={makeTaskFrom}
        onCopyLink={(m) => messageActions.onCopyLink?.(m)}
        onMarkUnread={(m) => void actions.markUnread(m)}
        onOpenChain={(m) => go({ c: m.channelId, t: m.parentId ?? m.id })}
        onRetry={(m) => actions.retry(m)}
        onDiscard={(m) => store?.discard(m.id)}
        onPersonClick={(id) => messageActions.onPersonClick?.(id)}
        onReturnToComposer={returnToComposer}
      />
      <div data-chat-composer className="shrink-0 px-3 pb-3">
        {channel.archivedAt ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
            <span className="text-sm text-muted-foreground">
              This channel is archived. It's read only.
            </span>
            {canManage ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void actions.archiveChannel(channel.id, false)}
              >
                Unarchive
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <p
              className="h-5 truncate px-3 pt-0.5 text-xs text-muted-foreground"
              aria-live="polite"
            >
              {typingLine(typingNames(channel.id, null))}
            </p>
            <ChatComposer
              key={channel.id}
              ref={composerRef}
              runtime={runtime}
              workspaceId={selectedWorkspaceId}
              selfId={selfId}
              people={people}
              placeholder={placeholder}
              initial={store?.draft(channel.id) ?? ""}
              autoFocus
              note={channelNote?.note ?? null}
              onSend={(body) => {
                const id = actions.sendStored({ channelId: channel.id, body });
                setChannelNote(
                  id && mentionsOf(parseStored(body)).channel ? { id, note: null } : null,
                );
                streamRef.current?.showLatest();
              }}
              onDraftChange={(stored) => store?.setDraft(channel.id, null, stored)}
              onTyping={(active) => link?.sendTyping(channel.id, null, !active)}
              onEditLast={() =>
                editLast(
                  // The row past the window's edge isn't drawn; ids inside their Undo are gone.
                  (streamWin?.hasOlder ? streamWin.rows.slice(1) : streamWin?.rows) ?? [],
                  true,
                  hidden,
                )
              }
              onEscapeEmpty={() => streamRef.current?.focusLast()}
            />
          </>
        )}
      </div>
    </div>
  ) : (
    <EmptyState
      icon={MessagesSquare}
      title="No conversation open"
      description="Pick a channel or person on the left, or start something new."
      action={
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setDialog("dm")}>
            New message
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDialog("channel")}>
            New channel
          </Button>
        </div>
      }
      hint="⌘J jumps to any conversation"
    />
  );

  let right: React.ReactNode = null;
  if (channel && activeThreadId) {
    right = (
      <ThreadPanel
        channelLabel={channel.kind === "channel" ? `#${channel.name}` : title}
        loading={!thread?.loaded}
        onClose={() => go({ c: channel.id })}
        composer={
          channel.archivedAt ? null : (
            <Composer
              {...composerBase}
              placeholder="Reply…"
              draftKey={`thread:${activeThreadId}`}
              autoFocus
              compact
              onSubmit={(text, picks) =>
                actions.send({ channelId: channel.id, text, picks, parentId: activeThreadId })
              }
              onEditLast={() => editLast(thread?.items ?? [])}
              onTyping={() => link?.sendTyping(channel.id, activeThreadId)}
              typingLine={typingLine(typingNames(channel.id, activeThreadId))}
            />
          )
        }
      >
        {threadParent ? (
          <div className="border-b border-border pb-2">
            {renderMessage(threadParent, false, true)}
          </div>
        ) : null}
        {thread?.loaded ? (
          <>
            <div className="flex items-center gap-2 px-2 py-2">
              <span className="text-2xs text-muted-foreground">
                {thread.items.length} {thread.items.length === 1 ? "reply" : "replies"}
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
            {buildTimeline(thread.items, { selfId })
              .filter((r): r is Extract<typeof r, { kind: "message" }> => r.kind === "message")
              .map((r) => (
                <div key={r.key}>{renderMessage(r.message, r.grouped, true)}</div>
              ))}
          </>
        ) : null}
      </ThreadPanel>
    );
  } else if (channel && panel === "details") {
    right = (
      <DetailsPanel
        runtime={runtime}
        channel={channel}
        title={title}
        selfId={selfId}
        members={channelMembers}
        personOf={personOf}
        isOnline={isOnline}
        canManage={canManage}
        onClose={() => setPanel(null)}
        onAddPeople={() => setDialog("add")}
        onRemove={(id) => {
          void actions
            .removeMember(channel.id, id)
            .then(() => setChannelMembers((ms) => ms.filter((m) => m.userId !== id)));
        }}
        onOpenDm={(id) => messageActions.onPersonClick?.(id)}
        onJumpTo={(m) => {
          setFocusId(m.id);
          go({ c: m.channelId, m: m.id });
        }}
        pinVersion={pinVersion}
      />
    );
  } else if (panel === "search" && selectedWorkspaceId) {
    right = (
      <SearchPanel
        runtime={runtime}
        workspaceId={selectedWorkspaceId}
        channelsById={state.channels}
        titleOf={titleOf}
        personOf={personOf}
        onClose={() => setPanel(null)}
        onOpen={(m) => {
          setFocusId(m.parentId ? null : m.id);
          go(m.parentId ? { c: m.channelId, t: m.parentId } : { c: m.channelId, m: m.id });
        }}
      />
    );
  }

  return (
    <>
      <FeaturePanelsShell
        feature="chat"
        hideRight={!right}
        left={
          <ChatSidebar
            sections={sections}
            activeChannelId={activeChannelId}
            selfId={selfId}
            titleOf={titleOf}
            personOf={personOf}
            isOnline={isOnline}
            onSelect={(id) => openChannel(id)}
            onNewChannel={() => setDialog("channel")}
            onNewMessage={() => setDialog("dm")}
            onBrowse={() => setDialog("browse")}
            onSwitcher={() => setDialog("switcher")}
          />
        }
        flushCenter
        center={center}
        right={right}
      />

      <CreateChannelDialog
        open={dialog === "channel"}
        onOpenChange={(o) => setDialog(o ? "channel" : null)}
        people={people}
        selfId={selfId}
        takenNames={takenNames}
        onCreate={async (args) => {
          const created = await actions.createChannel(args);
          openChannel(created.id);
        }}
      />
      <PeoplePickerDialog
        open={dialog === "dm"}
        onOpenChange={(o) => setDialog(o ? "dm" : null)}
        title="New message"
        description="Pick one person for a direct message, or up to eight for a group."
        confirmLabel={(n) => (n > 1 ? `Start group message (${n + 1})` : "Start conversation")}
        people={people}
        allowSelf
        selfId={selfId}
        isOnline={isOnline}
        max={8}
        onConfirm={async (ids) => {
          try {
            const c = await actions.openDm(
              ids.filter((id) => id !== selfId).length
                ? ids.filter((id) => id !== selfId)
                : [selfId],
            );
            openChannel(c.id);
          } catch (err) {
            toast(err instanceof Error ? err.message : "Couldn't start the conversation.");
            throw err;
          }
        }}
      />
      {channel ? (
        <PeoplePickerDialog
          open={dialog === "add"}
          onOpenChange={(o) => setDialog(o ? "add" : null)}
          title={`Add people to #${channel.name ?? ""}`}
          description={
            channel.isPrivate
              ? "They'll see the full history of this private channel."
              : "They'll be added and see the channel in their sidebar."
          }
          confirmLabel={(n) => (n === 1 ? "Add 1 person" : `Add ${n} people`)}
          people={people}
          excludeIds={channelMembers.map((m) => m.userId)}
          selfId={selfId}
          isOnline={isOnline}
          onConfirm={async (ids) => {
            await actions.addMembers(channel.id, ids);
          }}
        />
      ) : null}
      <BrowseChannelsDialog
        open={dialog === "browse"}
        onOpenChange={(o) => setDialog(o ? "browse" : null)}
        channels={Object.values(state.channels)}
        isMember={(id) => Boolean(state.mine[id])}
        onOpen={(id) => {
          setDialog(null);
          openChannel(id);
        }}
        onJoin={async (id) => {
          await actions.join(id);
          setDialog(null);
          openChannel(id);
        }}
        onNew={() => setDialog("channel")}
      />
      <ConversationSwitcher
        open={dialog === "switcher"}
        onOpenChange={(o) => setDialog(o ? "switcher" : null)}
        channels={Object.values(state.channels).filter((c) =>
          c.kind === "channel" ? !c.isPrivate || state.mine[c.id] : state.mine[c.id],
        )}
        people={people}
        selfId={selfId}
        titleOf={titleOf}
        unreadOf={(id) => state.unread[id]?.unread ?? 0}
        isOnline={isOnline}
        onPickChannel={(id) => {
          setDialog(null);
          openChannel(id);
        }}
        onPickPerson={(id) => {
          setDialog(null);
          void actions
            .openDm([id])
            .then((c) => openChannel(c.id))
            .catch((err: unknown) =>
              toast(err instanceof Error ? err.message : "Couldn't open the conversation."),
            );
        }}
      />
    </>
  );
}
