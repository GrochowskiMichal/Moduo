// Helpers for e2e tests against the LOCAL Supabase stack (`bun run local:up`,
// `bun run env:local`), never the cloud project. Keys come from
// `supabase status` at run time, so nothing secret lives in the repo. Test
// people: dev@moduo.local / localdev (supabase/seed.sql) and a teammate this
// file creates on first use.

import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";

type StackKeys = { url: string; anon: string; service: string };

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
  };
  return cached;
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
  // The stack blanks passwords on insert (prod signs in by code); set one after.
  await fetch(`${url}/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    headers: admin,
    body: JSON.stringify({ password: TEAMMATE.password }),
  });
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

/** Sign the browser in as `session` before the app boots, in `workspaceId`. */
export async function signInPage(
  page: Page,
  session: Session,
  workspaceId?: string,
): Promise<void> {
  const host = new URL(stackKeys().url).hostname.split(".")[0];
  const entries: Array<[string, string]> = [[`sb-${host}-auth-token`, JSON.stringify(session)]];
  if (workspaceId) entries.push([`moduo:selected-workspace:${session.user.id}`, workspaceId]);
  await page.addInitScript((pairs) => {
    for (const [key, value] of pairs) window.localStorage.setItem(key, value);
  }, entries);
}

/** A unique tag for this run's rows, so runs never collide. */
export const runTag = () => Math.random().toString(36).slice(2, 7);
