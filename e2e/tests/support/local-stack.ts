// Helpers for e2e tests against the LOCAL Supabase stack (`bun run local:up`,
// `bun run env:local`), never the cloud project. Keys come from
// `supabase status` at run time, so nothing secret lives in the repo. Test
// people: dev@moduo.local / localdev (supabase/seed.sql) and a teammate this
// file creates on first use.

import { execFileSync, spawnSync } from "node:child_process";

import type { Page } from "@playwright/test";

type StackKeys = { url: string; anon: string; service: string; db: string };

let cached: StackKeys | null = null;

export function stackKeys(): StackKeys {
  if (cached) return cached;
  const status = JSON.parse(
    execFileSync("supabase", ["status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  ) as Record<string, string>;
  if (!status.API_URL?.includes("127.0.0.1")) {
    throw new Error("These tests run against the local stack only (bun run local:up).");
  }
  cached = {
    url: status.API_URL,
    anon: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
    service: status.SERVICE_ROLE_KEY ?? status.SECRET_KEY,
    db: status.DB_URL,
  };
  return cached;
}

/**
 * Gives a local test person a password to sign in with. Supabase Auth refuses
 * every password write, the admin API's included
 * (20261023000000_auth_no_password_changes.sql: an app's OAuth token must not
 * turn into a session), so it's set in SQL as the database owner, like seed.sql.
 */
export function setLocalPassword(userId: string, password: string): void {
  const { db } = stackKeys();
  const run = spawnSync(
    "psql",
    [db, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-v", `id=${userId}`, "-v", `pw=${password}`],
    {
      input:
        "UPDATE auth.users SET encrypted_password = extensions.crypt(:'pw', extensions.gen_salt('bf')) WHERE id = :'id' RETURNING id;\n",
      encoding: "utf8",
    },
  );
  if (run.error) throw new Error(`psql couldn't run (${run.error.message}). brew install libpq.`);
  if (run.status !== 0) throw new Error(`setting the test password failed:\n${run.stderr}`);
  if (!run.stdout.trim()) throw new Error(`setting the test password found no user ${userId}`);
}

export const DEV = { email: "dev@moduo.local", password: "localdev" };
export const TEAMMATE = {
  email: "teammate@moduo.local",
  password: "localdev-teammate",
  name: "Tess Mate",
};

export type Session = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  user: { id: string; email: string };
};

export async function signIn(who: { email: string; password: string }): Promise<Session> {
  const { url, anon } = stackKeys();
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email: who.email, password: who.password }),
  });
  if (!res.ok) throw new Error(`sign-in failed for ${who.email}: ${res.status}`);
  const s = (await res.json()) as Session;
  return { ...s, expires_at: Math.floor(Date.now() / 1000) + s.expires_in };
}

/** PostgREST as a signed-in person (RLS applies) or as the service role. */
export async function rest<T = unknown>(
  as: Session | "service",
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<T> {
  const { url, anon, service } = stackKeys();
  const token = as === "service" ? service : as.access_token;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: as === "service" ? service : anon,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: init.prefer ?? "return=representation",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

export const rpc = <T = unknown>(as: Session | "service", fn: string, args: object) =>
  rest<T>(as, `rpc/${fn}`, { method: "POST", body: args });

/** The dev's own workspace (the one the app opens). */
export async function devWorkspace(dev: Session): Promise<{ id: string; inboxId: string }> {
  const [ws] = await rest<Array<{ id: string }>>(
    "service",
    `workspaces?owner_id=eq.${dev.user.id}&select=id&order=created_at.asc&limit=1`,
  );
  const [inbox] = await rest<Array<{ id: string }>>(
    "service",
    `buckets?workspace_id=eq.${ws.id}&owner_id=eq.${dev.user.id}&is_system=eq.true&select=id`,
  );
  return { id: ws.id, inboxId: inbox.id };
}

/** A second person, a member of the dev's workspace (created once). */
export async function ensureTeammate(workspaceId: string): Promise<Session> {
  const { url, service } = stackKeys();
  const admin = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    "Content-Type": "application/json",
  };
  const list = await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers: admin });
  const users = ((await list.json()) as { users: Array<{ id: string; email: string }> }).users;
  let user = users.find((u) => u.email === TEAMMATE.email);
  if (!user) {
    const created = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({
        email: TEAMMATE.email,
        email_confirm: true,
        user_metadata: { full_name: TEAMMATE.name, display_name: TEAMMATE.name },
      }),
    });
    user = (await created.json()) as { id: string; email: string };
  }
  // Auth refuses password writes; set it in SQL (supabase/seed.sql does the same).
  setLocalPassword(user.id, TEAMMATE.password);
  await rest("service", `profiles?id=eq.${user.id}`, {
    method: "PATCH",
    body: { display_name: TEAMMATE.name },
  });
  const member = await rest<unknown[]>(
    "service",
    `workspace_members?workspace_id=eq.${workspaceId}&user_id=eq.${user.id}&select=id`,
  );
  if (member.length === 0) {
    await rest("service", "workspace_members", {
      method: "POST",
      body: { workspace_id: workspaceId, user_id: user.id, role: "member" },
    });
  }
  return signIn(TEAMMATE);
}

