/**
 * The consent screen an app's "Sign in with Moduo" lands on (MCPO-4,
 * specs/mcp-oauth.md AC5–AC7). Supabase Auth's OAuth 2.1 server sends the
 * browser here with `?authorization_id=…` (supabase/config.toml's
 * authorization_url_path); Approve turns the person's choices into a
 * connection (workspace_api_keys_connect_oauth) and only then lets Supabase
 * send the browser back to the app with its code.
 *
 * Outside the app gate, like /join (Maciej OK'd the route, 2026-10-22): a
 * signed-out person is sent to the email-code sign-in and comes back here
 * through the pending-consent hand-off. This route has no WorkspaceProvider,
 * so it reads the person's workspaces from the runtime itself.
 *
 * Supabase Auth approves a returning app's sign-in by itself the moment this
 * page reads it (docs/gotchas/supabase.md): the redirect it answers with
 * already carries the code. The page holds it and follows it only after the
 * person's own Approve, so access is always seen before it changes.
 */

import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowUpRight, Check } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import {
  expiryDays,
  scopesPayload,
  scopeSummary,
  toKeyScopes,
} from "../../features/settings/api-keys";
import {
  appDisplayName,
  approveBlocker,
  consentCeilings,
  consentTitle,
  type ConsentWorkspace,
  deniedRedirect,
  expiredMessage,
  initialDraft,
  initialWorkspaceId,
  isCheckedApp,
  moveLine,
  returnsTo,
  shownScopes,
  UNCHECKED_APP_NOTE,
  workspaceChoices,
} from "../../features/settings/oauth-consent";
import { KeyExpiryField, KeyScopeFields } from "../../features/settings/sections/key-scope-fields";
import { setPendingConsent } from "../../features/workspaces/pending-consent";
import { mapWorkspace, storageKey } from "../../features/workspaces/workspace-mappers";
import type { OAuthConsentRequest } from "../../lib/runtime";
import { useAuth } from "../../providers/auth-provider";

const CHAT_PLAN_NOTE = "Chat is on the Duo and Team plans.";

function ConsentShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-xl items-center justify-center px-5 py-8">
        <div className="w-full rounded-xl border border-border bg-card px-6 py-7 shadow-xl sm:px-7 sm:py-8">
          {children}
        </div>
      </div>
    </div>
  );
}

/** The card's shape while the sign-in is read: the same rows, quietly. */
function ConsentSkeleton() {
  return (
    <ConsentShell>
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-9 w-full" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
        <Skeleton className="h-9 w-full" />
      </div>
    </ConsentShell>
  );
}

type Phase =
  | { kind: "reading" }
  | { kind: "expired"; appName: string | null }
  | { kind: "ready"; request: OAuthConsentRequest; workspaces: ConsentWorkspace[] }
  | { kind: "leaving"; appName: string; approved: boolean; url: string };

export function OAuthConsentPage() {
  const { runtime, userId, userEmail, isSignedIn, loading } = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { authorization_id?: string };
  const authorizationId = search.authorization_id?.trim() || null;
  const [phase, setPhase] = useState<Phase>({ kind: "reading" });

  // Signed out: the email-code sign-in, then back here (pending consent).
  useEffect(() => {
    if (!authorizationId) setPhase({ kind: "expired", appName: null });
  }, [authorizationId]);

  useEffect(() => {
    if (loading || isSignedIn || !authorizationId) return;
    setPendingConsent(authorizationId);
    void navigate({ to: "/auth", replace: true });
  }, [loading, isSignedIn, authorizationId, navigate]);

  // Read the sign-in once per page: reading it is what binds it to this
  // person (and, for a returning app, approves it on Auth's side).
  const readFor = useRef<string | null>(null);
  useEffect(() => {
    if (loading || !isSignedIn || !runtime || !userId) return;
    if (!authorizationId) {
      setPhase({ kind: "expired", appName: null });
      return;
    }
    if (readFor.current === authorizationId) return;
    readFor.current = authorizationId;
    void (async () => {
      try {
        const [request, rows] = await Promise.all([
          runtime.workspace.readOAuthRequest(authorizationId),
          runtime.workspace.list(),
        ]);
        if (!request) {
          setPhase({ kind: "expired", appName: null });
          return;
        }
        const workspaces = rows
          .map((row) => mapWorkspace(row, userId))
          .filter((ws) => !ws.isDeleted)
          .map((ws) => ({ id: ws.id, name: ws.name, actor: { role: ws.role, perms: ws.perms } }));
        setPhase({ kind: "ready", request, workspaces });
      } catch (err) {
        console.warn("[oauth-consent] read", err);
        setPhase({ kind: "expired", appName: null });
      }
    })();
  }, [loading, isSignedIn, runtime, userId, authorizationId]);

  if (loading || (!isSignedIn && authorizationId) || phase.kind === "reading") {
    return <ConsentSkeleton />;
  }

  if (phase.kind === "expired") {
    return (
      <ConsentShell>
        <h1 className="font-display text-lg text-foreground">Sign-in link expired</h1>
        <p className="mt-2 text-sm text-muted-foreground" role="alert">
          {expiredMessage(phase.appName)}
        </p>
        <Button
          variant="outline"
          className="mt-5 w-full"
          onClick={() => void navigate({ to: "/", replace: true })}
        >
          Go to Moduo
        </Button>
      </ConsentShell>
    );
  }

  if (phase.kind === "leaving") {
    return (
      <ConsentShell>
        <h1 className="font-display text-lg text-foreground">
          {phase.approved ? `${phase.appName} is connected` : `${phase.appName} wasn't connected`}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground" role="status">
          {phase.approved
            ? `Taking you back to ${phase.appName}. If nothing happens, go back to it yourself; you can close this tab.`
            : `Nothing was shared. Taking you back to ${phase.appName}.`}
        </p>
        <Button asChild variant="outline" className="mt-5 w-full">
          <a href={phase.url}>
            <ArrowUpRight aria-hidden />
            Back to {phase.appName}
          </a>
        </Button>
      </ConsentShell>
    );
  }

  return (
    <ConsentForm
      request={phase.request}
      workspaces={phase.workspaces}
      userEmail={userEmail}
      rememberedWorkspaceId={readRemembered(userId)}
      onExpired={(appName) => setPhase({ kind: "expired", appName })}
      onLeave={(appName, approved, url) => {
        setPhase({ kind: "leaving", appName, approved, url });
        window.location.assign(url);
      }}
      onSignedOut={() => {
        if (authorizationId) setPendingConsent(authorizationId);
        void navigate({ to: "/auth", replace: true });
      }}
    />
  );
}

