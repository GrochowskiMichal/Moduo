/**
 * CV-21: the ten chat tools of §14, with their scopes, in lockstep with the
 * manifest. Each tool is one RPC whose rules live in the database
 * (supabase/tests/chat_agents.test.sql proves them as a key); here: which
 * tools a key sees at each level, that no chat tool reads a table directly
 * (the service role bypasses RLS), what each tool sends, and "via <key>".
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, rs } from "@rstest/core";
import { chatModuleManifest } from "../../../src/features/chat/ops-manifest";
import { byline, chatConnectorModule, conversation, readable } from "./modules/chat";
import { type KeyContext, toolsForKey } from "./registry";

rs.mock("https://esm.sh/rrule@2.8.1?target=deno", () => ({ RRule: class {} }));

const DIR = dirname(fileURLToPath(import.meta.url));
const WS = "11111111-1111-4111-8111-111111111111";
const MSG = "22222222-2222-4222-8222-222222222222";
const CH = "33333333-3333-4333-8333-333333333333";

function key(scopes: Record<string, string>): KeyContext {
  return { id: "k", workspaceId: WS, name: "CI key", createdBy: "u", scopes };
}

/** A supabase-js stand-in that records RPC calls and refuses table reads. */
function fakeDb(answers: Record<string, unknown> = {}) {
  const calls: Array<{ fn: string; params: Record<string, unknown> }> = [];
  const db = {
    rpc: async (fn: string, params: Record<string, unknown>) => {
      calls.push({ fn, params });
      return { data: answers[fn] ?? [], error: null };
    },
    from: (table: string) => {
      throw new Error(`table read: ${table}`);
    },
  };
  return { db: db as never, calls };
}

const TOOLS = [
  "chat_list_channels",
  "chat_read",
  "chat_search",
  "chat_addressed_to_me",
  "chat_post",
  "chat_reply",
  "chat_react",
  "chat_mark_decision",
  "chat_wrap_up",
  "chat_create_channel",
];

