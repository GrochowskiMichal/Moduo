import { describe, expect, it } from "@rstest/core";

import { buildExportBundle, type ModuleReadResult } from "../settings/advanced";
import { type ChatExportReads, readChatExport, shapeChatExport, signedFileBytes } from "./export";
import type { ChatChannel, ChatFile, ChatKey, ChatMessage, ChatPerson } from "./model";

const ME = "me-0000-0000";
const ANA = "ana-0000-0000";

function msg(
  id: string,
  channelId: string,
  createdAt: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    workspaceId: "w",
    channelId,
    parentId: null,
    replyToId: null,
    kind: "message",
    event: null,
    formatVersion: 2,
    authorId: ANA,
    authorKind: "user",
    authorLabel: null,
    body: `body ${id}`,
    mentionedUserIds: [],
    mentionedTeamIds: [],
    mentionsEveryone: false,
    reactions: {},
    replyCount: 0,
    lastReplyAt: null,
    replyUserIds: [],
    wrappedAt: null,
    wrappedBy: null,
    settledId: null,
    reopenedAt: null,
    reopenedBy: null,
    pinnedAt: null,
    pinnedBy: null,
    editedAt: null,
    deletedAt: null,
    clientId: id,
    createdAt,
    updatedAt: createdAt,
    ...extra,
  };
}

function channel(id: string, extra: Partial<ChatChannel> = {}): ChatChannel {
  return {
    id,
    workspaceId: "w",
    kind: "channel",
    name: id,
    topic: "",
    isPrivate: false,
    dmKey: null,
    createdBy: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    archivedAt: null,
    lastMessageAt: null,
    ...extra,
  };
}

const PEOPLE: ChatPerson[] = [
  { userId: ME, name: "Maciej", avatarUrl: null, role: "owner" },
  { userId: ANA, name: "Ana", avatarUrl: null, role: "member" },
];

const at = (n: number) => new Date(Date.UTC(2026, 9, 10, 0, 0, n)).toISOString();

function file(id: string, messageId: string, sentAt: string, extra: Partial<ChatFile> = {}): ChatFile {
  return {
    id,
    messageId,
    authorId: ANA,
    fileName: `${id}.png`,
    mime: "image/png",
    sizeBytes: 4,
    width: null,
    height: null,
    objectPath: `w/chat/${id}`,
    previewPath: null,
    previewMime: null,
    sentAt,
    ...extra,
  };
}

/** `chat_files`: newest message first, at most 2 a page (so paging is exercised). */
function fakeFiles(byChannel: Record<string, ChatFile[]>): NonNullable<ChatExportReads["files"]> {
  return async ({ channelId, before }) => {
    if (byChannel[channelId] === undefined) {
      return { data: null, error: { code: "42501", message: "Not yours." } };
    }
    const all = [...byChannel[channelId]!].sort((a, b) =>
      a.sentAt === b.sentAt ? (a.id < b.id ? 1 : -1) : a.sentAt < b.sentAt ? 1 : -1,
    );
    const older = before
      ? all.filter((f) => f.sentAt < before.sentAt || (f.sentAt === before.sentAt && f.id < before.id))
      : all;
    return { data: older.slice(0, 2), error: null };
  };
}

function fakeBytes(byPath: Record<string, Uint8Array>): NonNullable<ChatExportReads["fileBytes"]> {
  return async (paths) => {
    const out = new Map<string, Uint8Array>();
    for (const p of paths) if (byPath[p]) out.set(p, byPath[p]!);
    return out;
  };
}

