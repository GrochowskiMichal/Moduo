/**
 * Edge Function: delete-account (DF-19h)
 *
 * Permanently deletes the caller's account. A client can't delete its own auth
 * user or cascade safely, so this runs with the project's default secret key
 * (service-role credentials).
 *
 * Deploy with verify_jwt = false — the caller's JWT is verified in code (getUser).
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

import { getDefaultSecretKey } from "../_shared/secret-keys.ts";

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
      getDefaultSecretKey(),
      { auth: { persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, { status: 401 });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return json({ error: "Unauthorized" }, { status: 401 });

    // Workspaces this user owns. `deleted_at is null` excludes a workspace the user
    // already soft-deleted — it's invisible to its members, and the account delete
    // hard-cascades it (+ its lingering member rows) anyway, so it can't orphan anyone.
    const { data: ownedRows, error: ownedErr } = await supabase
      .from("workspaces")
      .select("id, name")
      .eq("owner_id", user.id)
      .is("deleted_at", null);
    if (ownedErr) throw new Error(ownedErr.message);
    const owned = (ownedRows ?? []) as { id: string; name: string }[];

    // Count OTHER members per owned workspace with an EXACT head-count. A single
    // `.in(...).select()` would rely on PostgREST's 1000-row default cap — a
    // workspace whose member rows page out would compute 0 others and false-safe
    // through the block, orphaning teammates. Per-workspace counts have no such cap.
    const ownedWithCounts: OwnedWorkspace[] = [];
    for (const w of owned) {
      const { count, error: cErr } = await supabase
        .from("workspace_members")
        .select("user_id", { count: "exact", head: true })
        .eq("workspace_id", w.id)
        .neq("user_id", user.id);
      if (cErr) throw new Error(cErr.message);
      ownedWithCounts.push({ ...w, otherMemberCount: count ?? 0 });
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
