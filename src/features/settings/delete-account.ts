// Pure logic for the delete-account flow (DF-19h). The destructive work — Stripe,
// Storage, booking links, integration tokens, then auth user deletion + the FK
// cascade that removes owned solo workspaces + memberships — happens in the
// service-role `supabase/functions/delete-account` edge function (a client can't
// delete its own auth user or cascade safely); the server side lives in
// `supabase/functions/_shared/account-erasure.ts`. These helpers are the two
// decisions the UI + the edge function make, kept here so they're unit-testable.

/** The Danger zone sentence (PRIV-2 AC10; approved wording, specs/privacy-account-erasure.md). */
export const DANGER_ZONE_COPY =
  "Permanently delete your account and your personal data. This also cancels your Moduo plan. Things you shared with others stay with them, without your name. This can't be undone.";

/** What the sign-in page says after a self-service deletion (PRIV-2 AC11). */
export const ACCOUNT_DELETED_NOTICE = "Your account and your data were deleted.";

/** `/auth?deleted=1`: the Danger zone lands there after a successful delete. */
export function validateAuthSearch(search: Record<string, unknown>): { deleted?: 1 } {
  return search.deleted === 1 || search.deleted === "1" ? { deleted: 1 } : {};
}

/**
 * What the Danger zone does once the server has deleted the account. Analytics stops
 * first (signing out would track an event that brings back the PostHog person the
 * server just erased, PRIV-3). Then the sign-in page with the notice, and only then
 * the local sign-out: signed out while still inside the app, the app gate redirects
 * to a plain /auth on its own, and that redirect can win and drop the notice.
 */
export async function finishAccountDeletion(steps: {
  stopAnalytics: () => void;
  goToSignInWithNotice: () => Promise<unknown>;
  signOut: () => Promise<unknown>;
}): Promise<void> {
  steps.stopAnalytics();
  await steps.goToSignInWithNotice();
  await steps.signOut();
}

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
 * The edge function recomputes this exact filter server-side over the live rows
 * (`blockingWorkspaces` in supabase/functions/_shared/account-erasure.ts); keep
 * the two in lockstep (mirrors the member-permissions client/SQL pattern).
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
