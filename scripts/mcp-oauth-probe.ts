/**
 * Connector sign-in probe (MCPO-3, specs/mcp-oauth.md AC3, AC4, AC9, AC10): a
 * real OAuth 2.1 code flow against Supabase Auth on the local stack, the
 * consent screen's Approve made by hand (workspace_api_keys_connect_oauth as
 * the person), then the app's real token against moduo-mcp: discovery, tools
 * per the connection's access, attribution "Person · via <app>", a reconnect,
 * and a disconnect that cuts the app off.
 *
 *   MODUO_OAUTH_AUTH_URL=http://127.0.0.1:54399 MODUO_MCP_URL=http://127.0.0.1:8000/moduo-mcp \
 *     bun scripts/mcp-oauth-probe.ts
 *
 * Needs the local stack with the MCPO-3 migration applied, an Auth server with
 * the OAuth server on (scripts/local/oauth-auth.sh up) and a moduo-mcp to call:
 * the stack's own (`bun run local:functions`, the default URL) or one run from
 * a worktree under Deno. It cleans up after itself: the task it made, the
 * connection rows and their notices, the grant and the client.
 */

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

// `supabase status` runs outside the repo: the CLI reads the repo's bunfig.toml.
const status = spawnSync("supabase", ["status", "-o", "env", "--workdir", ROOT], {
  cwd: tmpdir(),
  encoding: "utf8",
});
const env: Record<string, string> = {};
for (const line of status.stdout.split("\n")) {
  const m = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
if (!env.API_URL || !env.SERVICE_ROLE_KEY) {
  console.error(
    "The local stack isn't running (supabase status found no API_URL). Run `bun run local:up`.",
  );
  process.exit(2);
}

const API = env.API_URL;
const AUTH = process.env.MODUO_OAUTH_AUTH_URL ?? `${API}/auth/v1`;
const MCP = process.env.MODUO_MCP_URL ?? `${API}/functions/v1/moduo-mcp`;
const APIKEY = env.PUBLISHABLE_KEY || env.ANON_KEY;
const SERVICE = env.SERVICE_ROLE_KEY;
const EMAIL = process.env.MODUO_PROBE_EMAIL ?? "dev@moduo.local";
const PASSWORD = process.env.MODUO_PROBE_PASSWORD ?? "localdev";
const REDIRECT = "http://127.0.0.1:9/mcp-oauth-probe/callback";
const APP_NAME = `MCPO-3 probe ${randomBytes(3).toString("hex")}`;

type Json = Record<string, any>;
let failures = 0;
function check(ok: boolean, label: string, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}
const b64url = (buf: Buffer) => buf.toString("base64url");
async function json(res: Response): Promise<Json> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
const asPerson = (token: string, path: string, body?: unknown) =>
  fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      apikey: APIKEY,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const asService = (path: string, init: RequestInit = {}) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
let rpcId = 0;
const mcp = (token: string | null, method: string, params?: unknown) =>
  fetch(MCP, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });

// 1. The person signs in.
const signIn = await fetch(`${AUTH}/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: APIKEY, "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const person = await json(signIn);
if (!signIn.ok || !person.access_token) {
  console.error(`Couldn't sign in ${EMAIL}: HTTP ${signIn.status} ${JSON.stringify(person)}`);
  process.exit(2);
}
const PERSON = person.access_token as string;
const ME = JSON.parse(Buffer.from(PERSON.split(".")[1], "base64url").toString("utf8"))
  .sub as string;

// A workspace the person owns (owners hold ws.api_keys).
const owned = await json(
  await asPerson(PERSON, `/rest/v1/workspaces?select=id,name&owner_id=eq.${ME}&limit=1`),
);
const WS: string | undefined = (owned as unknown as Json[])[0]?.id;
if (!WS) {
  console.error(`${EMAIL} owns no workspace on the local stack.`);
  process.exit(2);
}

// 2. Discovery, signed out.
const signedOut = await mcp(null, "tools/list");
const challenge = signedOut.headers.get("www-authenticate") ?? "";
const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1] ?? "";
check(
  signedOut.status === 401 && !!metadataUrl,
  "a call without credentials gets 401 pointing at discovery",
  challenge,
);
const metadata = metadataUrl ? await json(await fetch(metadataUrl)) : {};
check(
  Array.isArray(metadata.authorization_servers) &&
    /\/auth\/v1$/.test(metadata.authorization_servers[0] ?? ""),
  "the protected-resource document names Supabase Auth",
  JSON.stringify(metadata),
);

