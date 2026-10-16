// Chat in the lossless workspace export (CV-22, AC12.8; specs/chat-v2.md
// §Edge cases "The export", round-3 §2.25 i, #31). Every conversation you can
// read, through the same reads the app uses (so the same read rules: a
// conversation you can't read never comes back), with its chains and
// reactions, as JSON (`chat.json`, the stored bodies verbatim) plus one
// Markdown file per conversation (`chat/<title>-<id>.md`). Files that belong
// to messages (attachments, custom emoji images) go in as files under
// `chat/files/` through `files`, the hook the blocks that make them fill.

import type {
  ChatChannel,
  ChatKey,
  ChatMessage,
  ChatPerson,
  ChatResult,
  ChatRuntime,
} from "./model";
import { keyOf } from "./store/keys";
import { channelTitle } from "./timeline";

/** The reads the export needs (a slice of ChatRuntime, so tests pass fakes). */
export type ChatExportReads = Pick<ChatRuntime, "listChannels" | "page" | "chain" | "people"> & {
  /** Files that belong to the workspace's messages you can read, as bytes. */
  files?: (workspaceId: string) => Promise<ChatExportFile[]>;
};

export type ChatExportFile = { path: string; bytes: Uint8Array };

/** A message as the export keeps it: the stored row, no client-only state. */
export type ChatExportMessage = Omit<
  ChatMessage,
  "sendState" | "sendError" | "pending" | "failed" | "clientId"
>;

export type ChatExportConversation = {
  channel: ChatChannel;
  title: string;
  messages: ChatExportMessage[];
};

export type ChatExport = {
  /** `chat.json`. */
  data: {
    formatVersion: 2;
    people: { userId: string; name: string; former: boolean }[];
    conversations: ChatExportConversation[];
    /** Conversations whose messages couldn't all be read, with why. */
    incomplete: { channelId: string; error: string }[];
  };
  /** Paths under `chat/` → contents. */
  files: Record<string, string | Uint8Array>;
};

const PAGE = 200;

function unwrap<T>(result: ChatResult<T>): T {
  if (result.error) throw new Error(result.error.message || "Couldn't read chat.");
  return result.data;
}

function exportMessage(m: ChatMessage): ChatExportMessage {
  const { sendState: _s, sendError: _e, pending: _p, failed: _f, clientId: _c, ...rest } = m;
  return rest;
}

