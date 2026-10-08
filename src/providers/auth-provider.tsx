import { normalizePlanTier, type PlanTier } from "@contracts/vocabularies";
import { createContext, type PropsWithChildren, useContext, useEffect, useState } from "react";
import { attachFocusUser } from "../features/focus/engine";
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

export function AuthProvider({ children }: PropsWithChildren) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<RuntimeSession | null>(null);
  const [rt, setRt] = useState<ModuoRuntime | null>(null);
  const [planTier, setPlanTier] = useState<PlanTier>("free");

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

      setSession(finalSession);
      setLoading(false);

      // Analytics knows the person by user id only (never email) and stays off
      // unless they opted in — see lib/analytics.ts.
      void setAnalyticsUser(finalSession?.user?.id ?? null);
      if (finalSession?.user?.id) void Analytics.app.signedIn("cloud");

      // Non-critical: fetch plan tier from profile.
      const uid = finalSession?.user?.id;
      if (uid) {
        try {
          const { data: profile } = await client.workspace.getProfile(uid);
          if (active && profile?.plan_tier) setPlanTier(normalizePlanTier(profile.plan_tier));
        } catch {
          // ignore — keep "free" default
        }
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

      if (event === "TOKEN_REFRESHED") {
        console.debug("[auth] token refreshed", {
          userId: nextSession?.user?.id,
          expiresAt: nextSession?.expires_at,
        });
      }

      // Refresh plan tier on sign-in events.
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && nextSession?.user?.id) {
        rt.workspace
          .getProfile(nextSession.user.id)
          .then(({ data: profile }) => {
            if (active && profile?.plan_tier) setPlanTier(normalizePlanTier(profile.plan_tier));
          })
          .catch(() => {});
      }

      if (event === "SIGNED_OUT") {
        setPlanTier("free");
        // Tracked first (if they opted in), then analytics opts out and forgets them.
        void Analytics.app.signedOut();
        void setAnalyticsUser(null);
      } else {
        void setAnalyticsUser(nextSession?.user?.id ?? null);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [rt]);

  // The focus session is persisted per person: resume it on sign-in, hand it
  // back on sign-out (TV-F1). Skipped while the cached session is still loading.
  const sessionUserId = session?.user?.id ?? null;
  useEffect(() => {
    if (!loading) attachFocusUser(sessionUserId);
  }, [loading, sessionUserId]);

  const signOut = async () => {
    if (!rt) return;
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
