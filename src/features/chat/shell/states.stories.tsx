import type { Meta, StoryObj } from "@storybook/react";
import type * as React from "react";
import { useState } from "react";

import { ChatComposer } from "../composer/chat-composer";
import type { ChatChannel, ChatMember, ChatMessage, ChatPerson, ChatUnread } from "../model";
import type { ChatWindow } from "../store/store";
import { MessageStream } from "../stream/message-stream";
import { ChatSidebar } from "./chat-sidebar";
import { composerLine } from "./composer-state";
import { ComposerLineView, ConversationStart, OfflineLine } from "./conversation-states";
import { ConversationToolbar } from "./conversation-toolbar";
import { buildChatSidebar, conversationTitle, dmPeople } from "./sidebar-model";

// Chat's left panel (round 5 frame 1) and every state of frame 7 around the
// stream (CV-8a): a new channel, General's first open with the welcome,
// loading, archived, paused (a member and the owner), offline, older history,
// a viewer, a non-manager in an announcement channel, a former member.
// `tests/visual/chat-states.spec.ts` reads these.

const people: Record<string, ChatPerson> = {
  me: { userId: "me", name: "Alex Rivera", avatarUrl: null, role: "member", former: false },
  so: { userId: "so", name: "Sofia Ortiz", avatarUrl: null, role: "member", former: false },
  mc: { userId: "mc", name: "Mike Chen", avatarUrl: null, role: "member", former: false },
  jl: { userId: "jl", name: "Jana Lis", avatarUrl: null, role: "member", former: true },
};
const personOf = (id: string) => people[id];
const AT = "2026-10-02T15:02:00.000Z";

function channel(id: string, patch: Partial<ChatChannel> = {}): ChatChannel {
  return {
    id,
    workspaceId: "w",
    kind: "channel",
    name: id,
    topic: "",
    isPrivate: false,
    dmKey: null,
    createdBy: "me",
    createdAt: AT,
    updatedAt: AT,
    archivedAt: null,
    lastMessageAt: AT,
    ...patch,
  };
}

function member(channelId: string, patch: Partial<ChatMember> = {}): ChatMember {
  return {
    channelId,
    userId: "me",
    workspaceId: "w",
    notifyLevel: "mentions",
    starred: false,
    lastReadAt: AT,
    lastReadId: null,
    joinedAt: AT,
    ...patch,
  };
}

let seq = 0;
function msg(author: string, body: string, minutes: number): ChatMessage {
  seq += 1;
  const at = new Date(Date.parse(AT) + minutes * 60_000).toISOString();
  return {
    id: `s${seq}`,
    workspaceId: "w",
    channelId: "c",
    parentId: null,
    replyToId: null,
    kind: "message",
    event: null,
    formatVersion: 2,
    authorId: author,
    authorKind: "user",
    authorLabel: null,
    body,
    mentionedUserIds: [],
    mentionedTeamIds: [],
    mentionsEveryone: false,
    reactions: {},
    replyCount: 0,
    lastReplyAt: null,
    replyUserIds: [],
    pinnedAt: null,
    pinnedBy: null,
    editedAt: null,
    deletedAt: null,
    clientId: null,
    createdAt: at,
    updatedAt: at,
  };
}

const HISTORY = [
  msg("me", "Contract signed. Kickoff is on the 12th.", 0),
  msg("so", "Great news. I'll set up the moodboard.", 8),
];
const FORMER = [msg("jl", "Sent you the final files, see you around!", 0)];

const win = (rows: ChatMessage[], patch: Partial<ChatWindow> = {}): ChatWindow => ({
  rows,
  hasOlder: false,
  hasNewer: false,
  loading: false,
  loaded: true,
  newAfter: null,
  target: null,
  ...patch,
});

type State = {
  id: string;
  label: string;
  channel: ChatChannel;
  member?: ChatMember;
  window: ChatWindow;
  paused?: boolean;
  owner?: boolean;
  canPost?: boolean;
  canManage?: boolean;
  offline?: boolean;
};

const acme = channel("acme", { name: "Acme rebrand" });
const STATES: State[] = [
  {
    id: "new",
    label: "A new channel",
    channel: channel("brand", { name: "Brand refresh", lastMessageAt: null }),
    member: member("brand"),
    window: win([]),
  },
  {
    id: "first",
    label: "First open: General, with the welcome",
    channel: channel("general", { name: "General", isDefault: true, lastMessageAt: null }),
    member: member("general"),
    window: win([]),
  },
  {
    id: "loading",
    label: "Loading",
    channel: acme,
    member: member("acme"),
    window: win([], { loading: true, loaded: false }),
  },
  {
    id: "archived",
    label: "Archived",
    channel: channel("acme", { name: "Acme rebrand", archivedAt: AT }),
    member: member("acme"),
    window: win(HISTORY),
    canManage: true,
  },
  {
    id: "paused",
    label: "Paused: a member",
    channel: acme,
    member: member("acme"),
    window: win(HISTORY),
    paused: true,
  },
  {
    id: "paused-owner",
    label: "Paused: the owner",
    channel: acme,
    member: member("acme"),
    window: win(HISTORY),
    paused: true,
    owner: true,
  },
  {
    id: "offline",
    label: "Offline",
    channel: acme,
    member: member("acme"),
    window: win(HISTORY),
    offline: true,
  },
  {
    id: "older",
    label: "Reading far back",
    channel: acme,
    member: member("acme"),
    window: win(HISTORY, { hasNewer: true, hasOlder: true }),
  },
  {
    id: "viewer",
    label: "A viewer",
    channel: acme,
    member: member("acme"),
    window: win(HISTORY),
    canPost: false,
  },
  {
    id: "announcement",
    label: "A non-manager in an announcement channel",
    channel: channel("news", { name: "Announcements", managersOnly: true }),
    member: member("news"),
    window: win(HISTORY),
  },
  {
    id: "former",
    label: "A former member's direct message",
    channel: channel("dm-jl", { kind: "dm", name: null, dmKey: "jl,me" }),
    member: member("dm-jl"),
    window: win(FORMER),
  },
];

