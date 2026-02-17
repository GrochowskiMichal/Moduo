import { createContext, PropsWithChildren, useContext, useMemo } from "react";
import { useAuth as useClerkAuth } from "@clerk/clerk-expo";
import { createSupabaseClient, supabaseConfigError } from "../lib/supabase";

type AuthContextValue = {
  userId: string | null;
  isSignedIn: boolean;
  loading: boolean;
  configError: string | null;
  supabase: ReturnType<typeof createSupabaseClient> | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  userId: null,
  isSignedIn: false,
  loading: true,
  configError: null,
  supabase: null,
  signOut: async () => {},
});

export function AuthProvider({ children }: PropsWithChildren) {
  const { userId, isSignedIn, isLoaded, getToken, signOut } = useClerkAuth();
  const supabase = useMemo(() => {
    if (supabaseConfigError) return null;
    return createSupabaseClient(async () => (await getToken()) ?? null);
  }, [getToken]);

  return (
    <AuthContext.Provider
      value={{
        userId: userId ?? null,
        isSignedIn: !!isSignedIn,
        loading: !isLoaded,
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
