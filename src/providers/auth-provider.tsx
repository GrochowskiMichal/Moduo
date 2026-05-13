import { createContext, PropsWithChildren, useContext, useEffect, useState } from "react";
import { initRuntime, runtimeConfigError, type ModuoRuntime, type RuntimeSession } from "../lib/runtime";
import { Analytics, identify, resetIdentity } from "../lib/analytics";

export type PlanTier = "free" | "pro" | "team" | "founders";

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
  syncSubscription: () => Promise<PlanTier>;
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
  syncSubscription: async () => "free",
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

      // Restore from cache / keychain first.
      const { data } = await client.auth.getSession();
      if (!active) return;

      const resolvedSession = data.session ?? (() => null)();
      let finalSession = resolvedSession;

      if (!resolvedSession) {
        // No cached session — attempt silent unlock (keychain on desktop, Supabase session on web).
        const { data: autoData } = await client.auth.tryAutoUnlock();
        if (!active) return;
        finalSession = autoData.session ?? null;
      }

      setSession(finalSession);
      setLoading(false);

      if (finalSession?.user?.id) {
        void identify(finalSession.user.id, { email: finalSession.user.email });
        void Analytics.app.signedIn("cloud");
      }

      // Non-critical: fetch plan tier from profile.
      const uid = finalSession?.user?.id;
      if (uid) {
        try {
          const { data: profile } = await client.workspace.getProfile(uid);
          if (active && profile?.plan_tier) setPlanTier(profile.plan_tier as PlanTier);
        } catch {
          // ignore — keep "free" default
        }
      }
    };

    void bootstrap();
    return () => { active = false; };
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
        rt.workspace.getProfile(nextSession.user.id)
          .then(({ data: profile }) => {
            if (active && profile?.plan_tier) setPlanTier(profile.plan_tier as PlanTier);
          })
          .catch(() => {});
      }

      if (event === "SIGNED_OUT") {
        setPlanTier("free");
        void resetIdentity();
        void Analytics.app.signedOut();
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [rt]);

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
      if (profile?.plan_tier) setPlanTier(profile.plan_tier as PlanTier);
    } catch { /* ignore */ }
  };

  const syncSubscription = async (): Promise<PlanTier> => {
    const token = session?.access_token;
    if (!token) return planTier;
    const SUPABASE_URL = (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) ??
      "https://wtoonrvuqumihpkbvwvs.supabase.co";
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-subscription`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const { plan_tier, error } = await res.json();
      if (error) throw new Error(error);
      if (plan_tier) setPlanTier(plan_tier as PlanTier);
      return (plan_tier as PlanTier) ?? planTier;
    } catch (err) {
      console.error("[auth] syncSubscription failed:", err);
      return planTier;
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
        syncSubscription,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