const noop = () => {};

function ConversationState({ state }: { state: State }) {
  const [hidden] = useState<ReadonlySet<string>>(() => new Set());
  const { channel: c } = state;
  const title = conversationTitle(c, "me", personOf);
  const others = c.kind === "dm" ? dmPeople(c, "me") : [];
  const line = composerLine({
    channel: c,
    member: state.member,
    selfId: "me",
    personOf,
    paused: state.paused ?? false,
    isOwner: state.owner ?? false,
    ownerName: "Anna Kowalska",
    canPost: state.canPost ?? true,
    canManage: state.canManage ?? false,
  });
  return (
    <section
      data-state={state.id}
      aria-label={state.label}
      className="flex h-120 w-180 flex-col overflow-hidden rounded-lg border border-hairline bg-card"
    >
      <ConversationToolbar
        row={{ channel: c, people: others, title }}
        member={state.member}
        personOf={personOf}
        peopleCount={c.kind === "dm" ? null : 4}
        canManage={state.canManage ?? false}
        paused={state.paused}
      />
      <MessageStream
        conversationId={`story-${state.id}`}
        window={state.window}
        selfId="me"
        personOf={personOf}
        rowById={() => undefined}
        hidden={hidden}
        editingId={null}
        canWrite={line === null}
        intro={
          <ConversationStart
            channel={c}
            title={title}
            people={others}
            personOf={personOf}
            workspaceName="Moduo Studio"
          />
        }
        onLoadOlder={noop}
        onLoadNewer={noop}
        onJumpToLatest={noop}
        onSeen={noop}
        onStartEdit={noop}
        renderEditor={() => null}
        onDelete={noop}
        onReact={noop}
        onPin={noop}
        onTask={noop}
        onCopyLink={noop}
        onMarkUnread={noop}
        onOpenChain={noop}
        onRetry={noop}
        onDiscard={noop}
        onReturnToComposer={noop}
      />
      <div data-chat-composer className="shrink-0 px-3 pb-3">
        {state.offline ? <OfflineLine /> : null}
        {line ? (
          <ComposerLineView
            line={line}
            onUnarchive={noop}
            onChoosePlan={noop}
            onReplyPrivately={noop}
            onJoin={noop}
          />
        ) : (
          <ChatComposer
            runtime={null}
            workspaceId={null}
            selfId="me"
            people={Object.values(people)}
            placeholder={`Message ${title}`}
            onSend={() => true}
          />
        )}
      </div>
    </section>
  );
}

const meta: Meta = {
  title: "Features/Chat/States",
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj;

/** Every state of frame 7: a line replaces the composer, never a disabled box (AC1.8). */
export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-6 bg-background p-4">
      {STATES.map((s) => (
        <ConversationState key={s.id} state={s} />
      ))}
    </div>
  ),
};

const SIDEBAR_CHANNELS: Record<string, ChatChannel> = {
  acme: channel("acme", { name: "Acme rebrand" }),
  general: channel("general", { name: "General", isDefault: true }),
  launch: channel("launch", { name: "Launch v1" }),
  random: channel("random", { name: "Random" }),
  founders: channel("founders", { name: "Founders", isPrivate: true }),
  old: channel("old", { name: "Website 2025", archivedAt: AT }),
  dmSo: channel("dmSo", { kind: "dm", name: null, dmKey: "me,so", lastMessageAt: AT }),
  dmMc: channel("dmMc", {
    kind: "dm",
    name: null,
    dmKey: "mc,me",
    lastMessageAt: "2026-10-01T10:00:00.000Z",
  }),
};
const SIDEBAR_MINE: Record<string, ChatMember> = Object.fromEntries(
  Object.keys(SIDEBAR_CHANNELS).map((id) => [
    id,
    member(id, {
      starred: id === "acme",
      notifyLevel: id === "random" ? "none" : "mentions",
    }),
  ]),
);
const unread = (channelId: string, n: number, addressed: number): ChatUnread => ({
  channelId,
  unread: n,
  mentions: 0,
  addressed,
  catchup: addressed,
});
const SIDEBAR_UNREAD: Record<string, ChatUnread> = {
  acme: unread("acme", 2, 1),
  launch: unread("launch", 4, 0),
  random: unread("random", 3, 1),
  dmSo: unread("dmSo", 2, 2),
};

function SidebarDemo({ children }: { children?: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const model = buildChatSidebar({
    channels: SIDEBAR_CHANNELS,
    mine: SIDEBAR_MINE,
    unread: SIDEBAR_UNREAD,
    selfId: "me",
    personOf,
  });
  return (
    <div
      data-testid="chat-sidebar"
      className="h-120 w-64 rounded-lg border border-hairline bg-card p-2"
    >
      <ChatSidebar
        model={model}
        activeId="acme"
        personOf={personOf}
        online={(id) => id === "so"}
        collapsed={collapsed}
        onToggleSection={(s) =>
          setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(s)) next.delete(s);
            else next.add(s);
            return next;
          })
        }
        onOpen={noop}
        onOpenCatchup={noop}
        onNewConversation={noop}
      />
      {children}
    </div>
  );
}

/** The left panel (frame 1): Catch up · hairline · Pinned · Channels · Direct messages · New conversation. */
export const Sidebar: Story = {
  render: () => <SidebarDemo />,
};
