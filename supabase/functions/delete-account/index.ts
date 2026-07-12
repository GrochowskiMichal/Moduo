/**
 * Edge Function: delete-account (DF-19h)
 *
 * Permanently deletes the caller's account. A client can't delete its own auth
 * user or cascade safely, so this runs with the service-role key.
 *
 * Guard (ratified): if the caller SOLELY owns a workspace that still has other
 * members, deletion is BLOCKED (would orphan teammates) — the response lists the
 * blocking workspaces so the UI can tell the user to hand off ownership or delete
 * them first. An owned *solo* workspace (no other members) is safe: it is
 * cascade-deleted with the account (FKs: auth.users → profiles → workspaces(owner)
 * → workspace_members, all ON DELETE CASCADE; the caller's own memberships in
 * other workspaces cascade via workspace_members.user_id → profiles).
 *
 * Returns:
 *   200 { ok: true }
 *   409 { blocked: true, workspaces: [{ id, name }] }
 *   401 { error }  /  500 { error }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, init?: ResponseInit) =>
  Response.json(body, { ...init, headers: { ...CORS, ...(init?.headers ?? {}) } });

type OwnedWorkspace = { id: string; name: string; otherMemberCount: number };

/** Sole-owner-of-shared blocks deletion. Kept in lockstep with the client's pure
 *  `blockingWorkspaces` in src/features/settings/delete-account.ts. */
function blockingWorkspaces(owned: OwnedWorkspace[]): OwnedWorkspace[] {
  return owned.filter((w) => w.otherMemberCount > 0);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, { status: 401 });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return json({ error: "Unauthorized" }, { status: 401 });

    // Workspaces this user owns (live only).
    const { data: ownedRows, error: ownedErr } = await supabase
      .from("workspaces")
      .select("id, name")
      .eq("owner_id", user.id)
      .is("deleted_at", null);
    if (ownedErr) throw new Error(ownedErr.message);
    const owned = (ownedRows ?? []) as { id: string; name: string }[];

    // Count OTHER members across those owned workspaces in one read.
    let ownedWithCounts: OwnedWorkspace[] = owned.map((w) => ({ ...w, otherMemberCount: 0 }));
    if (owned.length > 0) {
      const ownedIds = owned.map((w) => w.id);
      const { data: memberRows, error: memberErr } = await supabase
        .from("workspace_members")
        .select("workspace_id, user_id")
        .in("workspace_id", ownedIds);
      if (memberErr) throw new Error(memberErr.message);
      const otherByWorkspace = new Map<string, number>();
      for (const m of (memberRows ?? []) as { workspace_id: string; user_id: string }[]) {
        if (m.user_id !== user.id) {
          otherByWorkspace.set(m.workspace_id, (otherByWorkspace.get(m.workspace_id) ?? 0) + 1);
        }
      }
      ownedWithCounts = owned.map((w) => ({
        ...w,
        otherMemberCount: otherByWorkspace.get(w.id) ?? 0,
      }));
    }

    const blocking = blockingWorkspaces(ownedWithCounts);
    if (blocking.length > 0) {
      return json(
        { blocked: true, workspaces: blocking.map((w) => ({ id: w.id, name: w.name })) },
        { status: 409 },
      );
    }

    // Safe: delete the auth user. The FK cascade removes the profile, every owned
    // (now solo) workspace + its members, and the caller's own memberships.
    const { error: delError } = await supabase.auth.admin.deleteUser(user.id);
    if (delError) throw new Error(delError.message);

    return json({ ok: true });
  } catch (err) {
    console.error("[delete-account]", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, { status: 500 });
  }
});