/** A fake of the app's reads: pages newest-first on the wire, returned oldest first. */
function fakeReads(
  streams: Record<string, ChatMessage[]>,
  opts: {
    chains?: Record<string, ChatMessage[]>;
    refused?: string[];
    extraFiles?: ChatExportReads["extraFiles"];
    chatFiles?: Record<string, ChatFile[]>;
    bytes?: Record<string, Uint8Array>;
    /** The server answers at most this many, whatever is asked. */
    cap?: number;
  } = {},
) {
  const calls = { page: 0, chain: [] as string[] };
  const reads: ChatExportReads = {
    async listChannels() {
      return Object.keys(streams).map((id) =>
        id.startsWith("dm")
          ? channel(id, { kind: "dm", name: null, dmKey: [ME, ANA].sort().join(",") })
          : channel(id),
      );
    },
    async page({
      channelId,
      before,
      limit,
    }: {
      channelId: string;
      before?: ChatKey | null;
      limit: number;
    }) {
      calls.page += 1;
      if (opts.refused?.includes(channelId)) {
        return {
          data: null,
          error: { code: "42501", message: "You can't read this conversation." },
        };
      }
      const all = streams[channelId] ?? [];
      const older = before
        ? all.filter(
            (m) => m.createdAt < before.at || (m.createdAt === before.at && m.id < before.id),
          )
        : all;
      return { data: older.slice(-Math.min(limit, opts.cap ?? limit)), error: null };
    },
    async chain(rootId: string) {
      calls.chain.push(rootId);
      return { data: opts.chains?.[rootId] ?? [], error: null };
    },
    async people() {
      return { data: PEOPLE, error: null };
    },
    extraFiles: opts.extraFiles,
    files: opts.chatFiles ? fakeFiles(opts.chatFiles) : undefined,
    fileBytes: opts.bytes ? fakeBytes(opts.bytes) : undefined,
  };
  return { reads, calls };
}

