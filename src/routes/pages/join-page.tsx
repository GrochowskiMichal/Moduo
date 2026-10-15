/**
 * Workspace invite accept surface (DF-24) — the redeem end of the invite loop.
 *
 * A direct child of the root route, OUTSIDE the app gate (sibling of /auth,
 * /paywall, /p/$token): a brand-new invitee — who may have 0–1 workspaces and
 * would otherwise be bounced to /onboarding by the WorkspaceGate, or to the
 * first nav tab by AppChrome's redirect guard — reaches it pre-membership.
 *
 * The token rides in `?invite=<encodeURIComponent(token)>`, NOT a path segment:
 * invite tokens are base64 (`+` `/` `=`), which break a `/join/$token` path.
 * `joinInvite` is called directly on the runtime (this route has no
 * WorkspaceProvider); on success we persist the selected workspace so the app
 * boots into it, then hand off to `/`.
 */

import { parseOrError } from "@contracts/errors";
import { nonEmptyString } from "@contracts/primitives";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Check, LogIn, LogOut, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { InviteEmailMismatchError, setPendingJoin } from "../../features/workspaces/invite-join";
import { storageKey } from "../../features/workspaces/workspace-mappers";
import { useAuth } from "../../providers/auth-provider";

function JoinShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute left-1/2 top-[-260px] h-[520px] w-[620px] -translate-x-1/2 rounded-full bg-foreground/5 blur-3xl" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-[480px] items-center justify-center px-5 py-8">
        <div className="w-full rounded-xl border border-border bg-card px-6 py-7 shadow-xl sm:px-7 sm:py-8">
          {children}
        </div>
      </div>
    </div>
  );
}

export function JoinPage() {
  const { runtime, userId, isSignedIn, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { invite?: string };
  const inviteParsed = parseOrError(nonEmptyString, search.invite ?? "");
  const inviteToken = inviteParsed.success ? inviteParsed.data : null;

  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Signed in with another address than the invite's: the message to show.
  const [mismatch, setMismatch] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const handleAccept = async () => {
    if (!runtime || !inviteToken || joining) return;
    setJoining(true);
    setError(null);
    try {
      const invite = await runtime.workspace.joinInvite(inviteToken);
      const workspaceId = invite?.workspace_id ?? invite?.workspaceId ?? null;
      if (workspaceId && userId && typeof window !== "undefined") {
        // Boot straight into the workspace they just joined.
        window.localStorage.setItem(storageKey(userId), workspaceId);
      }
      toast.success("You've joined the workspace.");
      void navigate({ to: "/", replace: true });
    } catch (err) {
      if (err instanceof InviteEmailMismatchError) {
        setMismatch(err.message);
        setJoining(false);
        return;
      }
      const message = err instanceof Error ? err.message : "This invite is invalid or has expired.";
      setError(message);
      toast.error(message);
      setJoining(false);
    }
  };

  const handleSignIn = () => {
    // Bridge the token across the sign-in redirect (the code sign-in and
    // auth-page resume here).
    if (inviteToken) setPendingJoin(inviteToken);
    void navigate({ to: "/auth", replace: true });
  };

  // Wrong address: sign out and come back here after signing in with the right one.
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    if (inviteToken) setPendingJoin(inviteToken);
    try {
      await signOut();
    } finally {
      void navigate({ to: "/auth", replace: true });
    }
  };

  if (loading) {
    return (
      <JoinShell>
        <p className="text-sm text-muted-foreground">Checking your session…</p>
      </JoinShell>
    );
  }

  if (!inviteToken) {
    return (
      <JoinShell>
        <h1 className="font-display text-lg text-foreground">Invite link incomplete</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This link is missing its invite code. Ask whoever invited you to send it again.
        </p>
        <Button className="mt-5 w-full" onClick={() => void navigate({ to: "/", replace: true })}>
          Go to Moduo
        </Button>
      </JoinShell>
    );
  }

  if (!isSignedIn) {
    return (
      <JoinShell>
        <span className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-muted text-muted-foreground">
          <Users className="size-5" aria-hidden />
        </span>
        <h1 className="mt-4 font-display text-lg text-foreground">You've been invited</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in or create your account to accept this workspace invite.
        </p>
        <Button className="mt-5 w-full" onClick={handleSignIn}>
          <LogIn className="size-4" aria-hidden />
          Sign in to accept
        </Button>
      </JoinShell>
    );
  }

  if (mismatch) {
    return (
      <JoinShell>
        <span className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-muted text-muted-foreground">
          <Users className="size-5" aria-hidden />
        </span>
        <h1 className="mt-4 font-display text-lg text-foreground">You've been invited</h1>
        <p className="mt-2 text-sm text-muted-foreground" role="alert">
          {mismatch}
        </p>
        <Button className="mt-5 w-full" onClick={() => void handleSignOut()} disabled={signingOut}>
          <LogOut className="size-4" aria-hidden />
          Sign out
        </Button>
        <button
          type="button"
          onClick={() => void navigate({ to: "/", replace: true })}
          className="mt-3 w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:underline"
        >
          Skip for now
        </button>
      </JoinShell>
    );
  }

  return (
    <JoinShell>
      <span className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-muted text-muted-foreground">
        <Users className="size-5" aria-hidden />
      </span>
      <h1 className="mt-4 font-display text-lg text-foreground">Join this workspace</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        You've been invited to collaborate. Accept to add it to your workspaces.
      </p>

      {error ? (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        </div>
      ) : null}

      <Button className="mt-5 w-full" onClick={() => void handleAccept()} disabled={joining}>
        {joining ? (
          "Joining…"
        ) : (
          <>
            <Check className="size-4" aria-hidden />
            Accept invite
          </>
        )}
      </Button>
      <button
        type="button"
        onClick={() => void navigate({ to: "/", replace: true })}
        className="mt-3 w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:underline"
      >
        Skip for now
      </button>
    </JoinShell>
  );
}
