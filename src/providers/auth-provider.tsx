import { normalizePlanTier, type PlanTier } from "@contracts/vocabularies";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Analytics, setAnalyticsUser } from "../lib/analytics";
import {
  initRuntime,
  type ModuoRuntime,
  type RuntimeSession,
  runtimeConfigError,
} from "../lib/runtime";

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

/**
 * Analytics knows the person by user id only (never email) and stays off unless they opted
 * in — see lib/analytics.ts. It also starts only for an account the server still has: a
 * session cached on this device outlives an account deleted elsewhere by up to an hour, and
 * identifying it would bring the erased PostHog person back (PRIV-3). A deleted account has
 * no profile, so the profile read the plan tier needs anyway is the check. Nothing happens
 * if the session changed while it ran. Returns whether analytics started for `userId`.
 */
function startAnalyticsIfAccountExists(
  sessionUser: { current: string | null },
  userId: string,
  profile: unknown,
): boolean {
  if (sessionUser.current !== userId) return false;
  void setAnalyticsUser(profile ? userId : null);
  return Boolean(profile);
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
      try {
        ({ data: profile } = await client.workspace.getProfile(uid));
      } catch {
        // ignore — keep "free" default, and analytics off until the next launch
      }
      if (!active) return;
      if (profile?.plan_tier) setPlanTier(normalizePlanTier(profile.plan_tier));
      if (startAnalyticsIfAccountExists(sessionUser, uid, profile)) {
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
        rt.workspace
          .getProfile(uid)
          .then(({ data: profile }) => {
            if (!active) return;
            if (profile?.plan_tier) setPlanTier(normalizePlanTier(profile.plan_tier));
            startAnalyticsIfAccountExists(sessionUser, uid, profile);
          })
          .catch(() => {});
      }

      if (event === "SIGNED_OUT") {
        setPlanTier("free");
        // Analytics opts out and forgets them. `app_signed_out` is tracked in signOut(),
        // only when the person signs out: one auth-js does on its own, like a refused
        // refresh after the account was deleted elsewhere, must not send an event that
        // brings back the PostHog person the deletion erased (PRIV-3).
        void setAnalyticsUser(null);
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

  const signOut = async () => {
    if (!rt) return;
    // Tracked first (if they opted in); the SIGNED_OUT that follows opts analytics out.
    void Analytics.app.signedOut();
    await rt.auth.signOut();
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