function readRemembered(userId: string | null): string | null {
  if (!userId) return null;
  try {
    return window.localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

function errorCode(err: unknown): string | undefined {
  return typeof err === "object" && err && "code" in err && typeof err.code === "string"
    ? err.code
    : undefined;
}

function ConsentForm({
  request,
  workspaces,
  userEmail,
  rememberedWorkspaceId,
  onExpired,
  onLeave,
  onSignedOut,
}: {
  request: OAuthConsentRequest;
  workspaces: ConsentWorkspace[];
  userEmail: string | null;
  rememberedWorkspaceId: string | null;
  onExpired: (appName: string | null) => void;
  onLeave: (appName: string, approved: boolean, url: string) => void;
  onSignedOut: () => void;
}) {
  const { runtime, isSignedIn } = useAuth();
  const appName = appDisplayName(request);
  const connection = request.connection;
  const choices = useMemo(
    () => workspaceChoices(workspaces, request.fullWorkspaceIds),
    [workspaces, request.fullWorkspaceIds],
  );
  const [workspaceId, setWorkspaceId] = useState<string | null>(() =>
    initialWorkspaceId(choices, connection?.workspaceId ?? null, rememberedWorkspaceId),
  );
  const start = useMemo(() => initialDraft(connection), [connection]);
  const [scopes, setScopes] = useState(start.scopes);
  const [expiry, setExpiry] = useState<string>(start.expiry);
  const [includePrivateChat, setIncludePrivateChat] = useState(start.includePrivateChat);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatEnabled, setChatEnabled] = useState<boolean | null>(null);
  const privateId = useId();
  const accessId = useId();

  const choice = choices.find((c) => c.id === workspaceId) ?? null;
  const workspace = workspaces.find((w) => w.id === workspaceId) ?? null;
  const noneQualify = choices.every((c) => c.disabled);
  const shown = workspace ? shownScopes(scopes, workspace.actor) : scopes;
  const ceilings = workspace ? consentCeilings(workspace.actor) : null;
  const returnAddress = returnsTo(request.clientScheme, request.clientDomain);
  const blocker = approveBlocker(choice, shown);
  const move = moveLine(
    appName,
    connection,
    workspaceId,
    (id) => workspaces.find((w) => w.id === id)?.name ?? null,
  );
  const currentWorkspaceName = connection
    ? (workspaces.find((w) => w.id === connection.workspaceId)?.name ?? null)
    : null;

  useEffect(() => {
    if (!runtime || !workspaceId) return;
    let live = true;
    setChatEnabled(null);
    runtime.chat
      .isEnabled(workspaceId)
      .then((on) => live && setChatEnabled(on))
      .catch(() => live && setChatEnabled(null));
    return () => {
      live = false;
    };
  }, [runtime, workspaceId]);

  const handleApprove = async () => {
    if (!runtime || !workspaceId || blocker || busy) return;
    if (!isSignedIn) {
      onSignedOut();
      return;
    }
    setBusy("approve");
    setError(null);
    try {
      await runtime.workspace.connectOAuthApp({
        authorizationId: request.authorizationId,
        workspaceId,
        scopes: scopesPayload(shown),
        expiresInDays: expiryDays(expiry),
        includePrivateChat: shown.chat !== "none" && includePrivateChat,
      });
      // A returning app was approved on Auth's side when the page read it;
      // its redirect (with the code) is the one to follow now.
      const url =
        request.heldRedirect ??
        (await runtime.workspace.approveOAuthRequest(request.authorizationId));
      onLeave(appName, true, url);
    } catch (err) {
      setBusy(null);
      const code = errorCode(err);
      if (code === "P0002") return onExpired(appName);
      if (code === "42501" && /sign in/i.test(err instanceof Error ? err.message : "")) {
        return onSignedOut();
      }
      const message = err instanceof Error ? err.message : `Couldn't connect ${appName}.`;
      setError(message);
      toast.error(message);
    }
  };

  const handleDeny = async () => {
    if (!runtime || busy) return;
    setBusy("deny");
    setError(null);
    try {
      const url = request.heldRedirect
        ? deniedRedirect(request.heldRedirect)
        : await runtime.workspace.denyOAuthRequest(request.authorizationId);
      if (!url) throw new Error(`Couldn't tell ${appName}. Close this tab; nothing was shared.`);
      onLeave(appName, false, url);
    } catch (err) {
      setBusy(null);
      const message = err instanceof Error ? err.message : `Couldn't tell ${appName}.`;
      setError(message);
    }
  };

  const disabled = busy !== null;

  return (
    <ConsentShell>
      <h1 className="font-display text-lg text-foreground">{consentTitle(appName)}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {returnAddress ? (
          <>
            Returns to <span className="font-mono text-foreground">{returnAddress}</span>
          </>
        ) : (
          "Its website isn't known."
        )}
        {isCheckedApp(request.clientScheme, request.clientDomain) ? null : (
          <span className="block text-xs">{UNCHECKED_APP_NOTE}</span>
        )}
      </p>
      {userEmail ? (
        <p className="mt-3 text-xs text-muted-foreground">Signed in as {userEmail}</p>
      ) : null}

      {connection ? (
        <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
          Connected now{currentWorkspaceName ? ` in ${currentWorkspaceName}` : ""} ·{" "}
          {scopeSummary(toKeyScopes(connection.scopes))}. Approving replaces this with what you
          choose below.
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-2">
        <Label htmlFor={`${accessId}-workspace`}>Workspace</Label>
        <Select
          value={workspaceId ?? undefined}
          onValueChange={setWorkspaceId}
          disabled={disabled || noneQualify}
        >
          <SelectTrigger id={`${accessId}-workspace`} className="w-full">
            <SelectValue placeholder="No workspace" />
          </SelectTrigger>
          <SelectContent>
            {choices.map((c) => (
              <SelectItem key={c.id} value={c.id} disabled={c.disabled}>
                {c.name}
                {c.disabled ? (
                  <span className="text-xs text-muted-foreground">· no API keys</span>
                ) : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {move ? <p className="text-xs text-warning">{move}</p> : null}
        {choices.some((c) => c.disabled) && !noneQualify ? (
          <p className="text-xs text-muted-foreground">
            Workspaces marked “no API keys”: your role doesn&apos;t include API keys there. Ask the
            workspace owner.
          </p>
        ) : null}
      </div>

      {workspace && ceilings ? (
        <>
          <div className="mt-5 flex flex-col gap-2">
            <span id={`${accessId}-access`} className="text-sm font-medium text-foreground">
              What {appName} can reach
            </span>
            <KeyScopeFields
              aria-labelledby={`${accessId}-access`}
              value={shown}
              onChange={setScopes}
              ceilings={ceilings}
              extraNotes={chatEnabled === false ? { chat: CHAT_PLAN_NOTE } : undefined}
              disabled={disabled}
            />
          </div>
          {shown.chat !== "none" ? (
            <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <Label htmlFor={privateId} className="text-sm text-foreground">
                  Include private channels I&apos;m in
                </Label>
                <span id={`${privateId}-hint`} className="text-xs text-muted-foreground">
                  Off: it reads public channels only. Direct messages stay out of reach of every
                  app.
                </span>
              </div>
              <Switch
                id={privateId}
                aria-describedby={`${privateId}-hint`}
                checked={includePrivateChat}
                disabled={disabled}
                onCheckedChange={(on) => setIncludePrivateChat(on === true)}
              />
            </div>
          ) : null}
          <div className="mt-4 border-t border-border pt-4">
            <KeyExpiryField
              value={expiry}
              onChange={setExpiry}
              hint={`After this, ${appName} has to sign in again.`}
              disabled={disabled}
            />
          </div>
        </>
      ) : null}

      <p className="mt-5 text-xs text-muted-foreground">
        It acts as you and never gets more than you can do. Everything it does is attributed to “you
        · via {appName}”. Disconnect it any time in Settings → API keys.
      </p>

      {blocker || error ? (
        <p
          className={`mt-3 text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}
          role={error ? "alert" : undefined}
        >
          {error ?? blocker}
        </p>
      ) : null}

      <div className="mt-5 flex items-center justify-end gap-2 border-t border-border pt-5">
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleDeny()}
          disabled={disabled}
        >
          {busy === "deny" ? "Denying…" : "Deny"}
        </Button>
        <Button
          type="button"
          onClick={() => void handleApprove()}
          disabled={disabled || blocker !== null}
        >
          <Check aria-hidden />
          {busy === "approve" ? "Connecting…" : "Approve"}
        </Button>
      </div>
    </ConsentShell>
  );
}