// 3. The app registers itself and the person signs it in.
const reg = await fetch(`${AUTH}/oauth/clients/register`, {
  method: "POST",
  headers: { apikey: APIKEY, "content-type": "application/json" },
  body: JSON.stringify({
    client_name: APP_NAME,
    redirect_uris: [REDIRECT],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  }),
});
const client = await json(reg);
if (!reg.ok || !client.client_id) {
  console.error(
    `Dynamic registration failed: HTTP ${reg.status} ${JSON.stringify(client)}. Is the OAuth server on at ${AUTH}?`,
  );
  process.exit(2);
}
check(true, "the app registers itself", client.client_id);

const connections: string[] = [];
let taskId = "";
try {
  const connect = async (scopes: Json) => {
    const res = await asPerson(PERSON, "/rest/v1/rpc/workspace_api_keys_connect_oauth", {
      p_workspace_id: WS,
      p_client_id: client.client_id,
      p_scopes: scopes,
      p_expires_in_days: 90,
      p_include_private_chat: false,
    });
    const rows = (await json(res)) as unknown as Json[];
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (row?.id && !connections.includes(row.id)) connections.push(row.id);
    return { status: res.status, row };
  };

  const authorize = async (): Promise<string> => {
    const verifier = b64url(randomBytes(32));
    const url = new URL(`${AUTH}/oauth/authorize`);
    for (const [k, v] of Object.entries({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      code_challenge: b64url(createHash("sha256").update(verifier).digest()),
      code_challenge_method: "S256",
      state: b64url(randomBytes(8)),
    }))
      url.searchParams.set(k, v);
    const toConsent = await fetch(url, { redirect: "manual", headers: { apikey: APIKEY } });
    const authorizationId = new URL(
      toConsent.headers.get("location") ?? "http://invalid/",
    ).searchParams.get("authorization_id");
    // The consent page reads the request first (that ties it to the signed-in person).
    await fetch(`${AUTH}/oauth/authorizations/${authorizationId}`, {
      headers: { apikey: APIKEY, authorization: `Bearer ${PERSON}` },
    });
    const approve = await fetch(`${AUTH}/oauth/authorizations/${authorizationId}/consent`, {
      method: "POST",
      headers: {
        apikey: APIKEY,
        authorization: `Bearer ${PERSON}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "approve" }),
    });
    const code =
      new URL((await json(approve)).redirect_url ?? "http://invalid/").searchParams.get("code") ??
      "";
    const tokenRes = await fetch(`${AUTH}/oauth/token`, {
      method: "POST",
      headers: { apikey: APIKEY, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT,
        client_id: client.client_id,
        code_verifier: verifier,
      }),
    });
    return ((await json(tokenRes)).access_token as string) ?? "";
  };

  // The consent screen's Approve: the connection first, then Supabase's consent.
  const first = await connect({ tasks: "view" });
  check(
    first.status === 200 && first.row?.created === true,
    "Approve creates the connection",
    `HTTP ${first.status}`,
  );
  const APP = await authorize();
  check(!!APP, "the app gets a token");

  // A token that predates any connection row would be refused; this one has one.
  const init = await mcp(APP, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "probe", version: "1" },
  });
  check(init.status === 200, "the app's token initializes an MCP session", `HTTP ${init.status}`);
  const viewTools = ((await json(await mcp(APP, "tools/list"))).result?.tools ?? []).map(
    (t: Json) => t.name,
  );
  check(
    viewTools.includes("tasks_list") &&
      !viewTools.includes("tasks_create") &&
      !viewTools.some((n: string) => n.startsWith("notes_")),
    "tools follow the connection's access (Tasks: View)",
    `${viewTools.length} tools`,
  );
  const listed = await json(
    await mcp(APP, "tools/call", { name: "tasks_list", arguments: { limit: 1 } }),
  );
  check(
    listed.result && !listed.result.isError,
    "a read tool runs",
    JSON.stringify(listed).slice(0, 120),
  );

  // The bell notice, the person's only.
  const notices = (await json(
    await asService(
      `/rest/v1/module_activity?select=actor_label,payload&op=eq.api_keys.connected&entity_id=eq.${first.row.id}`,
    ),
  )) as unknown as Json[];
  check(
    notices.length === 1 &&
      notices[0].actor_label === APP_NAME &&
      JSON.stringify(notices[0].payload.notify_user_ids) === JSON.stringify([ME]),
    "connecting rang the person's bell once, naming the app",
  );

  // Reconnect with Edit: the same row, and the token already in hand sees it.
  const again = await connect({ tasks: "edit" });
  check(
    again.row?.id === first.row.id && again.row?.created === false,
    "reconnecting updates the same connection",
  );
  const editTools = ((await json(await mcp(APP, "tools/list"))).result?.tools ?? []).map(
    (t: Json) => t.name,
  );
  check(editTools.includes("tasks_create"), "the new access applies on the next call");

  const created = await json(
    await mcp(APP, "tools/call", {
      name: "tasks_create",
      arguments: { title: "MCPO-3 probe task" },
    }),
  );
  const text = created.result?.content?.[0]?.text ?? "";
  taskId = (() => {
    try {
      return JSON.parse(text).id ?? "";
    } catch {
      return "";
    }
  })();
  check(
    !!taskId && !created.result?.isError,
    "a write tool runs through the connection",
    text.slice(0, 120),
  );
  const trail = (await json(
    await asService(
      `/rest/v1/module_activity?select=actor_type,actor_id,actor_label&entity_id=eq.${taskId}&order=created_at.asc&limit=1`,
    ),
  )) as unknown as Json[];
  // "Alex · via Claude"; a person with no name leaves the app's name alone (TV-D16).
  const profile = (await json(
    await asService(`/rest/v1/profiles?select=display_name&id=eq.${ME}`),
  )) as unknown as Json[];
  const name = (profile[0]?.display_name ?? "").trim();
  const label = name ? `${name} · via ${APP_NAME}` : APP_NAME;
  check(
    trail[0]?.actor_type === "api_key" &&
      trail[0]?.actor_id === first.row.id &&
      trail[0]?.actor_label === label,
    "the change is attributed to the person via the app",
    trail[0]?.actor_label,
  );

  // Disconnect: the same token is refused at once, asking to sign in again.
  const revoke = await asPerson(PERSON, "/rest/v1/rpc/workspace_api_keys_revoke", {
    p_key_id: first.row.id,
  });
  check(revoke.ok, "the person disconnects the app", `HTTP ${revoke.status}`);
  const cut = await mcp(APP, "tools/list");
  const cutBody = await json(cut);
  check(
    cut.status === 401 &&
      cutBody.error === "invalid_token" &&
      /error="invalid_token"/.test(cut.headers.get("www-authenticate") ?? ""),
    "after a disconnect the app's still-valid token is refused with invalid_token",
    `HTTP ${cut.status}`,
  );

  // The person's own session token is not a connection.
  const own = await mcp(PERSON, "tools/list");
  check(
    own.status === 401,
    "the person's own session token is refused by the connector",
    `HTTP ${own.status}`,
  );
} catch (error) {
  check(false, "probe ran to the end", String(error));
} finally {
  // Clean up: the task, the connections and their notices, the grant, the client.
  if (taskId) {
    await asService(`/rest/v1/module_activity?entity_id=eq.${taskId}`, { method: "DELETE" }).catch(
      () => null,
    );
    await asService(`/rest/v1/tasks?id=eq.${taskId}`, { method: "DELETE" }).catch(() => null);
  }
  for (const id of connections) {
    await asService(`/rest/v1/module_activity?entity_id=eq.${id}`, { method: "DELETE" }).catch(
      () => null,
    );
    await asService(`/rest/v1/workspace_api_keys?id=eq.${id}`, { method: "DELETE" }).catch(
      () => null,
    );
  }
  await fetch(`${AUTH}/user/oauth/grants?client_id=${encodeURIComponent(client.client_id)}`, {
    method: "DELETE",
    headers: { apikey: APIKEY, authorization: `Bearer ${PERSON}` },
  }).catch(() => null);
  await fetch(`${AUTH}/admin/oauth/clients/${client.client_id}`, {
    method: "DELETE",
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
  }).catch(() => null);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
