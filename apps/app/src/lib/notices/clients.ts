// Which of your apps and tabs rings (CV-6b, round-3 §2.14 e): each app or tab
// keeps an install id, tells the server it's open every minute
// (`user_op_client_seen`, `active` while it's focused and not idle) and asks it
// again when a chat notice arrives, so only the most recently active one rings.
// Whoever shows a notice, in place or as an OS notification, acknowledges it
// (`notice_op_ack`); a browser's push then never rings for it.
//
// These calls go straight to Supabase like the listener that uses them
// (`components/app/notice-deliveries.tsx`): the desktop app is cloud-first too.

import type { ClientSurface } from "@contracts/vocabularies";

import { supabaseClient } from "../runtime.web.client";
import { CLIENT_IDLE_MS } from "./ring";

export type { ClientSurface };
export { CLIENT_IDLE_MS };

const CLIENT_KEY = "moduo:client-id";
/** The heartbeat (the server counts a client open for three minutes after it). */
export const CLIENT_SEEN_MS = 60_000;

let memoryId: string | null = null;

const mint = (): string => crypto.randomUUID();

/** This app's or tab's install id: minted once, kept on this device. */
export function clientId(): string {
  try {
    const kept = window.localStorage.getItem(CLIENT_KEY);
    if (kept && /^[0-9a-f-]{36}$/i.test(kept)) return kept;
    const id = mint();
    window.localStorage.setItem(CLIENT_KEY, id);
    return id;
  } catch {
    memoryId ??= mint();
    return memoryId;
  }
}

/** Another person's app minted the same id (`22023 Unknown client.`): start over. */
function remint(): string {
  const id = mint();
  try {
    window.localStorage.setItem(CLIENT_KEY, id);
  } catch {
    memoryId = id;
  }
  return id;
}

/**
 * Tell the server this client is open (and whether it has your attention);
 * answers whether it is now your most recently active one. Never throws: a
 * failed stamp (offline, an old database) answers `null`: the caller doesn't
 * ring and leaves the notice to the browser's push, so two never ring.
 */
export async function stampClient(
  surface: ClientSurface,
  active: boolean,
): Promise<boolean | null> {
  const call = (id: string) =>
    supabaseClient.rpc("user_op_client_seen", {
      p_client_id: id,
      p_surface: surface,
      p_active: active,
    });
  try {
    let { data, error } = await call(clientId());
    if (error && /unknown client/i.test(error.message)) ({ data, error } = await call(remint()));
    if (error || !data || typeof data !== "object") return null;
    return (data as { latest?: unknown }).latest === true;
  } catch {
    return null;
  }
}

/** Acknowledge notices this client showed (in place or as a notification). */
export async function ackNotices(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await supabaseClient.rpc("notice_op_ack", { p_ids: ids.slice(0, 1000) });
  } catch {
    // The browser's push may ring once more: never worth an error.
  }
}

/** One of your apps or tabs as the export lists it (CV-22). */
export type MyClient = {
  id: string;
  surface: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  lastActiveAt: string | null;
};

/** Your own apps and tabs (the table's rule shows each person only their own). */
export async function listMyClients(userId: string): Promise<MyClient[]> {
  const { data, error } = await supabaseClient
    .from("user_clients")
    .select("id, surface, user_agent, created_at, last_seen_at, last_active_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    surface: String(r.surface),
    userAgent: r.user_agent == null ? null : String(r.user_agent),
    createdAt: String(r.created_at),
    lastSeenAt: String(r.last_seen_at),
    lastActiveAt: r.last_active_at == null ? null : String(r.last_active_at),
  }));
}

/** A workspace whose notices you paused (CV-18), as the export lists it (CV-22). */
export type MyNoticePause = { workspaceId: string; pausedAt: string };

/** Your own paused workspaces (the table's rule shows each person only their own). */
export async function listMyNoticePauses(userId: string): Promise<MyNoticePause[]> {
  const { data, error } = await supabaseClient
    .from("user_notice_pauses")
    .select("workspace_id, paused_at")
    .eq("user_id", userId)
    .order("paused_at", { ascending: true });
  if (error) {
    // Before CV-18's migration the table doesn't exist: nothing paused.
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => ({
    workspaceId: String(r.workspace_id),
    pausedAt: String(r.paused_at),
  }));
}
