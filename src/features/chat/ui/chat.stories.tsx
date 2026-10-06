import type { Meta, StoryObj } from "@storybook/react";
import { useMemo, useState } from "react";
import type { ChatChannel, ChatMember, ChatMessage, ChatPerson } from "../model";
import {
  buildSidebar,
  buildTimeline,
  channelTitle,
  type SidebarEntry,
  toggleReaction,
} from "../timeline";
import { ChatLocked } from "./chat-locked";
import { ChatSidebar } from "./chat-sidebar";
import { Composer } from "./composer";
import { ConversationHeader } from "./conversation-header";
import { type MessageActions, MessageItem } from "./message-item";
import { MessageList } from "./message-list";
import { DetailsPanel, ThreadPanel } from "./side-panels";

const ME = "00000000-0000-4000-8000-000000000001";
const ANA = "00000000-0000-4000-8000-000000000002";
const BEN = "00000000-0000-4000-8000-000000000003";
const TASK = "00000000-0000-4000-8000-0000000000aa";

const people: Record<string, ChatPerson> = {
  [ME]: { userId: ME, name: "Mike Grochowski", avatarUrl: null, role: "owner" },
  [ANA]: { userId: ANA, name: "Ana Kowalska", avatarUrl: null, role: "member" },
  [BEN]: { userId: BEN, name: "Ben Ortiz", avatarUrl: null, role: "member" },
};
const online = new Set([ANA]);

const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();

function channel(id: string, extra: Partial<ChatChannel>): ChatChannel {
  return {
    id,
    workspaceId: "w",
    kind: "channel",
    name: id,
    topic: "",
    isPrivate: false,
    dmKey: null,
    createdBy: ME,
    createdAt: at(60 * 24 * 30),
    updatedAt: at(60),
    archivedAt: null,
    lastMessageAt: at(5),
    ...extra,
  };
}

const channels: ChatChannel[] = [
  channel("general", { topic: "Everyone in the workspace" }),
  channel("launch-plan", { topic: "October launch — scope, copy, dates" }),
  channel("design", { isPrivate: true }),
  channel("dm-ana", {
    kind: "dm",
    name: null,
    dmKey: [ME, ANA].sort().join(","),
    lastMessageAt: at(2),
  }),
  channel("dm-ben", {
    kind: "dm",
    name: null,
    dmKey: [ME, BEN].sort().join(","),
    lastMessageAt: at(90),
  }),
];

function msg(
  id: string,
  author: string,
  minAgo: number,
  body: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    workspaceId: "w",
    channelId: "launch-plan",
    parentId: null,
    authorId: author,
    authorKind: "user",
    authorLabel: null,
    body,
    mentionedUserIds: [],
    reactions: {},
    replyCount: 0,
    lastReplyAt: null,
    replyUserIds: [],
    pinnedAt: null,
    pinnedBy: null,
    editedAt: null,
    deletedAt: null,
    clientId: null,
    createdAt: at(minAgo),
    ...extra,
  };
}

const seed: ChatMessage[] = [
  msg(
    "m1",
    ANA,
    60 * 26,
    "Morning! Kicking off the **launch plan** here so it stops living in five places.",
  ),
  msg(
    "m2",
    ANA,
    60 * 26 - 1,
    "First pass of the timeline is in <moduo:task:" +
      TASK +
      "|Draft launch timeline> — comments welcome.",
  ),
  msg(
    "m3",
    BEN,
    60 * 3,
    "Read it. Two things:\n> pricing page needs the Duo plan\n> and the changelog should go out _before_ the email",
    {
      reactions: { "👍": [ANA, ME], "🎯": [ANA] },
    },
  ),
  msg("m4", ME, 42, "Agree on both. I'll take pricing. `/pricing` copy is in the brief.", {
    replyCount: 3,
    lastReplyAt: at(12),
    replyUserIds: [ANA, BEN],
    pinnedAt: at(40),
  }),
  msg(
    "m5",
    ANA,
    8,
    `<@${ME}> can you check the hero copy before 3? Link: https://moduo.app/launch`,
    {
      mentionedUserIds: [ME],
    },
  ),
  msg("m6", ANA, 7, "🎉"),
  msg("m7", ME, 1, "On it.", { pending: true, clientId: "c1" }),
];

const replies: ChatMessage[] = [
  msg("r1", ANA, 30, "I can do the screenshots for it.", { parentId: "m4" }),
  msg("r2", BEN, 20, "Changelog draft is ready, linking it here once Ana signs off.", {
    parentId: "m4",
  }),
  msg("r3", ANA, 12, "Signed off ✅", { parentId: "m4", reactions: { "🙌": [BEN] } }),
];

const members: ChatMember[] = [ME, ANA, BEN].map((userId) => ({
  channelId: "launch-plan",
  userId,
  workspaceId: "w",
  notifyLevel: "mentions",
  starred: false,
  lastReadAt: at(9),
  joinedAt: at(1000),
}));

