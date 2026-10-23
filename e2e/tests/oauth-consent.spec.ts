import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

import { expect, type Page, type Route, test } from "@playwright/test";

import { DEV, rest, runTag, signIn, signInPage, stackKeys } from "./support/local-stack";

/**
 * MCPO-4 · the consent screen (specs/mcp-oauth.md AC5, AC6, AC7), against
 * the local stack:
 *   scripts/agent/e2e.sh tests/oauth-consent.spec.ts
 *
 * An app registers itself and starts a real OAuth 2.1 authorization; the
 * signed-out person opens the consent link, signs in with the emailed code
 * (Mailpit), lands back on the consent screen and approves, and the app gets
 * a code it can exchange for a token. A reconnect shows the current access
 * and updates the same connection; another app's sign-in is denied and
 * nothing is created.
 *
 * Needs Supabase Auth with the OAuth server on. Until the stack restarts with
 * supabase/config.toml's [auth.oauth_server], run the side Auth
 * (scripts/local/oauth-auth.sh up) and point the spec at it:
 *   MODUO_OAUTH_AUTH_URL=http://127.0.0.1:54399 scripts/agent/e2e.sh tests/oauth-consent.spec.ts
 * The app's own OAuth calls are then routed there too.
 */

test.describe.configure({ mode: "serial", timeout: 120_000 });

const MAILPIT = process.env.MODUO_MAILPIT_URL ?? "http://127.0.0.1:54324";
// Never reached: the browser's trip back to the app is answered by the test.
const REDIRECT = "https://oauth-e2e.test/callback";

type Json = Record<string, any>;
type App = { clientId: string; name: string };

const auth = () => process.env.MODUO_OAUTH_AUTH_URL ?? `${stackKeys().url}/auth/v1`;

const apps: App[] = [];
let tag = "";
let dev: { id: string; token: string; workspaceId: string; workspaceName: string };

async function register(name: string): Promise<App> {
  const res = await fetch(`${auth()}/oauth/clients/register`, {
    method: "POST",
    headers: { apikey: stackKeys().anon, "content-type": "application/json" },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  const body = (await res.json()) as Json;
  if (!res.ok || !body.client_id) {
    throw new Error(
      `Registering an app failed (HTTP ${res.status}). Is the OAuth server on at ${auth()}? ${JSON.stringify(body)}`,
    );
  }
  const app = { clientId: body.client_id as string, name };
  apps.push(app);
  return app;
}

/** The app starts a sign-in: the authorization the consent screen is opened for. */
async function authorize(
  app: App,
): Promise<{ authorizationId: string; verifier: string; state: string }> {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(8).toString("base64url");
  const url = new URL(`${auth()}/oauth/authorize`);
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id: app.clientId,
    redirect_uri: REDIRECT,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state,
  }))
    url.searchParams.set(k, v);
  const res = await fetch(url, { redirect: "manual", headers: { apikey: stackKeys().anon } });
  const location = res.headers.get("location") ?? "";
  const authorizationId = new URL(location, "http://x").searchParams.get("authorization_id");
  if (!authorizationId) throw new Error(`No consent redirect (HTTP ${res.status}): ${location}`);
  return { authorizationId, verifier, state };
}

/**
 * Route the app's OAuth-server calls to the OAuth-enabled Auth when it isn't
 * the stack's own, and answer the trip back to the app. Resolves the return
 * URL the browser was sent to.
 */
async function wire(page: Page): Promise<() => Promise<URL>> {
  const stackAuth = `${stackKeys().url}/auth/v1`;
  if (auth() !== stackAuth) {
    const forward = async (route: Route) => {
      const request = route.request();
      const target = request.url().replace(stackAuth, auth());
      const origin = (await request.headerValue("origin")) ?? "*";
      const cors = {
        "access-control-allow-origin": origin,
        "access-control-allow-credentials": "true",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      };
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const response = await route.fetch({ url: target });
      await route.fulfill({ response, headers: { ...response.headers(), ...cors } });
    };
    await page.route(`${stackAuth}/oauth/**`, forward);
    await page.route(`${stackAuth}/user/oauth/**`, forward);
  }
  let returned: (url: URL) => void;
  const back = new Promise<URL>((resolve) => (returned = resolve));
  await page.route(`${REDIRECT}**`, async (route) => {
    returned(new URL(route.request().url()));
    await route.fulfill({ status: 200, contentType: "text/html", body: "<p>Back in the app</p>" });
  });
  return () => back;
}

