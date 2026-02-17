import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createSupabaseClient, supabaseConfigError } from "../lib/supabase";

type AuthContextValue = {
  userId: string | null;
  userEmail: string | null;
  isSignedIn: boolean;
  loading: boolean;
  configError: string | null;
  supabase: ReturnType<typeof createSupabaseClient> | null;
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

  const supabase = useMemo(() => {
    if (supabaseConfigError) return null;
    return createSupabaseClient();
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;

    const init = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session ?? null);
      setLoading(false);
    };

    void init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

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
