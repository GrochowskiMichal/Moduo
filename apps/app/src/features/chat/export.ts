// Chat in the lossless workspace export (CV-22, AC12.8; specs/chat-v2.md
// §Edge cases "The export", round-3 §2.25 i, #31). Every conversation you can
// read, through the same reads the app uses (so the same read rules: a
// conversation you can't read never comes back), with its chains and
// reactions, as JSON (`chat.json`, the stored bodies verbatim) plus one
// Markdown file per conversation (`chat/<title>-<id>.md`). Files go in as
// files under `chat/files/`: every message's attachments you can read (CV-9's
// `chat_files` read, then the stored bytes through signed links), and, through
// `extraFiles`, files no message holds (CV-20's custom emoji images).

import type {
  ChatChannel,
  ChatFile,
  ChatKey,
  ChatMessage,
  ChatPerson,
  ChatResult,
  ChatRuntime,
} from "./model";
import { compareKeys, compareRows, keyOf } from "./store/keys";
import { channelTitle } from "./timeline";

/** The reads the export needs (a slice of ChatRuntime, so tests pass fakes). */
export type ChatExportReads = Pick<ChatRuntime, "listChannels" | "page" | "chain" | "people"> &
  Partial<Pick<ChatRuntime, "files">> & {
    /** The stored bytes of these object paths; a path missing from the answer couldn't be read. */
    fileBytes?: (objectPaths: string[]) => Promise<Map<string, Uint8Array>>;
    /** Files no message holds (CV-20: custom emoji images), as bytes. */
    extraFiles?: (workspaceId: string) => Promise<ChatExportFile[]>;
  };

export type ChatExportFile = { path: string; bytes: Uint8Array };

/** A message's file as `chat.json` lists it; `path` (under `chat/`) is null when its bytes aren't in the zip. */
export type ChatExportFileEntry = {
  id: string;
  messageId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  path: string | null;
  /** Why the bytes aren't in the zip. */
  missing?: string;
};

/** A message as the export keeps it: the stored row, no client-only state. */
export type ChatExportMessage = Omit<
  ChatMessage,
  "sendState" | "sendError" | "pending" | "failed" | "clientId"
>;

