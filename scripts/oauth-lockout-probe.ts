/**
 * App-token lockout probe (MCPO-1, specs/mcp-oauth.md): a real OAuth 2.1 code
 * flow against Supabase Auth on the local stack, then the app's token against
 * every way into Supabase. The app's token must get nothing; the person's own
 * session must keep working.
 *
 *   bun scripts/oauth-lockout-probe.ts
 *
 * Needs the local stack (`bun run local:up`) with the MCPO-1 migration applied
 * and an Auth server with the OAuth server on. The shared stack keeps it off
 * (restarting it would cut off other sessions), so point the probe at a second
 * Auth container on the same database, started with the stack's own env plus
 * GOTRUE_OAUTH_SERVER_ENABLED=true and GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION=true:
 *
 *   MODUO_OAUTH_AUTH_URL=http://127.0.0.1:54399 bun scripts/oauth-lockout-probe.ts
 *
 * Edge Functions are checked when `bun run local:functions` is serving them.
 * It cleans up after itself: the grant is withdrawn and the client deleted.
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
const APIKEY = env.PUBLISHABLE_KEY || env.ANON_KEY;
const SERVICE = env.SERVICE_ROLE_KEY;
const EMAIL = process.env.MODUO_PROBE_EMAIL ?? "dev@moduo.local";
const PASSWORD = process.env.MODUO_PROBE_PASSWORD ?? "localdev";
const REDIRECT = "http://127.0.0.1:9/oauth-probe/callback";

type Json = Record<string, any>;
let failures = 0;
function check(ok: boolean, label: string, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}
function note(label: string): void {
  console.log(`NOTE: ${label}`);
}
const b64url = (buf: Buffer) => buf.toString("base64url");
function claims(token: string): Json {
  return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
}
async function json(res: Response): Promise<Json> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

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

// 2. An app registers itself (dynamic client registration), as Claude would.
const reg = await fetch(`${AUTH}/oauth/clients/register`, {
  method: "POST",
  headers: { apikey: APIKEY, "content-type": "application/json" },
  body: JSON.stringify({
    client_name: "MCPO-1 lockout probe",
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
check(true, "an app can register itself", client.client_id);

let APP = "";
try {
  // 3. Authorization code flow with PKCE: authorize → consent (as the person) → token.
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const authorize = new URL(`${AUTH}/oauth/authorize`);
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: b64url(randomBytes(8)),
  }))
    authorize.searchParams.set(k, v);
  const toConsent = await fetch(authorize, { redirect: "manual", headers: { apikey: APIKEY } });
  const consentUrl = new URL(toConsent.headers.get("location") ?? "http://invalid/");
  const authorizationId = consentUrl.searchParams.get("authorization_id") ?? "";
  check(
    toConsent.status >= 300 &&
      toConsent.status < 400 &&
      consentUrl.pathname === "/oauth/consent" &&
      !!authorizationId,
    "authorize sends the person to /oauth/consent with an authorization_id",
    `${toConsent.status} ${consentUrl.pathname}`,
  );

  // The consent page reads the request first (that ties it to the signed-in person).
  const details = await fetch(`${AUTH}/oauth/authorizations/${authorizationId}`, {
    headers: { apikey: APIKEY, authorization: `Bearer ${PERSON}` },
  });
  const detailsBody = await json(details);
  check(
    details.ok && detailsBody.client?.id === client.client_id,
    "the consent page can read who is asking",
    `HTTP ${details.status}`,
  );

  const approve = await fetch(`${AUTH}/oauth/authorizations/${authorizationId}/consent`, {
    method: "POST",
    headers: {
      apikey: APIKEY,
      authorization: `Bearer ${PERSON}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "approve" }),
  });
  const approved = await json(approve);
  const code = new URL(approved.redirect_url ?? "http://invalid/").searchParams.get("code") ?? "";
  check(
    approve.ok && !!code,
    "the person approves and the app gets a code",
    `HTTP ${approve.status}`,
  );

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
  const token = await json(tokenRes);
  APP = token.access_token ?? "";
  check(tokenRes.ok && !!APP, "the app exchanges the code for a token", `HTTP ${tokenRes.status}`);
  if (!APP) throw new Error("no app token, nothing more to check");

  const appClaims = claims(APP);
  check(appClaims.client_id === client.client_id, "the app's token carries its client_id");
  check(appClaims.sub === claims(PERSON).sub, "the app's token is the person's (same sub)");
  check(!claims(PERSON).client_id, "the person's own token has no client_id");
  note(
    `app token role=${appClaims.role} aud=${appClaims.aud} expires in ${appClaims.exp - appClaims.iat}s`,
  );

  // 4. The Data API: tables, RPC, GraphQL.
  const rest = (token: string, path: string, init: RequestInit = {}) =>
    fetch(`${API}${path}`, {
      ...init,
      headers: {
        apikey: APIKEY,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
  for (const [label, path, init] of [
    ["a table read (tasks)", "/rest/v1/tasks?select=id&limit=1", {}],
    ["a table read (workspaces)", "/rest/v1/workspaces?select=id&limit=1", {}],
    ["an RPC", "/rest/v1/rpc/request_app_client_id", { method: "POST", body: "{}" }],
    [
      "GraphQL",
      "/graphql/v1",
      { method: "POST", body: JSON.stringify({ query: "{ __typename }" }) },
    ],
  ] as const) {
    const asPerson = await rest(PERSON, path, init);
    const asApp = await rest(APP, path, init);
    const body = await json(asApp);
    check(asPerson.ok, `the person still reaches ${label}`, `HTTP ${asPerson.status}`);
    check(
      asApp.status === 403 && body.code === "app_token",
      `the app is refused ${label}`,
      `HTTP ${asApp.status}`,
    );
  }

  // 5. Storage: listing a private bucket's objects.
  const buckets = await fetch(`${API}/storage/v1/bucket`, {
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
  }).then(json);
  const bucket = Array.isArray(buckets) ? buckets.find((b: Json) => !b.public)?.id : undefined;
  if (bucket) {
    const list = (token: string) =>
      fetch(`${API}/storage/v1/object/list/${bucket}`, {
        method: "POST",
        headers: {
          apikey: APIKEY,
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ prefix: "", limit: 100 }),
      });
    const asApp = await list(APP);
    const appBody = await json(asApp);
    check(
      !asApp.ok || (Array.isArray(appBody) && appBody.length === 0),
      `the app lists nothing in the private bucket "${bucket}"`,
      `HTTP ${asApp.status}`,
    );
    const upload = await fetch(`${API}/storage/v1/object/${bucket}/mcpo1-probe-${Date.now()}.txt`, {
      method: "POST",
      headers: { apikey: APIKEY, authorization: `Bearer ${APP}`, "content-type": "text/plain" },
      body: "probe",
    });
    check(!upload.ok, `the app can't upload into "${bucket}"`, `HTTP ${upload.status}`);
  } else {
    note(
      "no private Storage bucket on this stack; Storage is covered by supabase/tests/app_token_lockout.test.sql",
    );
  }

  // 6. Edge Functions that accept a person's token.
  const fn = await fetch(`${API}/functions/v1/start-trial`, { method: "OPTIONS" }).catch(
    () => null,
  );
  if (fn && fn.status < 500) {
    for (const name of ["start-trial", "extend-trial", "analytics-forget", "delete-account"]) {
      const res = await fetch(`${API}/functions/v1/${name}`, {
        method: "POST",
        headers: {
          apikey: APIKEY,
          authorization: `Bearer ${APP}`,
          "content-type": "application/json",
        },
        body: "{}",
      });
      const body = await json(res);
      check(
        res.status === 403 && body.error === "app_token",
        `${name} refuses the app's token`,
        `HTTP ${res.status}`,
      );
    }
  } else {
    note(
      "Edge Functions aren't being served (bun run local:functions); covered by app-token.test.ts",
    );
  }

  // 7. Supabase Auth's own endpoints. Reading the profile is the same as the
  // token's claims; setting a password is not: the app could then sign in as
  // the person with no client_id and reach everything (the MCPO-1 validator's catch).
  const me = await fetch(`${AUTH}/user`, {
    headers: { apikey: APIKEY, authorization: `Bearer ${APP}` },
  });
  note(`Auth GET /user with the app's token: HTTP ${me.status}`);
  const grants = await fetch(`${AUTH}/user/oauth/grants`, {
    headers: { apikey: APIKEY, authorization: `Bearer ${APP}` },
  });
  note(
    `Auth GET /user/oauth/grants (the person's other connected apps) with the app's token: HTTP ${grants.status}`,
  );
  const takeover = `Probe-${b64url(randomBytes(9))}!`;
  const setPassword = await fetch(`${AUTH}/user`, {
    method: "PUT",
    headers: { apikey: APIKEY, authorization: `Bearer ${APP}`, "content-type": "application/json" },
    body: JSON.stringify({ password: takeover }),
  });
  check(!setPassword.ok, "the app can't set the person's password", `HTTP ${setPassword.status}`);
  if (setPassword.ok) {
    // Put the test account's password back.
    await fetch(`${AUTH}/admin/users/${claims(PERSON).sub}`, {
      method: "PUT",
      headers: {
        apikey: SERVICE,
        authorization: `Bearer ${SERVICE}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ password: PASSWORD }),
    });
  }
} catch (error) {
  check(false, "probe ran to the end", String(error));
} finally {
  // 8. Clean up: withdraw the grant, delete the client.
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
