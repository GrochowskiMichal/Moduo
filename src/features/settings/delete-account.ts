// Pure logic for the delete-account flow (DF-19h). The destructive work — auth
// user deletion + the FK cascade that removes owned solo workspaces + memberships —
// happens in the service-role `supabase/functions/delete-account` edge function
// (a client can't delete its own auth user or cascade safely). These helpers are
// the two decisions the UI + the edge function make, kept here so they're unit-
// testable without Deno.

/** A workspace the caller owns, with how many OTHER members it has. */
export type OwnedWorkspace = {
  id: string;
  name: string;
  otherMemberCount: number;
};

/**
 * Which owned workspaces BLOCK account deletion: the ones the caller solely owns
 * (owner_id = them) that still have other members. Deleting the account would
 * orphan those teammates, so the flow refuses until the user hands off ownership
 * or deletes the workspace. An owned *solo* workspace (no other members) is safe —
 * it's cascade-deleted with the account.
 *
 * The edge function recomputes this exact filter server-side over the live rows;
 * keep the two in lockstep (mirrors the member-permissions client/SQL pattern).
 */
export function blockingWorkspaces(owned: OwnedWorkspace[]): OwnedWorkspace[] {
  return owned.filter((w) => w.otherMemberCount > 0);
}

/**
 * The type-to-confirm gate for the Danger zone (mirrors the DF-5 confirm-first
 * grammar for non-restorable actions): the user must type their account email
 * (case-insensitive) or the literal word DELETE. Empty never matches.
 */
export function matchesDeleteConfirm(typed: string, email: string | null): boolean {
  const t = typed.trim();
  if (!t) return false;
  if (t === "DELETE") return true;
  return !!email && t.toLowerCase() === email.trim().toLowerCase();
}
