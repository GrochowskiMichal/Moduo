import { describe, expect, it } from "@rstest/core";

import { buildExportBundle, type ModuleReadResult } from "../settings/advanced";
import { type ChatExportReads, readChatExport, shapeChatExport } from "./export";
import type { ChatChannel, ChatKey, ChatMessage, ChatPerson } from "./model";

const ME = "me-0000-0000";
const ANA = "ana-0000-0000";

function msg(id: string, channelId: string, createdAt: string, extra: Partial<ChatMessage> = {}): ChatMessage {
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

/** A fake of the app's reads: pages newest-first on the wire, returned oldest first. */
function fakeReads(
  streams: Record<string, ChatMessage[]>,
  opts: { chains?: Record<string, ChatMessage[]>; refused?: string[]; files?: ChatExportReads["files"] } = {},
) {
  const calls = { page: 0, chain: [] as string[] };
  const reads: ChatExportReads = {
    async listChannels() {
      return Object.keys(streams).map((id) =>
        id.startsWith("dm") ? channel(id, { kind: "dm", name: null, dmKey: [ME, ANA].sort().join(",") }) : channel(id),
      );
    },
    async page({ channelId, before, limit }: { channelId: string; before?: ChatKey | null; limit: number }) {
      calls.page += 1;
      if (opts.refused?.includes(channelId)) {
        return { data: null, error: { code: "42501", message: "You can't read this conversation." } };
      }
      const all = streams[channelId] ?? [];
      const older = before
        ? all.filter((m) => m.createdAt < before.at || (m.createdAt === before.at && m.id < before.id))
        : all;
      return { data: older.slice(-limit), error: null };
    },
    async chain(rootId: string) {
      calls.chain.push(rootId);
      return { data: opts.chains?.[rootId] ?? [], error: null };
    },
    async people() {
      return { data: PEOPLE, error: null };
    },
    files: opts.files,
  };
  return { reads, calls };
}

describe("export and erasure: Chat in the lossless export (AC12.8)", () => {
  it("holds every conversation the reads return, every page of it, oldest first", async () => {
    const long = Array.from({ length: 450 }, (_, i) => msg(`g${String(i).padStart(3, "0")}`, "general", at(i)));
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

  it("reads a chain whose replies the pages didn't carry, and keeps reactions", async () => {
    const root = msg("r1", "general", at(1), { replyCount: 2, reactions: { "👍": [ME, ANA] } });
    const reply1 = msg("r1a", "general", at(2), { parentId: "r1", replyToId: "r1", authorId: ME });
    const reply2 = msg("r1b", "general", at(3), { parentId: "r1", replyToId: "r1a" });
    const { reads, calls } = fakeReads({ general: [root, reply1] }, { chains: { r1: [root, reply1, reply2] } });
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
    const { reads } = fakeReads({ general: [msg("g1", "general", at(1))], secret: [msg("s1", "secret", at(1))] }, {
      refused: ["secret"],
    });
    const out = await readChatExport(reads, "w", ME);
    const secret = out.data.conversations.find((c) => c.channel.id === "secret")!;
    expect(secret.messages).toEqual([]);
    expect(out.data.incomplete).toEqual([{ channelId: "secret", error: "You can't read this conversation." }]);
    expect(JSON.stringify(out)).not.toContain("body s1");
  });

  it("keeps the stored row, not the app's client-only state; a deleted message keeps no words", () => {
    const sent = msg("m1", "general", at(1), { sendState: "failed", sendError: "x", pending: true });
    const gone = msg("m2", "general", at(2), { deletedAt: at(3), body: "" });
    const out = shapeChatExport({
      people: PEOPLE,
      conversations: [{ channel: channel("general"), messages: [sent, gone] }],
      selfId: ME,
    });
    const m = out.data.conversations[0]!.messages[0]! as Record<string, unknown>;
    for (const key of ["sendState", "sendError", "pending", "failed", "clientId"]) expect(key in m).toBe(false);
    const md = Object.values(out.files)[0] as string;
    expect(md).toContain("_(deleted)_");
  });

  it("writes files as files: bytes under chat/files/, with safe paths", async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const { reads } = fakeReads(
      { general: [] },
      {
        files: async () => [
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
      { files: async () => [{ path: "a/b.txt", bytes: new Uint8Array([3]) }] },
    );
    const chat = await readChatExport(reads, "w", ME);
    const results: ModuleReadResult[] = [{ module: "chat", ok: true, data: chat.data, files: chat.files }];
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
});
