import { normalizePlanTier, type PlanTier } from "@contracts/vocabularies";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { attachFocusUser } from "../features/focus/engine";
import { attachTagUser } from "../features/tags/store";
import { forgetCaptureDrafts, keepCaptureDraftsOf } from "../features/tasks/capture/capture-draft";
import { forgetRememberedWorkspaces } from "../features/workspaces/remembered-workspaces";
import { Analytics, setAnalyticsUser } from "../lib/analytics";
import { sendDeviceTimeZone } from "../lib/device-time-zone";
import {
  initRuntime,
  type ModuoRuntime,
  type RuntimeSession,
  runtimeConfigError,
} from "../lib/runtime";
import { attachSyncUser, wipeSyncCopies } from "../lib/sync/store";

export type { PlanTier } from "@contracts/vocabularies";

export type AuthContextValue = {
  userId: string | null;
  userEmail: string | null;
  accessToken: string | null;
  isSignedIn: boolean;
  loading: boolean;
  configError: string | null;
  runtime: ModuoRuntime | null;
  planTier: PlanTier;
  signOut: () => Promise<void>;
  refreshPlanTier: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue>({
  userId: null,
  userEmail: null,
  accessToken: null,
  isSignedIn: false,
  loading: true,
  configError: null,
  runtime: null,
  planTier: "free",
  signOut: async () => {},
  refreshPlanTier: async () => {},
});

/** What a profile read says about the account: there (a row), gone (the read worked and
 *  found no row, PostgREST's PGRST116 for `.single()`), or unknown (offline, an outage). */
type AccountCheck = "exists" | "gone" | "unknown";

function accountCheck(result: { data: unknown; error: unknown }): AccountCheck {
  if (result.data) return "exists";
  return (result.error as { code?: unknown } | null)?.code === "PGRST116" ? "gone" : "unknown";
}

/**
 * Analytics knows the person by user id only (never email) and stays off unless they opted
 * in — see lib/analytics.ts. It also starts only for an account the server still has: a
 * session cached on this device outlives an account deleted elsewhere by up to an hour, and
 * identifying it would bring the erased PostHog person back (PRIV-3). A deleted account has
 * no profile, so the profile read the plan tier needs anyway is the check. A confirmed
 * absence stops analytics; a failed read leaves it as it is, so a blip mid-session never
 * resets a consenting person's PostHog identity. Nothing happens if the session changed
 * while it ran. Returns whether analytics started for `userId`.
 */
function startAnalyticsIfAccountExists(
  sessionUser: { current: string | null },
  userId: string,
  check: AccountCheck,
): boolean {
  if (sessionUser.current !== userId) return false;
  if (check === "exists") {
    void setAnalyticsUser(userId);
    return true;
  }
  if (check === "gone") void setAnalyticsUser(null);
  return false;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<RuntimeSession | null>(null);
  const [rt, setRt] = useState<ModuoRuntime | null>(null);
  const [planTier, setPlanTier] = useState<PlanTier>("free");
  // Whose session is current, for the checks above that resolve later.
  const sessionUser = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      const client = await initRuntime();
      if (!active) return;
      setRt(client);

      // Restore cached Supabase session first.
      const { data } = await client.auth.getSession();
      if (!active) return;

      const finalSession = data.session ?? null;
      const uid = finalSession?.user?.id ?? null;
      sessionUser.current = uid;

      setSession(finalSession);
      setLoading(false);

      if (!uid) {
        void setAnalyticsUser(null);
        return;
      }

      // Non-critical: fetch plan tier from profile. The same read decides analytics.
      let profile: { plan_tier?: string | null } | null = null;
      let check: AccountCheck = "unknown";
      try {
        const result = await client.workspace.getProfile(uid);
        profile = result.data;
        check = accountCheck(result);
      } catch {
        // ignore — keep "free" default, and analytics off until a later read works
      }
      if (!active) return;
      if (profile?.plan_tier) setPlanTier(normalizePlanTier(profile.plan_tier));
      if (startAnalyticsIfAccountExists(sessionUser, uid, check)) {
        void Analytics.app.signedIn("cloud");
      }
    };

    void bootstrap();
    return () => {
      active = false;
    };
  }, []);

  // Once runtime is available, subscribe to auth state changes.
  useEffect(() => {
    if (!rt) return;
    let active = true;

    const {
      data: { subscription },
    } = rt.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession ?? null);
      setLoading(false);
      const uid = event === "SIGNED_OUT" ? null : (nextSession?.user?.id ?? null);
      sessionUser.current = uid;

      if (event === "TOKEN_REFRESHED") {
        console.debug("[auth] token refreshed", {
          userId: nextSession?.user?.id,
          expiresAt: nextSession?.expires_at,
        });
      }

      // Refresh plan tier on sign-in events, and start analytics once the account is confirmed.
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && uid) {
        // Repeats come back at their assignee's midnight (TV-D8).
        sendDeviceTimeZone(rt, uid);
        rt.workspace
          .getProfile(uid)
          .then((result) => {
            if (!active) return;
            if (result.data?.plan_tier) setPlanTier(normalizePlanTier(result.data.plan_tier));
            startAnalyticsIfAccountExists(sessionUser, uid, accountCheck(result));
          })
          .catch(() => {});
      }

      if (event === "SIGNED_OUT") {
        setPlanTier("free");
        // Kept capture drafts never outlive a sign-out on this device (TV-U14).
        forgetCaptureDrafts();
        // Analytics opts out and forgets them. `app_signed_out` is tracked in signOut(),
        // only when the person signs out: one auth-js does on its own, like a refused
        // refresh after the account was deleted elsewhere, must not send an event that
        // brings back the PostHog person the deletion erased (PRIV-3).
        void setAnalyticsUser(null);
        // A real sign-out (never a session that merely failed to load, e.g. an
        // expired token offline): the Tasks device copy, its waiting captures
        // and the remembered workspace list go (TV-D11a).
        void wipeSyncCopies();
        forgetRememberedWorkspaces();
      } else if (!uid) {
        void setAnalyticsUser(null);
      }
      // Any other event keeps the same person: analytics already follows them, or waits for
      // the next sign-in or launch if their account couldn't be confirmed.
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [rt]);

  // The focus session is persisted per person: resume it on sign-in, hand it
  // back on sign-out (TV-F1). The workspace tag store starts over for another
  // person (TV-T1). The shared Tasks store and its device copy are one
  // person's (TV-D11a): another person signing in wipes every copy but theirs;
  // no session stops the stores but keeps the copy (a session that failed to
  // load offline comes back; a real sign-out wipes it above). Skipped while
  // the cached session is still loading.
  const sessionUserId = session?.user?.id ?? null;
  useEffect(() => {
    if (loading) return;
    attachFocusUser(sessionUserId);
    attachTagUser(sessionUserId);
    void attachSyncUser(sessionUserId);
    // Another person's kept capture drafts go too (TV-U14).
    if (sessionUserId) keepCaptureDraftsOf(sessionUserId);
  }, [loading, sessionUserId]);

  const signOut = async () => {
    if (!rt) return;
    // Tracked first (if they opted in); the SIGNED_OUT that follows opts analytics out.
    void Analytics.app.signedOut();
    await rt.auth.signOut();
    // The person chose to sign out: their Tasks device copy goes even when
    // auth-js couldn't end the session (offline with an expired token, so no
    // SIGNED_OUT event follows) (TV-D11a).
    void wipeSyncCopies();
    forgetRememberedWorkspaces();
    forgetCaptureDrafts();
    setSession(null);
  };

  const refreshPlanTier = async () => {
    const uid = session?.user?.id;
    if (!rt || !uid) return;
    try {
      const { data: profile } = await rt.workspace.getProfile(uid);
      if (profile?.plan_tier) setPlanTier(normalizePlanTier(profile.plan_tier));
    } catch {
      /* ignore */
    }
  };

  return (
    <AuthContext.Provider
      value={{
        userId: session?.user?.id ?? null,
        userEmail: session?.user?.email ?? null,
        accessToken: session?.access_token ?? null,
        isSignedIn: !!session?.user,
        loading,
        configError: runtimeConfigError,
        runtime: rt,
        planTier,
        signOut,
        refreshPlanTier,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