function tool(name: string) {
  const t = chatConnectorModule.tools.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

describe("chat tools: the ten of §14 and their scopes (AC15.1)", () => {
  it("are exactly the ten tools", () => {
    expect(chatConnectorModule.tools.map((t) => t.name).sort()).toEqual([...TOOLS].sort());
  });

  it("None sees no chat tool, View the four reads, Edit all ten", () => {
    const names = (scopes: Record<string, string>) =>
      toolsForKey(key(scopes))
        .map((t) => t.name)
        .filter((n) => n.startsWith("chat_"))
        .sort();
    expect(names({ chat: "none" })).toEqual([]);
    expect(names({ tasks: "edit" })).toEqual([]);
    expect(names({ chat: "view" })).toEqual(
      ["chat_addressed_to_me", "chat_list_channels", "chat_read", "chat_search"].sort(),
    );
    expect(names({ chat: "edit" })).toEqual([...TOOLS].sort());
  });

  it("never reads a table: every chat tool goes through one RPC", () => {
    const src = readFileSync(resolve(DIR, "modules/chat.ts"), "utf8");
    expect(src).not.toMatch(/\.from\(/);
  });

  it("each write is the manifest's agent op, in lockstep", () => {
    const src = readFileSync(resolve(DIR, "modules/chat.ts"), "utf8");
    for (const op of chatModuleManifest.ops) {
      expect(src).toContain(`"${op.rpc}"`);
      expect(op.rpc.startsWith("chat_op_agent_")).toBe(true);
    }
  });
});

describe("chat tools: what they send", () => {
  it("chat_reply sends only the message it answers (the server finds the conversation)", async () => {
    const { db, calls } = fakeDb({ chat_op_agent_post: { id: "m", parent_id: MSG, reply_to_id: MSG } });
    const out = await tool("chat_reply").handler({ message_id: MSG, text: "on it" }, { key: key({ chat: "edit" }), db });
    expect(calls).toEqual([
      {
        fn: "chat_op_agent_post",
        params: { p_workspace_id: WS, p_channel_id: null, p_body: "on it", p_parent_id: MSG },
      },
    ]);
    expect(out).toMatchObject({ id: "m", chain_root_id: MSG });
  });

  it("refuses a message id that isn't a canonical uuid before calling", async () => {
    const { db, calls } = fakeDb();
    await expect(
      tool("chat_react").handler({ message_id: "{" + MSG + "}", emoji: "👍" }, { key: key({ chat: "edit" }), db }),
    ).rejects.toThrow("message_id must be a message id.");
    expect(calls).toEqual([]);
  });

  it("finds a conversation by its name as typed, never lower-cased", async () => {
    const list = [{ id: CH, name: "Release Train" }];
    const { db } = fakeDb({ chat_agent_conversations: list });
    const ctx = { key: key({ chat: "view" }), db };
    expect((await conversation(ctx, "#Release Train")).id).toBe(CH);
    expect((await conversation(ctx, "Release Train")).id).toBe(CH);
    await expect(conversation(ctx, "release train")).rejects.toThrow('No conversation "release train"');
  });

  it("chat_read pages back from a message id; a post through a key reads \"<person> · via <key>\"", async () => {
    const { db, calls } = fakeDb({
      chat_agent_conversations: [{ id: CH, name: "builds" }],
      chat_agent_messages: [
        { id: "b", author_id: "u", author_name: "Alex", via: "CI key", body: "green", created_at: "2" },
        { id: "a", author_id: "v", author_name: "Sam", via: null, body: "go", created_at: "1" },
      ],
    });
    const out = (await tool("chat_read").handler(
      { channel: "builds", before: MSG, limit: 2 },
      { key: key({ chat: "view" }), db },
    )) as { messages: Array<{ id: string; author: { name: string } }>; more: unknown };
    expect(calls[1]).toEqual({
      fn: "chat_agent_messages",
      params: { p_channel_id: CH, p_root_id: null, p_before: null, p_before_id: MSG, p_limit: 2 },
    });
    expect(out.messages.map((m) => [m.id, m.author.name])).toEqual([
      ["a", "Sam"],
      ["b", "Alex · via CI key"],
    ]);
    expect(out.more).toEqual({ before: "a" });
  });

  it("chat_read still reads v1's thread_id as the chain", async () => {
    const { db, calls } = fakeDb({ chat_agent_conversations: [{ id: CH, name: "builds" }] });
    await tool("chat_read").handler({ channel: CH, thread_id: MSG }, { key: key({ chat: "view" }), db });
    expect(calls[1].params).toMatchObject({ p_root_id: MSG });
  });

  it("chat_post with a conversation id posts first (the server checks it)", async () => {
    const { db, calls } = fakeDb({ chat_op_agent_post: { id: "m", channel_id: CH } });
    await tool("chat_post").handler({ channel: CH, text: "hi" }, { key: key({ chat: "edit" }), db });
    // No lookup before the post; its name is read after, for the answer.
    expect(calls[0]?.fn).toBe("chat_op_agent_post");
  });

  it("chat_post still answers the channel's name (v1 agents read it)", async () => {
    const { db } = fakeDb({
      chat_agent_conversations: [{ id: CH, name: "builds" }],
      chat_op_agent_post: { id: "m", channel_id: CH },
    });
    const out = await tool("chat_post").handler({ channel: "#builds", text: "hi" }, { key: key({ chat: "edit" }), db });
    expect(out).toMatchObject({ channel: "builds", channel_id: CH });
  });

  it("chat_search with a conversation id the key can't read says so, like a name", async () => {
    const { db, calls } = fakeDb({ chat_agent_conversations: [] });
    await expect(
      tool("chat_search").handler({ query: "x", channel: CH }, { key: key({ chat: "view" }), db }),
    ).rejects.toThrow(`No conversation "${CH}"`);
    expect(calls.map((c) => c.fn)).toEqual(["chat_agent_conversations"]);
  });

  it("refuses a name that matches more than one conversation", async () => {
    const { db } = fakeDb({
      chat_agent_conversations: [
        { id: CH, name: "x" },
        { id: MSG, name: "x" },
      ],
    });
    const ctx = { key: key({ chat: "view" }), db };
    await expect(conversation(ctx, "x")).rejects.toThrow(
      'Two conversations are named "x"; use its id from chat_list_channels.',
    );
    expect((await conversation(ctx, CH)).id).toBe(CH);
  });

  it("chat_create_channel sends the name as typed", async () => {
    const { db, calls } = fakeDb({ chat_op_agent_create_channel: { id: CH, name: "Release Train", is_private: false } });
    await tool("chat_create_channel").handler({ name: "Release Train" }, { key: key({ chat: "edit" }), db });
    expect(calls[0].params).toEqual({ p_workspace_id: WS, p_name: "Release Train", p_topic: "", p_is_private: false });
  });
});

describe("chat tools: helpers", () => {
  it("byline names the person, then the key", () => {
    expect(byline("Alex", "CI key")).toBe("Alex · via CI key");
    expect(byline("Alex", null)).toBe("Alex");
  });
  it("readable drops Moduo link targets and keeps their words", () => {
    expect(readable(`hi [@Sam](moduo://person/${MSG}) see [MOD-1](moduo://task/${MSG})`)).toBe("hi @Sam see MOD-1");
  });
});
