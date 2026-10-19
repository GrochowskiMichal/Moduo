import { normalizePlanTier, type PlanTier } from "@contracts/vocabularies";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { forgetSearches } from "../features/chat/find/model";
import { forgetChatPresence } from "../features/chat/store/react";
import { attachChatUser, wipeChatCopies } from "../features/chat/store/store";
import { attachFocusUser } from "../features/focus/engine";
import { attachRunUser } from "../features/focus/run";
import { attachTagUser } from "../features/tags/store";
import { forgetCaptureDrafts, keepCaptureDraftsOf } from "../features/tasks/capture/capture-draft";
import { clearTemplates } from "../features/tasks/templates/templates-store";
import { forgetRememberedWorkspaces } from "../features/workspaces/remembered-workspaces";
import { Analytics, setAnalyticsUser } from "../lib/analytics";
import { forgetBrowserPush, postPushUser } from "../lib/notices/browser-push";
import {
  initRuntime,
  type ModuoRuntime,
  type RuntimeSession,
  runtimeConfigError,
} from "../lib/runtime";
import { attachSyncUser, wipeSyncCopies } from "../lib/sync/store";
import { forgetTimeRegion, syncTimeRegion } from "../lib/time-region";

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
      const previousUser = sessionUser.current;
      sessionUser.current = uid;
      // Another person (or nobody): no presence, "Show me as online" or
      // statuses read for the one before stay in this tab (CV-17).
      if (previousUser && previousUser !== uid) forgetChatPresence();

      if (event === "TOKEN_REFRESHED") {
        console.debug("[auth] token refreshed", {
          userId: nextSession?.user?.id,
          expiresAt: nextSession?.expires_at,
        });
      }

      // Refresh plan tier on sign-in events, and start analytics once the account is confirmed.
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && uid) {
        // Time & region (TV-D14): the person's zone, week start, clock and
        // date order; a zone nobody picked becomes this device's (repeats
        // come back at their assignee's midnight, TV-D8), a saved zone that
        // isn't the device's asks once.
        void syncTimeRegion(rt.preferences, uid);
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
        // Nor does the template list read this session (TV-D15).
        clearTemplates();
        // Dates read the device's way again; the person's copy goes (TV-D14).
        forgetTimeRegion(previousUser);
        // Analytics opts out and forgets them. `app_signed_out` is tracked in signOut(),
        // only when the person signs out: one auth-js does on its own, like a refused
        // refresh after the account was deleted elsewhere, must not send an event that
        // brings back the PostHog person the deletion erased (PRIV-3).
        void setAnalyticsUser(null);
        // A real sign-out (never a session that merely failed to load, e.g. an
        // expired token offline): the Tasks device copy's rows and the
        // remembered workspace list go (TV-D11a). What still waits to sync
        // stays under the person's key: auth-js fires this on its own when a
        // refresh token dies, and offline captures must survive that.
        void wipeSyncCopies();
        void wipeChatCopies();
        // Chat's remembered searches are the person's words too (CV-19).
        forgetSearches();
        forgetRememberedWorkspaces();
        // This browser's notices stop showing the person's words (TV-D12).
        void forgetBrowserPush(null);
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
    // Chat's device copy is one person's too (CV-3).
    void attachChatUser(sessionUserId);
    // Another person's kept capture drafts go too (TV-U14).
    if (sessionUserId) keepCaptureDraftsOf(sessionUserId);
    // The push worker shows a notice's words only to who's signed in (TV-D12).
    void postPushUser(sessionUserId);
  }, [loading, sessionUserId]);
  // The session's shared record follows the engine, after it (TV-F6, run.ts).
  useEffect(() => {
    if (loading) return;
    attachRunUser(sessionUserId, rt);
  }, [loading, sessionUserId, rt]);

  const signOut = async () => {
    if (!rt) return;
    // Tracked first (if they opted in); the SIGNED_OUT that follows opts analytics out.
    void Analytics.app.signedOut();
    // While the session still works: this browser stops getting the person's
    // notices (TV-D12).
    await forgetBrowserPush(rt);
    await rt.auth.signOut();
    // The person chose to sign out: their Tasks device copy goes even when
    // auth-js couldn't end the session (offline with an expired token, so no
    // SIGNED_OUT event follows) (TV-D11a); what waits to sync stays until they
    // sign in here again (Settings warns before this).
    void wipeSyncCopies();
    void wipeChatCopies();
    forgetSearches();
    forgetChatPresence();
    forgetRememberedWorkspaces();
    forgetCaptureDrafts();
    clearTemplates();
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
