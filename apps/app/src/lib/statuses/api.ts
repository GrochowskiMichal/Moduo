// Statuses on the server (CV-17): your status and saved ones through the
// `user_op_*_status` ops (the person always from the session), teammates'
// "now" through `chat_now(ws)`, and statuses by person through the read rule
// (anyone who shares a workspace with them).

import type { StatusClearAfter, StatusPreset } from "@contracts/vocabularies";

import { supabaseClient } from "../runtime.web.client";
import {
  peopleNowFromRows,
  type PersonNow,
  type PersonStatus,
  type SavedStatus,
  savedStatusFromRow,
  statusFromRow,
} from "./model";

export type StatusDraft = {
  emoji: string | null;
  text: string | null;
  dnd: boolean;
  clearAt: string | null;
  preset: StatusPreset | null;
};

export type SavedStatusDraft = {
  emoji: string | null;
  text: string | null;
  dnd: boolean;
  clearAfter: StatusClearAfter;
};

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function setMyStatus(draft: StatusDraft): Promise<PersonStatus | null> {
  const { data, error } = await supabaseClient.rpc("user_op_set_status", {
    p_patch: {
      emoji: draft.emoji,
      text: draft.text,
      dnd: draft.dnd,
      clear_at: draft.clearAt,
      preset: draft.preset,
    },
  });
  fail(error);
  return statusFromRow(data);
}

export async function clearMyStatus(): Promise<void> {
  const { error } = await supabaseClient.rpc("user_op_clear_status");
  fail(error);
}

export async function saveStatus(draft: SavedStatusDraft, id?: string): Promise<string> {
  const { data, error } = await supabaseClient.rpc("user_op_save_status", {
    p_patch: {
      emoji: draft.emoji,
      text: draft.text,
      dnd: draft.dnd,
      clear_after: draft.clearAfter,
    },
    p_id: id ?? null,
  });
  fail(error);
  return String(data);
}

export async function forgetStatus(id: string): Promise<void> {
  const { error } = await supabaseClient.rpc("user_op_forget_status", { p_id: id });
  fail(error);
}

/** Your saved statuses, in their order (your own rows only). */
export async function listSavedStatuses(): Promise<SavedStatus[]> {
  const { data, error } = await supabaseClient
    .from("user_saved_statuses")
    .select("id, emoji, text, dnd, clear_after, position")
    .order("position", { ascending: true });
  fail(error);
  return (data ?? []).flatMap((r) => {
    const s = savedStatusFromRow(r);
    return s ? [s] : [];
  });
}

/** Statuses of these people (the read rule leaves out anyone you share no workspace with). */
export async function readStatuses(userIds: readonly string[]): Promise<Map<string, PersonStatus>> {
  const out = new Map<string, PersonStatus>();
  if (userIds.length === 0) return out;
  const { data, error } = await supabaseClient
    .from("user_statuses")
    .select("user_id, emoji, text, dnd, clear_at, preset, set_at")
    .in("user_id", [...userIds]);
  fail(error);
  for (const r of data ?? []) {
    const s = statusFromRow(r);
    if (s && typeof r.user_id === "string") out.set(r.user_id, s);
  }
  return out;
}

/** Your own status (null when none). */
export async function readMyStatus(userId: string): Promise<PersonStatus | null> {
  return (await readStatuses([userId])).get(userId) ?? null;
}

/** Everyone's "now" in a workspace you're a member of. */
export async function readPeopleNow(workspaceId: string): Promise<Map<string, PersonNow>> {
  const { data, error } = await supabaseClient.rpc("chat_now", { p_workspace_id: workspaceId });
  fail(error);
  return peopleNowFromRows(data);
}