export type ChatExportConversation = {
  channel: ChatChannel;
  title: string;
  messages: ChatExportMessage[];
  files: ChatExportFileEntry[];
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
const FILE_PAGE = 200;
/** Files fetched at once. */
const FILE_BATCH = 6;
/** A path part's longest length in the zip. */
const PART_MAX = 120;
/**
 * All of chat's file bytes in one export: the zip is built in memory (and
 * copied once more when it's packed), so the bytes stay well inside what a
 * browser tab or the desktop's web view holds. Files past it are listed with
 * why they're missing.
 */
export const CHAT_EXPORT_FILE_BUDGET = 256 * 1024 * 1024;

function unwrap<T>(result: ChatResult<T>): T {
  if (result.error) throw new Error(result.error.message || "Couldn't read chat.");
  return result.data;
}

function exportMessage(m: ChatMessage): ChatExportMessage {
  const { sendState: _s, sendError: _e, pending: _p, failed: _f, clientId: _c, ...rest } = m;
  return rest;
}

/**
 * Every message of one conversation, oldest first, plus the replies of chains
 * its pages didn't carry. A chain that can't be read keeps what the pages
 * brought and is named in `chainErrors`.
 */
async function readConversation(
  reads: ChatExportReads,
  channelId: string,
): Promise<{ messages: ChatMessage[]; chainErrors: string[] }> {
  const byId = new Map<string, ChatMessage>();
  const chainErrors: string[] = [];
  let before: ChatKey | null = null;
  for (;;) {
    const page = unwrap(await reads.page({ channelId, before, limit: PAGE }));
    for (const m of page) byId.set(m.id, m);
    // Only an empty page ends it: the server may answer fewer than asked.
    if (page.length === 0) break;
    const next = keyOf(page[0]!);
    if (before && next.at === before.at && next.id === before.id) break;
    before = next;
  }
  // A chain's replies are in the stream; read the chain itself when its root
  // counts more replies than the pages brought (a wrapped or older chain).
  const seen = new Map<string, number>();
  for (const m of byId.values()) {
    if (m.parentId) seen.set(m.parentId, (seen.get(m.parentId) ?? 0) + 1);
  }
  for (const root of [...byId.values()]) {
    if (root.replyCount <= 0 || (seen.get(root.id) ?? 0) >= root.replyCount) continue;
    try {
      for (const m of unwrap(await reads.chain(root.id))) {
        if (m.channelId === channelId) byId.set(m.id, m);
      }
    } catch (err) {
      chainErrors.push(`Chain ${root.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { messages: [...byId.values()].sort(compareRows), chainErrors };
}

/** Every file of one conversation (the server's read rule: only what you may read). */
async function readConversationFiles(
  files: NonNullable<ChatExportReads["files"]>,
  channelId: string,
): Promise<ChatFile[]> {
  const out = new Map<string, ChatFile>();
  let before: { sentAt: string; id: string } | null = null;
  for (;;) {
    const page: ChatFile[] = unwrap(await files({ channelId, before, limit: FILE_PAGE }));
    if (page.length === 0) break;
    for (const f of page) out.set(f.id, f);
    const last: ChatFile = page[page.length - 1]!;
    if (before && last.sentAt === before.sentAt && last.id === before.id) break;
    before = { sentAt: last.sentAt, id: last.id };
  }
  // Oldest first, so a repeated name's numbering follows the order they were sent.
  return [...out.values()].sort((a, b) =>
    compareKeys({ at: a.sentAt, id: a.id }, { at: b.sentAt, id: b.id }),
  );
}

/**
 * A file's place under `chat/files/`: `attachments/<message>/<name>`, a
 * repeated name numbered. Every part is already as `cleanPart` leaves it (a
 * numbered name stays within its length), so the zip's path, `chat.json` and
 * the Markdown link agree.
 */
function attachmentPath(file: ChatFile, taken: Set<string>): string {
  const dir = `attachments/${cleanPart(file.messageId) || "message"}`;
  const name = cleanPart(file.fileName) || "file";
  const dot = name.lastIndexOf(".");
  const [stem, ext] =
    dot > 0 && name.length - dot <= 16 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  let path = `${dir}/${name}`;
  for (let n = 2; taken.has(path); n += 1) {
    const suffix = ` (${n})${ext}`;
    path = `${dir}/${stem.slice(0, PART_MAX - suffix.length).trimEnd()}${suffix}`;
  }
  taken.add(path);
  return path;
}

/** The bytes of every listed file, in batches, within the budget; what's left out says why. */
async function readFileBytes(
  reads: ChatExportReads,
  perConversation: ChatFile[][],
  budget: number,
): Promise<{ entries: ChatExportFileEntry[][]; files: ChatExportFile[] }> {
  const taken = new Set<string>();
  const files: ChatExportFile[] = [];
  let left = budget;
  const listed = perConversation.map((list) =>
    list.map((file) => {
      const entry: ChatExportFileEntry = {
        id: file.id,
        messageId: file.messageId,
        fileName: file.fileName,
        mime: file.mime,
        sizeBytes: file.sizeBytes,
        path: null,
      };
      if (!reads.fileBytes) entry.missing = "Files weren't read.";
      else if (file.sizeBytes > left) entry.missing = "Over the export's size limit.";
      else left -= Math.max(0, file.sizeBytes);
      return { entry, file };
    }),
  );
  const wanted = listed.flat().filter((x) => !x.entry.missing);
  for (let i = 0; i < wanted.length; i += FILE_BATCH) {
    const batch = wanted.slice(i, i + FILE_BATCH);
    let bytes = new Map<string, Uint8Array>();
    try {
      bytes = (await reads.fileBytes?.(batch.map((x) => x.file.objectPath))) ?? bytes;
    } catch {
      // Each file of the batch is listed as unread below.
    }
    for (const { entry, file } of batch) {
      const got = bytes.get(file.objectPath);
      if (!got) {
        entry.missing = "Couldn't be read.";
        continue;
      }
      const path = attachmentPath(file, taken);
      entry.path = `files/${path}`;
      files.push({ path, bytes: got });
    }
  }
  return { entries: listed.map((list) => list.map((x) => x.entry)), files };
}

/**
 * Read stored files through signed links (a link is only signed for a path
 * the attachments bucket's rules let you read). A file that can't be read is
 * left out of the answer.
 */
export function signedFileBytes(
  sign: (paths: string[], ttlSeconds: number) => Promise<Map<string, string>>,
  fetchImpl: typeof fetch = fetch,
): (objectPaths: string[]) => Promise<Map<string, Uint8Array>> {
  return async (paths) => {
    const out = new Map<string, Uint8Array>();
    if (paths.length === 0) return out;
    const urls = await sign(paths, 600);
    await Promise.all(
      paths.map(async (path) => {
        const url = urls.get(path);
        if (!url) return;
        try {
          const res = await fetchImpl(url);
          if (res.ok) out.set(path, new Uint8Array(await res.arrayBuffer()));
        } catch {
          // Left out: listed as unread.
        }
      }),
    );
    return out;
  };
}

/**
 * Read Chat for the export. Throws only when the conversation list can't be
 * read; anything else that can't be read is named in `incomplete` (people's
 * names fall back to "Former member").
 */
export async function readChatExport(
  reads: ChatExportReads,
  workspaceId: string,
  selfId: string,
  opts: { fileBudget?: number } = {},
): Promise<ChatExport> {
  const incomplete: { channelId: string; error: string }[] = [];
  const why = (err: unknown) => (err instanceof Error ? err.message : String(err));
  let people: ChatPerson[] = [];
  try {
    people = unwrap(await reads.people(workspaceId));
  } catch (err) {
    incomplete.push({ channelId: "", error: `People: ${why(err)}` });
  }
  const channels = await reads.listChannels(workspaceId);
  const conversations: { channel: ChatChannel; messages: ChatMessage[] }[] = [];
  const listed: ChatFile[][] = [];
  for (const channel of channels) {
    let messages: ChatMessage[];
    try {
      const read = await readConversation(reads, channel.id);
      messages = read.messages;
      for (const error of read.chainErrors) incomplete.push({ channelId: channel.id, error });
    } catch (err) {
      incomplete.push({
        channelId: channel.id,
        error: err instanceof Error ? err.message : String(err),
      });
      conversations.push({ channel, messages: [] });
      listed.push([]);
      continue;
    }
    conversations.push({ channel, messages });
    let files: ChatFile[] = [];
    if (reads.files) {
      try {
        // Only files of messages the export holds.
        const held = new Set(messages.map((m) => m.id));
        files = (await readConversationFiles(reads.files, channel.id)).filter((f) =>
          held.has(f.messageId),
        );
      } catch (err) {
        incomplete.push({
          channelId: channel.id,
          error: `Files: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    listed.push(files);
  }
  const read = await readFileBytes(reads, listed, opts.fileBudget ?? CHAT_EXPORT_FILE_BUDGET);
  let extra: ChatExportFile[] = [];
  try {
    extra = reads.extraFiles ? await reads.extraFiles(workspaceId) : [];
  } catch (err) {
    incomplete.push({ channelId: "", error: `Files: ${why(err)}` });
  }
  return shapeChatExport({
    people,
    conversations: conversations.map((c, i) => ({ ...c, files: read.entries[i] ?? [] })),
    incomplete,
    files: [...read.files, ...extra],
    selfId,
  });
}

/** One path part, safe in a zip: no separators or control characters, no leading or trailing dots. */
function cleanPart(text: string): string {
  return (
    text
      // Also the direction overrides that could disguise a name's ending.
      // eslint-disable-next-line no-control-regex -- control characters are what it removes
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/g, "")
      .replace(/^[\s.]+|[\s.]+$/g, "")
      .slice(0, PART_MAX)
      // Cut again after the cut, so cleaning a clean part changes nothing.
      .replace(/[\s.]+$/g, "")
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
  const filesOf = new Map<string, ChatExportFileEntry[]>();
  for (const f of conversation.files ?? []) {
    filesOf.set(f.messageId, [...(filesOf.get(f.messageId) ?? []), f]);
  }
  const heading = channel.kind === "channel" ? `#${title}` : title;
  const lines: string[] = [`# ${heading}`, ""];
  if (channel.topic) lines.push(channel.topic, "");
  const byId = new Map(messages.map((m) => [m.id, m]));
  for (const m of messages) {
    if (m.kind === "event") continue;
    const who = !m.authorId
      ? `${m.authorLabel ?? "An app"} (app)`
      : m.authorKind === "api_key"
        ? `${nameOf(m.authorId)} · via ${m.authorLabel ?? "an app"}`
        : nameOf(m.authorId);
    const parent = m.parentId ? byId.get(m.parentId) : null;
    const reply = m.parentId
      ? ` · reply to ${parent?.authorId ? nameOf(parent.authorId) : "a message"} (${m.parentId})`
      : "";
    const edited = m.editedAt && !m.deletedAt ? " · edited" : "";
    lines.push(`**${who}** · ${m.createdAt}${reply}${edited}`);
    lines.push(m.deletedAt ? "_(deleted)_" : m.body);
    const attached = m.deletedAt ? [] : (filesOf.get(m.id) ?? []);
    if (attached.length > 0) {
      const named = attached.map((f) =>
        f.path
          ? `[${f.fileName.replace(/[[\]\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/g, "")}](${f.path.split("/").map(encodeURIComponent).join("/")})`
          : `${f.fileName} (${f.missing ?? "not in the export"})`,
      );
      lines.push("", `Files: ${named.join(" · ")}`);
    }
    const reacted = m.deletedAt ? null : reactionLine(m.reactions, nameOf);
    if (reacted) lines.push("", reacted);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Shape the export from what was read. Pure. */
export function shapeChatExport(input: {
  people: ChatPerson[];
  conversations: {
    channel: ChatChannel;
    messages: ChatMessage[];
    files?: ChatExportFileEntry[];
  }[];
  incomplete?: { channelId: string; error: string }[];
  files?: ChatExportFile[];
  selfId: string;
}): ChatExport {
  const personById = new Map(input.people.map((p) => [p.userId, p]));
  const personOf = (id: string) => personById.get(id);
  const nameOf = (id: string) => personById.get(id)?.name ?? "Former member";
  const conversations: ChatExportConversation[] = input.conversations.map(
    ({ channel, messages, files }) => ({
      channel,
      title: channelTitle(channel, input.selfId, personOf),
      messages: messages.map(exportMessage),
      files: files ?? [],
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
