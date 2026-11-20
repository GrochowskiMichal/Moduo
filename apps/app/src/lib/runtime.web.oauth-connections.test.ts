// The consent screen's two calls (MCPO-5 follow-up): the other connections
// to the same app are read from workspace_api_keys_oauth_request, and Approve
// sends p_replace_ids only when something is ticked, so it keeps working
// against a database without that argument. Runs the real runtime over a
// recording stand-in for the Supabase client.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";

type Rpc = { fn: string; args: Record<string, unknown> };
const recorded = rs.hoisted(() => ({
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  /** What each rpc answers; a function sees the args. */
  answers: {} as Record<
    string,
    (args: Record<string, unknown>) => { data: unknown; error: unknown }
  >,
  user: "00000000-0000-4000-8000-0000000000a1",
}));

rs.mock("@supabase/supabase-js", () => {
  const chain = (payload: Record<string, unknown> | null): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown) =>
              Promise.resolve({ data: payload ?? {}, error: null }).then(resolve);
          }
          return (...args: unknown[]) => {
            return chain(payload);
          };
        },
      },
    );
  const noop = () => ({ data: { subscription: { unsubscribe() {} } } });
  const auth = {
    onAuthStateChange: noop,
    getUser: async () => ({ data: { user: { id: recorded.user } }, error: null }),
    oauth: {
      getAuthorizationDetails: async () => ({ data: { client: { client_id: "c" } }, error: null }),
    },
  };
  const client = new Proxy(
    {
      from: () => chain(null),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        recorded.rpcs.push({ fn, args });
        const answer = recorded.answers[fn];
        return answer ? answer(args) : { data: null, error: null };
      },
      auth: new Proxy(auth, { get: (t, p) => (t as never)[p] ?? noop }),
    },
    { get: (t, p) => (t as never)[p] ?? noop },
  );
  return { createClient: () => client };
});

import { webRuntime } from "./runtime.web";

const WS = "00000000-0000-4000-8000-0000000000c3";
const calls = (): Rpc[] => recorded.rpcs;
const connected = () => ({
  data: [{ id: "conn-new", created: true, moved_from: null, replaced: ["conn-old"] }],
  error: null,
});
const input = {
  authorizationId: "auth-1",
  workspaceId: WS,
  scopes: { tasks: "view" },
  expiresInDays: 90,
  includePrivateChat: false,
};

beforeEach(() => {
  recorded.rpcs.length = 0;
  recorded.answers = {};
});

describe("connectOAuthApp", () => {
  it("leaves p_replace_ids out when nothing is ticked", async () => {
    recorded.answers.workspace_api_keys_connect_oauth = connected;
    await webRuntime.workspace.connectOAuthApp(input);
    await webRuntime.workspace.connectOAuthApp({ ...input, replaceIds: [] });
    for (const call of calls()) expect("p_replace_ids" in call.args).toBe(false);
  });

  it("sends the ticked ids and answers what was replaced", async () => {
    recorded.answers.workspace_api_keys_connect_oauth = connected;
    const res = await webRuntime.workspace.connectOAuthApp({ ...input, replaceIds: ["conn-old"] });
    expect(calls()[0].args.p_replace_ids).toEqual(["conn-old"]);
    expect(res).toEqual({ id: "conn-new", created: true, movedFrom: null, replaced: ["conn-old"] });
  });
});

describe("readOAuthRequest", () => {
  const base = {
    client_id: "c",
    app_name: "Claude",
    client_domain: "claude.ai",
    client_scheme: "https",
    connection: null,
    full_workspace_ids: [],
  };

  it("maps the other connections", async () => {
    recorded.answers.workspace_api_keys_oauth_request = () => ({
      data: {
        ...base,
        others: [
          {
            id: "conn-old",
            workspace_id: WS,
            name: "Claude",
            created_at: "2026-10-21T09:00:00Z",
            last_used_at: null,
            recently_used: false,
          },
          { id: 5, workspace_id: WS },
        ],
      },
      error: null,
    });
    const req = await webRuntime.workspace.readOAuthRequest("auth-1");
    expect(req?.others).toEqual([
      {
        id: "conn-old",
        workspaceId: WS,
        name: "Claude",
        createdAt: "2026-10-21T09:00:00Z",
        lastUsedAt: null,
        recentlyUsed: false,
      },
    ]);
  });

  it("reads no others from a database that doesn't answer them yet", async () => {
    recorded.answers.workspace_api_keys_oauth_request = () => ({ data: base, error: null });
    expect((await webRuntime.workspace.readOAuthRequest("auth-1"))?.others).toEqual([]);
  });
});
