import { createContext, PropsWithChildren, useContext, useEffect, useState } from "react";
import { runtime, runtimeConfigError, type ModuoRuntime, type RuntimeSession } from "../lib/runtime";

export type AuthContextValue = {
  userId: string | null;
  userEmail: string | null;
  accessToken: string | null;
  isSignedIn: boolean;
  loading: boolean;
  configError: string | null;
  runtime: ModuoRuntime | null;
  signOut: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue>({
  userId: null,
  userEmail: null,
  accessToken: null,
  isSignedIn: false,
  loading: true,
  configError: null,
  runtime: null,
  signOut: async () => {},
});

export function AuthProvider({ children }: PropsWithChildren) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<RuntimeSession | null>(null);

  useEffect(() => {
    if (!runtime) {
      setLoading(false);
      return;
    }

    let active = true;
    const client = runtime;

    const init = async () => {
      // Restore from DB cache first.
      const { data } = await client.auth.getSession();
      if (!active) return;
      if (data.session) {
        setSession(data.session);
        setLoading(false);
        return;
      }
      // No cached session — attempt silent unlock from OS keychain.
      const { data: autoData } = await client.auth.tryAutoUnlock();
      if (!active) return;
      setSession(autoData.session ?? null);
      setLoading(false);
    };

    void init();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession ?? null);
      setLoading(false);

      if (event === "TOKEN_REFRESHED") {
        console.debug("[auth] token refreshed", {
          userId: nextSession?.user?.id,
          expiresAt: nextSession?.expires_at,
        });
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    if (!runtime) return;
    await runtime.auth.signOut();
    setSession(null);
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
        runtime,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
