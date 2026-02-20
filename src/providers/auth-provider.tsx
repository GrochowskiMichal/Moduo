import { createContext, PropsWithChildren, useContext, useEffect, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { supabase, supabaseConfigError } from "../lib/supabase";

type AuthContextValue = {
  userId: string | null;
  userEmail: string | null;
  isSignedIn: boolean;
  loading: boolean;
  configError: string | null;
  supabase: SupabaseClient | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  userId: null,
  userEmail: null,
  isSignedIn: false,
  loading: true,
  configError: null,
  supabase: null,
  signOut: async () => {},
});

export function AuthProvider({ children }: PropsWithChildren) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;

    const sb = supabase; // narrowed from null check above
    const init = async () => {
      const { data } = await sb.auth.getSession();
      if (!active) return;
      setSession(data.session ?? null);
      setLoading(false);
    };

    void init();

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession ?? null);
      setLoading(false);

      // Log token refresh events to aid debugging
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
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
  };

  return (
    <AuthContext.Provider
      value={{
        userId: session?.user?.id ?? null,
        userEmail: session?.user?.email ?? null,
        isSignedIn: !!session?.user,
        loading,
        configError: supabaseConfigError,
        supabase,
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