/**
 * Mark Tasks' welcome as seen for someone (TV-U17), in their synced
 * preferences, so it doesn't open over a spec that isn't about it. The
 * preferences are one jsonb blob: read, merge, write, and stamp it newer so
 * the app takes the cloud's copy.
 */
export async function markWelcomeSeen(userId: string): Promise<void> {
  const [row] = await rest<Array<{ preferences: Record<string, unknown> }>>(
    "service",
    `user_preferences?user_id=eq.${userId}&select=preferences`,
  );
  const prefs = row?.preferences ?? {};
  const onboarding = (prefs.tasksOnboarding ?? {}) as Record<string, unknown>;
  if (typeof onboarding.welcomeSeenAt === "string") return;
  const at = new Date().toISOString();
  await rest("service", "user_preferences?on_conflict=user_id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: {
      user_id: userId,
      preferences: {
        ...prefs,
        tasksOnboarding: { ...onboarding, welcomeSeenAt: at, roleAt: onboarding.roleAt ?? at },
      },
      preferences_updated_at: at,
    },
  });
}

/**
 * Sign the browser in as `session` before the app boots, in `workspaceId`.
 * Tasks' welcome is marked seen first unless `welcome: true` (the onboarding
 * spec), so it never opens over a spec that isn't about it.
 */
export async function signInPage(
  page: Page,
  session: Session,
  workspaceId?: string,
  opts: { welcome?: boolean } = {},
): Promise<void> {
  if (!opts.welcome) await markWelcomeSeen(session.user.id);
  const host = new URL(stackKeys().url).hostname.split(".")[0];
  const entries: Array<[string, string]> = [[`sb-${host}-auth-token`, JSON.stringify(session)]];
  if (workspaceId) entries.push([`moduo:selected-workspace:${session.user.id}`, workspaceId]);
  await page.addInitScript((pairs) => {
    for (const [key, value] of pairs) window.localStorage.setItem(key, value);
  }, entries);
}

/**
 * End a person's open Focus runs (TV-F6's `focus_runs`), so a session another
 * test left running (it reads as "on your other device") doesn't become the
 * Now card of the next one. A paused run is ended too: `focus_runs_paused`
 * wants `paused_at` null unless the status is paused, so a run a test left
 * paused made this PATCH fail (400) in every later spec's setup.
 */
export async function endFocusRuns(userId: string): Promise<void> {
  await rest("service", `focus_runs?user_id=eq.${userId}&status=neq.ended`, {
    method: "PATCH",
    body: { status: "ended", ended_at: new Date().toISOString(), paused_at: null },
  });
}

/** A unique tag for this run's rows, so runs never collide. */
export const runTag = () => Math.random().toString(36).slice(2, 7);

/**
 * Soft-delete what a spec made in the shared dev workspace, so it doesn't
 * grow with every run: the projects it created (with their sections and
 * tasks) and the tasks it filed elsewhere under its `tag` (in a title, or as
 * the `z<tag>…` position the REST-built ones carry, e.g. in the Inbox). The
 * app reads at most 500 projects on first load (READ_CAPS.buckets), so a
 * workspace that keeps every run's projects eventually hides a new one and
 * the spec that made it fails. Tasks first, then sections, then projects (as
 * tasks-toolbar.spec.ts does); rows already deleted keep their stamp.
 */
export async function removeRun(
  workspaceId: string,
  tag: string,
  projectIds: readonly string[],
): Promise<void> {
  const at = new Date().toISOString();
  const patch = (path: string) =>
    rest("service", `${path}&deleted_at=is.null`, { method: "PATCH", body: { deleted_at: at } });
  const ids = projectIds.join(",");
  const inProjects = ids ? `,bucket_id.in.(${ids})` : "";
  await patch(
    `tasks?workspace_id=eq.${workspaceId}&or=(title.like.*${tag}*,position.like.z${tag}*${inProjects})`,
  );
  if (ids) {
    await patch(`sections?project_id=in.(${ids})`);
    await patch(`buckets?id=in.(${ids})`);
  }
}