/** Every message of one conversation, oldest first, plus the replies of chains its pages didn't carry. */
async function readConversation(reads: ChatExportReads, channelId: string): Promise<ChatMessage[]> {
  const byId = new Map<string, ChatMessage>();
  let before: ChatKey | null = null;
  for (;;) {
    const page = unwrap(await reads.page({ channelId, before, limit: PAGE }));
    for (const m of page) byId.set(m.id, m);
    if (page.length < PAGE) break;
    const next = keyOf(page[0]!);
    if (before && next.at === before.at && next.id === before.id) break;
    before = next;
  }
  // A chain's replies are in the stream; read the chain itself when its root
  // counts more replies than the pages brought (a wrapped or older chain).
  for (const root of [...byId.values()]) {
    if (root.replyCount <= 0) continue;
    let seen = 0;
    for (const m of byId.values()) if (m.parentId === root.id) seen += 1;
    if (seen >= root.replyCount) continue;
    for (const m of unwrap(await reads.chain(root.id))) {
      if (m.channelId === channelId) byId.set(m.id, m);
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1,
  );
}

/** Read Chat for the export. Throws only when the conversation list can't be read. */
export async function readChatExport(
  reads: ChatExportReads,
  workspaceId: string,
  selfId: string,
): Promise<ChatExport> {
  const people = unwrap(await reads.people(workspaceId));
  const channels = await reads.listChannels(workspaceId);
  const conversations: { channel: ChatChannel; messages: ChatMessage[] }[] = [];
  const incomplete: { channelId: string; error: string }[] = [];
  for (const channel of channels) {
    try {
      conversations.push({ channel, messages: await readConversation(reads, channel.id) });
    } catch (err) {
      incomplete.push({
        channelId: channel.id,
        error: err instanceof Error ? err.message : String(err),
      });
      conversations.push({ channel, messages: [] });
    }
  }
  const files = reads.files ? await reads.files(workspaceId) : [];
  return shapeChatExport({ people, conversations, incomplete, files, selfId });
}

/** One path part, safe in a zip: no separators or control characters, no leading or trailing dots. */
function cleanPart(text: string): string {
  return (
    text
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it removes
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
      .replace(/^[\s.]+|[\s.]+$/g, "")
      .slice(0, 120)
  );
}

function safeStem(text: string): string {
  const clean = cleanPart(text)
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return clean || "conversation";
}

function reactionLine(
  reactions: ChatExportMessage["reactions"],
  nameOf: (id: string) => string,
): string | null {
  const parts = Object.entries(reactions)
    .filter(([, ids]) => ids.length > 0)
    .map(([key, ids]) => `${key} ${ids.map(nameOf).join(", ")}`);
  return parts.length ? `Reactions: ${parts.join(" · ")}` : null;
}

/** One conversation as Markdown: who, when, the stored text; replies marked. */
export function conversationMarkdown(
  conversation: ChatExportConversation,
  nameOf: (id: string) => string,
): string {
  const { channel, title, messages } = conversation;
  const heading = channel.kind === "channel" ? `#${title}` : title;
  const lines: string[] = [`# ${heading}`, ""];
  if (channel.topic) lines.push(channel.topic, "");
  const byId = new Map(messages.map((m) => [m.id, m]));
  for (const m of messages) {
    if (m.kind === "event") continue;
    const who = m.authorId ? nameOf(m.authorId) : `${m.authorLabel ?? "An app"} (app)`;
    const parent = m.parentId ? byId.get(m.parentId) : null;
    const reply = m.parentId
      ? ` · reply to ${parent?.authorId ? nameOf(parent.authorId) : "a message"} (${m.parentId})`
      : "";
    const edited = m.editedAt && !m.deletedAt ? " · edited" : "";
    lines.push(`**${who}** · ${m.createdAt}${reply}${edited}`);
    lines.push(m.deletedAt ? "_(deleted)_" : m.body);
    const reacted = m.deletedAt ? null : reactionLine(m.reactions, nameOf);
    if (reacted) lines.push("", reacted);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Shape the export from what was read. Pure. */
export function shapeChatExport(input: {
  people: ChatPerson[];
  conversations: { channel: ChatChannel; messages: ChatMessage[] }[];
  incomplete?: { channelId: string; error: string }[];
  files?: ChatExportFile[];
  selfId: string;
}): ChatExport {
  const personById = new Map(input.people.map((p) => [p.userId, p]));
  const personOf = (id: string) => personById.get(id);
  const nameOf = (id: string) => personById.get(id)?.name ?? "Former member";
  const conversations: ChatExportConversation[] = input.conversations.map(
    ({ channel, messages }) => ({
      channel,
      title: channelTitle(channel, input.selfId, personOf),
      messages: messages.map(exportMessage),
    }),
  );
  const files: Record<string, string | Uint8Array> = {};
  for (const conversation of conversations) {
    const name = `${safeStem(conversation.title)}-${conversation.channel.id.slice(0, 8)}.md`;
    files[name] = conversationMarkdown(conversation, nameOf);
  }
  for (const file of input.files ?? []) {
    // Each part cleaned on its own: no separators, no "..", no leading dots.
    const path = file.path.split("/").map(cleanPart).filter(Boolean).join("/");
    if (path) files[`files/${path}`] = file.bytes;
  }
  return {
    data: {
      formatVersion: 2,
      people: input.people.map((p) => ({
        userId: p.userId,
        name: p.name,
        former: Boolean(p.former),
      })),
      conversations,
      incomplete: input.incomplete ?? [],
    },
    files,
  };
}