async function latestCode(after: number): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${DEV.email}`)}&limit=5`,
    );
    const list = (await res.json()) as { messages?: Array<{ ID: string; Created: string }> };
    const fresh = (list.messages ?? []).find((m) => Date.parse(m.Created) >= after - 1000);
    if (fresh) {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${fresh.ID}`)).json()) as Json;
      const code = /\b(\d{6})\b/.exec(`${message.Text ?? ""} ${message.HTML ?? ""}`)?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No sign-in code for ${DEV.email} in Mailpit (${MAILPIT}).`);
}

async function exchange(app: App, code: string, verifier: string): Promise<Json> {
  const res = await fetch(`${auth()}/oauth/token`, {
    method: "POST",
    headers: { apikey: stackKeys().anon, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: app.clientId,
      code_verifier: verifier,
    }),
  });
  return { status: res.status, ...((await res.json()) as Json) };
}

const connectionsOf = (app: App) =>
  rest<
    Array<{
      id: string;
      workspace_id: string;
      name: string;
      scopes: Json;
      revoked_at: string | null;
    }>
  >(
    "service",
    `workspace_api_keys?oauth_client_id=eq.${app.clientId}&select=id,workspace_id,name,scopes,revoked_at`,
  );

const accessRow = (page: Page, module: string) =>
  page.getByRole("radiogroup", { name: `${module} access` });

test.beforeAll(async () => {
  tag = runTag();
  const session = await signIn(DEV);
  const owned = await rest<Array<{ id: string; name: string }>>(
    "service",
    `workspaces?owner_id=eq.${session.user.id}&deleted_at=is.null&select=id,name&order=created_at&limit=1`,
  );
  if (!owned[0]) throw new Error(`${DEV.email} owns no workspace on the local stack.`);
  dev = {
    id: session.user.id,
    token: session.access_token,
    workspaceId: owned[0].id,
    workspaceName: owned[0].name,
  };
});

test.afterAll(async () => {
  for (const app of apps) {
    for (const row of await connectionsOf(app).catch(() => [])) {
      await rest("service", `workspace_api_keys?id=eq.${row.id}`, { method: "DELETE" }).catch(
        () => null,
      );
    }
    await fetch(`${auth()}/user/oauth/grants?client_id=${encodeURIComponent(app.clientId)}`, {
      method: "DELETE",
      headers: { apikey: stackKeys().anon, authorization: `Bearer ${dev.token}` },
    }).catch(() => null);
    await fetch(`${auth()}/admin/oauth/clients/${app.clientId}`, {
      method: "DELETE",
      headers: { apikey: stackKeys().service, authorization: `Bearer ${stackKeys().service}` },
    }).catch(() => null);
  }
});