function ChatFrame({ withThread, withDetails }: { withThread?: boolean; withDetails?: boolean }) {
  const [messages, setMessages] = useState(seed);
  const [active, setActive] = useState("launch-plan");
  const personOf = (id: string) => people[id];
  const isOnline = (id: string) => online.has(id);
  const titleOf = (c: ChatChannel) => channelTitle(c, ME, personOf);

  const entries: SidebarEntry[] = channels.map((c) => ({
    channel: c,
    unread: c.id === "general" ? 4 : c.id === "dm-ana" ? 2 : 0,
    mentions: c.id === "general" ? 1 : 0,
    starred: c.id === "launch-plan",
    muted: c.id === "design",
    isMember: true,
  }));
  const sections = buildSidebar(entries, titleOf);
  const rows = useMemo(
    () => buildTimeline(messages, { lastReadAt: at(9), selfId: ME }),
    [messages],
  );
  const current = channels.find((c) => c.id === active) ?? channels[1];

  const actions: MessageActions = {
    onReact: (m, e) =>
      setMessages((list) =>
        list.map((x) =>
          x.id === m.id ? { ...x, reactions: toggleReaction(x.reactions, e, ME) } : x,
        ),
      ),
    onReply: () => {},
    onStartEdit: () => {},
    onSaveEdit: () => {},
    onCancelEdit: () => {},
    onDelete: () => {},
    onPin: () => {},
    onMarkUnread: () => {},
    onCopyLink: () => {},
    onCopyText: () => {},
    onCreateTask: () => {},
    onRetry: () => {},
  };
  const composerBase = {
    runtime: null,
    workspaceId: "w",
    selfId: ME,
    people: Object.values(people),
  };

  return (
    <div className="flex h-[720px] gap-2 bg-background p-2">
      <aside className="w-64 shrink-0 rounded-xl border border-border bg-card p-2">
        <ChatSidebar
          sections={sections}
          activeChannelId={active}
          selfId={ME}
          titleOf={titleOf}
          personOf={personOf}
          isOnline={isOnline}
          onSelect={setActive}
          onNewChannel={() => {}}
          onNewMessage={() => {}}
          onBrowse={() => {}}
          onSwitcher={() => {}}
        />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
        <ConversationHeader
          channel={current}
          title={titleOf(current)}
          member={members[0]}
          selfId={ME}
          memberCount={3}
          personOf={personOf}
          isOnline={isOnline}
          canManage
          panel={withThread ? "thread" : withDetails ? "details" : null}
          onTogglePanel={() => {}}
          onTopic={async () => {}}
          onStar={() => {}}
          onNotify={() => {}}
          onMarkRead={() => {}}
          onLeave={() => {}}
          onArchive={() => {}}
          onJoin={() => {}}
        />
        <MessageList
          conversationKey={active}
          rows={rows}
          hasMore={false}
          loading={false}
          loaded
          onLoadOlder={() => {}}
          selfId={ME}
          renderMessage={(row) => (
            <MessageItem
              message={row.message}
              grouped={row.grouped}
              selfId={ME}
              personOf={personOf}
              isOnline={isOnline}
              editing={false}
              composerBase={composerBase}
              actions={actions}
            />
          )}
        />
        <div className="px-3 pb-3">
          <Composer
            {...composerBase}
            placeholder={`Message #${current.name ?? ""}`}
            onSubmit={(text) => setMessages((l) => [...l, msg(`n${l.length}`, ME, 0, text)])}
            typingLine="Ana Kowalska is typing…"
          />
        </div>
      </main>
      {withThread ? (
        <aside className="w-80 shrink-0 rounded-xl border border-border bg-card p-2">
          <ThreadPanel
            channelLabel="#launch-plan"
            loading={false}
            onClose={() => {}}
            composer={
              <Composer {...composerBase} placeholder="Reply…" compact onSubmit={() => {}} />
            }
          >
            <div className="border-b border-border pb-2">
              <MessageItem
                message={seed[3] as ChatMessage}
                grouped={false}
                selfId={ME}
                personOf={personOf}
                isOnline={isOnline}
                editing={false}
                composerBase={composerBase}
                inThread
                actions={actions}
              />
            </div>
            {replies.map((r) => (
              <MessageItem
                key={r.id}
                message={r}
                grouped={false}
                selfId={ME}
                personOf={personOf}
                isOnline={isOnline}
                editing={false}
                composerBase={composerBase}
                inThread
                actions={actions}
              />
            ))}
          </ThreadPanel>
        </aside>
      ) : null}
      {withDetails ? (
        <aside className="w-80 shrink-0 rounded-xl border border-border bg-card p-2">
          <DetailsPanel
            runtime={null}
            channel={current}
            title={titleOf(current)}
            selfId={ME}
            members={members}
            personOf={personOf}
            isOnline={isOnline}
            canManage
            onClose={() => {}}
            onAddPeople={() => {}}
            onRemove={() => {}}
            onOpenDm={() => {}}
            onJumpTo={() => {}}
            pinVersion={0}
          />
        </aside>
      ) : null}
    </div>
  );
}

const meta: Meta<typeof ChatFrame> = {
  title: "Features/Chat/Workspace",
  component: ChatFrame,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof ChatFrame>;

export const Conversation: Story = {};
export const WithThread: Story = { args: { withThread: true } };
export const WithDetails: Story = { args: { withDetails: true } };
export const Locked: Story = {
  render: () => (
    <div className="h-[720px] bg-background p-2">
      <div className="h-full rounded-xl border border-border bg-card">
        <ChatLocked isOwner />
      </div>
    </div>
  ),
};