describe("export and erasure: Chat in the lossless export (AC12.8)", () => {
  it("holds every conversation the reads return, every page of it, oldest first", async () => {
    const long = Array.from({ length: 450 }, (_, i) =>
      msg(`g${String(i).padStart(3, "0")}`, "general", at(i)),
    );
    const { reads, calls } = fakeReads({ general: long, "dm-ana": [msg("d1", "dm-ana", at(1))] });
    const out = await readChatExport(reads, "w", ME);
    expect(out.data.conversations.map((c) => c.title)).toEqual(["general", "Ana"]);
    const general = out.data.conversations[0]!;
    expect(general.messages).toHaveLength(450);
    expect(general.messages[0]!.id).toBe("g000");
    expect(general.messages.at(-1)!.id).toBe("g449");
    expect(calls.page).toBeGreaterThan(3);
    expect(out.data.incomplete).toEqual([]);
  });

  it("keeps paging when the server answers fewer than asked", async () => {
    const long = Array.from({ length: 450 }, (_, i) =>
      msg(`g${String(i).padStart(3, "0")}`, "general", at(i)),
    );
    const { reads } = fakeReads({ general: long }, { cap: 50 });
    const out = await readChatExport(reads, "w", ME);
    expect(out.data.conversations[0]!.messages).toHaveLength(450);
  });

  it("reads a chain whose replies the pages didn't carry, and keeps reactions", async () => {
    const root = msg("r1", "general", at(1), { replyCount: 2, reactions: { "👍": [ME, ANA] } });
    const reply1 = msg("r1a", "general", at(2), { parentId: "r1", replyToId: "r1", authorId: ME });
    const reply2 = msg("r1b", "general", at(3), { parentId: "r1", replyToId: "r1a" });
    const { reads, calls } = fakeReads(
      { general: [root, reply1] },
      { chains: { r1: [root, reply1, reply2] } },
    );
    const out = await readChatExport(reads, "w", ME);
    expect(calls.chain).toEqual(["r1"]);
    const messages = out.data.conversations[0]!.messages;
    expect(messages.map((m) => m.id)).toEqual(["r1", "r1a", "r1b"]);
    expect(messages[0]!.reactions).toEqual({ "👍": [ME, ANA] });
    const md = out.files[Object.keys(out.files).find((k) => k.endsWith(".md"))!] as string;
    expect(md).toContain("# #general");
    expect(md).toContain("Reactions: 👍 Maciej, Ana");
    expect(md).toContain("**Maciej** · 2026-10-10T00:00:02.000Z · reply to Ana (r1)");
  });

  it("doesn't read a chain whose replies are all there", async () => {
    const root = msg("r1", "general", at(1), { replyCount: 1 });
    const reply = msg("r1a", "general", at(2), { parentId: "r1" });
    const { reads, calls } = fakeReads({ general: [root, reply] });
    await readChatExport(reads, "w", ME);
    expect(calls.chain).toEqual([]);
  });

  it("a conversation the server refuses is listed as incomplete, never filled in", async () => {
    const { reads } = fakeReads(
      { general: [msg("g1", "general", at(1))], secret: [msg("s1", "secret", at(1))] },
      {
        refused: ["secret"],
      },
    );
    const out = await readChatExport(reads, "w", ME);
    const secret = out.data.conversations.find((c) => c.channel.id === "secret")!;
    expect(secret.messages).toEqual([]);
    expect(out.data.incomplete).toEqual([
      { channelId: "secret", error: "You can't read this conversation." },
    ]);
    expect(JSON.stringify(out)).not.toContain("body s1");
  });

  it("keeps the stored row, not the app's client-only state; a deleted message keeps no words", () => {
    const sent = msg("m1", "general", at(1), {
      sendState: "failed",
      sendError: "x",
      pending: true,
    });
    const gone = msg("m2", "general", at(2), { deletedAt: at(3), body: "" });
    const out = shapeChatExport({
      people: PEOPLE,
      conversations: [{ channel: channel("general"), messages: [sent, gone] }],
      selfId: ME,
    });
    const m = out.data.conversations[0]!.messages[0]! as Record<string, unknown>;
    for (const key of ["sendState", "sendError", "pending", "failed", "clientId"])
      expect(key in m).toBe(false);
    const md = Object.values(out.files)[0] as string;
    expect(md).toContain("_(deleted)_");
  });

  it("writes files as files: bytes under chat/files/, with safe paths", async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const { reads } = fakeReads(
      { general: [] },
      {
        extraFiles: async () => [
          { path: "attachments/m1/photo.png", bytes: png },
          { path: "../../etc/passwd", bytes: new Uint8Array([1]) },
          { path: "emoji/party:parrot.gif", bytes: new Uint8Array([2]) },
        ],
      },
    );
    const out = await readChatExport(reads, "w", ME);
    expect(out.files["files/attachments/m1/photo.png"]).toBe(png);
    expect(out.files["files/etc/passwd"]).toBeInstanceOf(Uint8Array);
    expect(out.files["files/emoji/partyparrot.gif"]).toBeInstanceOf(Uint8Array);
    expect(Object.keys(out.files).some((k) => k.includes(".."))).toBe(false);
  });

  it("goes into the zip as chat.json plus chat/<conversation>.md and chat/files/…", async () => {
    const { reads } = fakeReads(
      { general: [msg("g1", "general", at(1))], "dm-ana": [] },
      { extraFiles: async () => [{ path: "a/b.txt", bytes: new Uint8Array([3]) }] },
    );
    const chat = await readChatExport(reads, "w", ME);
    const results: ModuleReadResult[] = [
      { module: "chat", ok: true, data: chat.data, files: chat.files },
    ];
    const bundle = buildExportBundle(results, {
      workspaceId: "w",
      exportedAt: "2026-10-16T00:00:00Z",
      appVersion: "1",
      appBuild: "x",
      platform: "web",
    });
    const names = Object.keys(bundle.entries).sort();
    expect(names).toContain("chat.json");
    expect(names).toContain("chat/files/a/b.txt");
    expect(names.filter((n) => n.startsWith("chat/") && n.endsWith(".md"))).toHaveLength(2);
    expect(bundle.entries["chat/files/a/b.txt"]).toBeInstanceOf(Uint8Array);
    expect(JSON.parse(bundle.entries["chat.json"] as string).conversations).toHaveLength(2);
  });

  it("writes every message's files you can read as bytes, listed in chat.json and linked from the Markdown", async () => {
    const m1 = msg("m1", "general", at(1));
    const m2 = msg("m2", "general", at(2));
    const files = [
      file("f1", "m1", at(1), { fileName: "photo.png" }),
      file("f2", "m1", at(1), { fileName: "photo.png" }),
      file("f3", "m2", at(2), { fileName: "notes.txt", mime: "text/plain" }),
      file("f4", "m2", at(2), { fileName: "gone.pdf" }),
      // A file whose message the export doesn't hold is left out.
      file("f5", "elsewhere", at(3)),
    ];
    const bytes = {
      "w/chat/f1": new Uint8Array([1]),
      "w/chat/f2": new Uint8Array([2]),
      "w/chat/f3": new Uint8Array([3]),
      "w/chat/f5": new Uint8Array([5]),
    };
    const { reads } = fakeReads({ general: [m1, m2] }, { chatFiles: { general: files }, bytes });
    const out = await readChatExport(reads, "w", ME);
    expect(out.files["files/attachments/m1/photo.png"]).toEqual(new Uint8Array([1]));
    expect(out.files["files/attachments/m1/photo (2).png"]).toEqual(new Uint8Array([2]));
    expect(out.files["files/attachments/m2/notes.txt"]).toEqual(new Uint8Array([3]));
    expect(Object.values(out.files)).not.toContainEqual(new Uint8Array([5]));
    const listed = out.data.conversations[0]!.files;
    expect(listed.map((f) => f.id).sort()).toEqual(["f1", "f2", "f3", "f4"]);
    expect(listed.find((f) => f.id === "f4")).toMatchObject({
      path: null,
      missing: "Couldn't be read.",
    });
    expect(listed.find((f) => f.id === "f2")!.path).toBe("files/attachments/m1/photo (2).png");
    const md = Object.entries(out.files).find(([k]) => k.endsWith(".md"))![1] as string;
    expect(md).toContain("Files: [photo.png](files/attachments/m1/photo.png)");
    expect(md).toContain("gone.pdf (Couldn't be read.)");
    expect(JSON.stringify(out.data)).not.toContain("w/chat/");
  });

  it("files of a conversation the server refuses aren't read; a refused file list is incomplete", async () => {
    const { reads } = fakeReads(
      { general: [msg("g1", "general", at(1))], secret: [msg("s1", "secret", at(1))] },
      {
        refused: ["secret"],
        chatFiles: { secret: [file("s", "s1", at(1))] },
        bytes: { "w/chat/s": new Uint8Array([9]) },
      },
    );
    const out = await readChatExport(reads, "w", ME);
    expect(Object.keys(out.files).some((k) => k.startsWith("files/"))).toBe(false);
    expect(out.data.incomplete).toEqual([
      { channelId: "general", error: "Files: Not yours." },
      { channelId: "secret", error: "You can't read this conversation." },
    ]);
  });

  it("stops writing bytes at the size budget and says so", async () => {
    const m1 = msg("m1", "general", at(1));
    const files = [
      file("a", "m1", at(1), { sizeBytes: 6 }),
      file("b", "m1", at(1), { sizeBytes: 6 }),
    ];
    const { reads } = fakeReads(
      { general: [m1] },
      {
        chatFiles: { general: files },
        bytes: { "w/chat/a": new Uint8Array(6), "w/chat/b": new Uint8Array(6) },
      },
    );
    const out = await readChatExport(reads, "w", ME, { fileBudget: 10 });
    const listed = out.data.conversations[0]!.files;
    expect(listed.filter((f) => f.path)).toHaveLength(1);
    expect(listed.filter((f) => f.missing === "Over the export's size limit.")).toHaveLength(1);
  });

  it("reads bytes through signed links only; a failed fetch is left out", async () => {
    const fetchImpl = (async (url: string) =>
      url === "https://signed/a"
        ? new Response(new Uint8Array([7]))
        : new Response("no", { status: 403 })) as unknown as typeof fetch;
    const read = signedFileBytes(
      async (paths) => new Map(paths.map((p) => [p, `https://signed/${p}`])),
      fetchImpl,
    );
    const got = await read(["a", "b"]);
    expect([...got.keys()]).toEqual(["a"]);
    expect(got.get("a")).toEqual(new Uint8Array([7]));
  });
});