test("approve: a signed-out person signs in, sees the screen, approves; the app gets a code", async ({
  page,
}) => {
  const app = await register(`E2E Claude ${tag}`);
  const { authorizationId, verifier, state } = await authorize(app);
  const returnedTo = await wire(page);

  // Signed out: the email-code sign-in, with why they're there.
  await page.goto(`/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`);
  await expect(page).toHaveURL(/\/auth/);
  await expect(page.getByText("Sign in to connect your app.", { exact: false })).toBeVisible();
  const sentAt = Date.now();
  await page.getByPlaceholder("you@example.com").fill(DEV.email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByPlaceholder("000000").fill(await latestCode(sentAt));
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Back on the same consent screen (AC6).
  await expect(page).toHaveURL(new RegExp(`/oauth/consent\\?authorization_id=${authorizationId}`));
  await expect(
    page.getByRole("heading", { name: `E2E Claude ${tag} wants to work in Moduo as you` }),
  ).toBeVisible({ timeout: 20_000 });
  // AC5: the domain, the unchecked-app line, the picker, the card with its defaults, expiry.
  await expect(page.getByText("oauth-e2e.test")).toBeVisible();
  await expect(page.getByText("Moduo hasn't checked this app.")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Workspace" })).toBeVisible();
  await expect(accessRow(page, "Tasks").getByRole("radio", { name: "View" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(accessRow(page, "Notes").getByRole("radio", { name: "None" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(
    page.getByRole("radiogroup", { name: "Expires after" }).getByRole("radio", { name: "90 days" }),
  ).toHaveAttribute("aria-checked", "true");

  await accessRow(page, "Notes").getByRole("radio", { name: "View" }).click();
  await page.getByRole("combobox", { name: "Workspace" }).click();
  await page.getByRole("option", { name: dev.workspaceName, exact: true }).click();
  await page.getByRole("button", { name: "Approve" }).click();

  const back = await returnedTo();
  expect(back.searchParams.get("state")).toBe(state);
  const code = back.searchParams.get("code") ?? "";
  expect(code).not.toBe("");
  const token = await exchange(app, code, verifier);
  expect(token.status).toBe(200);
  expect(typeof token.access_token).toBe("string");

  const rows = await connectionsOf(app);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    workspace_id: dev.workspaceId,
    name: `E2E Claude ${tag}`,
    revoked_at: null,
  });
  expect(rows[0].scopes).toMatchObject({ tasks: "view", notes: "view" });
});

test("reconnect: the screen shows the current access and updates the same connection", async ({
  page,
}) => {
  const app = apps[0];
  const before = await connectionsOf(app);
  const { authorizationId, verifier } = await authorize(app);
  const returnedTo = await wire(page);
  await signInAsDev(page);

  await page.goto(`/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`);
  // Auth approved this returning app by itself when the page read it; the
  // page still waits for Approve (AC7), pre-filled with what it holds.
  await expect(page.getByText(/Connected now in .+ · View: Tasks, Notes/)).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(1_000);
  expect(page.url()).toContain("/oauth/consent");
  await expect(accessRow(page, "Notes").getByRole("radio", { name: "View" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await accessRow(page, "Tasks").getByRole("radio", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Approve" }).click();

  const back = await returnedTo();
  const token = await exchange(app, back.searchParams.get("code") ?? "", verifier);
  expect(token.status).toBe(200);
  const after = await connectionsOf(app);
  expect(after.filter((r) => r.revoked_at === null)).toHaveLength(1);
  expect(after[0].id).toBe(before[0].id);
  expect(after[0].scopes).toMatchObject({ tasks: "edit", notes: "view" });
});

test("deny after Auth approved a returning app: told no, no code, the connection untouched", async ({
  page,
}) => {
  const app = apps[0];
  const before = await connectionsOf(app);
  const { authorizationId, state } = await authorize(app);
  const returnedTo = await wire(page);
  await signInAsDev(page);

  await page.goto(`/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`);
  await expect(page.getByText(/Connected now in/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Deny" }).click();

  const back = await returnedTo();
  expect(back.searchParams.get("error")).toBe("access_denied");
  expect(back.searchParams.get("code")).toBeNull();
  expect(back.searchParams.get("state")).toBe(state);
  expect(await connectionsOf(app)).toEqual(before);
});

test("disconnect in Settings cuts the connection and withdraws the grant", async ({ page }) => {
  const app = apps[0];
  await wire(page);
  await signInAsDev(page);
  await page.goto("/settings");
  await page.getByText("API keys", { exact: true }).first().click();
  await page.getByRole("button", { name: `Disconnect ${app.name}` }).click();
  const dialog = page.getByRole("dialog", { name: `Disconnect ${app.name}?` });
  await expect(
    dialog.getByText("It loses access immediately; it can sign in again later."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText(`${app.name} is disconnected.`)).toBeVisible();
  await expect(page.getByRole("button", { name: `Disconnect ${app.name}` })).toHaveCount(0);

  await expect
    .poll(async () => (await connectionsOf(app)).every((r) => r.revoked_at !== null))
    .toBe(true);
  await expect.poll(() => grantRevoked(app)).toBe(true);
});

test("deny: the app is told no and nothing is created", async ({ page }) => {
  const app = await register(`E2E Other ${tag}`);
  const { authorizationId, state } = await authorize(app);
  const returnedTo = await wire(page);
  await signInAsDev(page);

  await page.goto(`/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`);
  await expect(
    page.getByRole("heading", { name: `E2E Other ${tag} wants to work in Moduo as you` }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Deny" }).click();

  const back = await returnedTo();
  expect(back.searchParams.get("error")).toBe("access_denied");
  expect(back.searchParams.get("code")).toBeNull();
  expect(back.searchParams.get("state")).toBe(state);
  expect(await connectionsOf(app)).toHaveLength(0);
});

async function signInAsDev(page: Page): Promise<void> {
  await signInPage(page, await signIn(DEV));
}

/** Whether the person's grant for the app is withdrawn (Auth's own table, read as the owner). */
function grantRevoked(app: App): boolean {
  const run = spawnSync(
    "psql",
    [stackKeys().db, "-X", "-q", "-At", "-v", `client=${app.clientId}`, "-v", `who=${dev.id}`],
    {
      input:
        "SELECT bool_and(revoked_at IS NOT NULL) FROM auth.oauth_consents WHERE client_id = :'client'::uuid AND user_id = :'who'::uuid;\n",
      encoding: "utf8",
    },
  );
  return run.stdout.trim() === "t";
}
