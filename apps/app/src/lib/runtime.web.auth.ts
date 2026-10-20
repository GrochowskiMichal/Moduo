import type {
  AuthChangeEvent,
  AuthListener,
  AuthRuntime,
  LocalAuthState,
  OtpSendError,
  RuntimeSession,
} from "./runtime.types";
import { bootReads, supabaseClient } from "./runtime.web.client";
import { desktopOnly, getAuthedUser } from "./runtime.web.shared";

function toError(error: unknown): { message: string } {
  if (error instanceof Error) return { message: error.message };
  if (error && typeof error === "object" && "message" in error)
    return { message: String((error as any).message) };
  return { message: String(error) };
}

/** toError, keeping auth-js's `code` and `status` (AuthApiError) for the sign-in screen. */
function toOtpSendError(error: unknown): OtpSendError {
  const base: OtpSendError = toError(error);
  if (error && typeof error === "object") {
    const { code, status } = error as { code?: unknown; status?: unknown };
    if (typeof code === "string" && code) base.code = code;
    if (typeof status === "number") base.status = status;
  }
  return base;
}

function sessionFromSupabase(supaSession: any): RuntimeSession | null {
  if (!supaSession?.access_token || !supaSession?.user?.id) return null;
  return {
    access_token: supaSession.access_token,
    refresh_token: supaSession.refresh_token ?? null,
    expires_at: supaSession.expires_at ?? undefined,
    user: {
      id: supaSession.user.id,
      email: supaSession.user.email ?? null,
    },
  };
}

export const webAuth: AuthRuntime = {
  async getLocalAuthState() {
    // Cloud-auth equivalent of the desktop vault state: derived from the
    // Supabase session so display-name consumers work on every platform.
    const empty: LocalAuthState = {
      profileExists: false,
      displayName: null,
      userId: null,
      hasPin: false,
      hasKeychainMnemonic: false,
    };
    try {
      const { data } = await supabaseClient.auth.getSession();
      const user = data.session?.user;
      if (!user) return { data: empty, error: null };
      return {
        data: {
          profileExists: true,
          displayName: (user.user_metadata?.display_name as string | undefined) ?? null,
          userId: user.id,
          hasPin: false,
          hasKeychainMnemonic: false,
        },
        error: null,
      };
    } catch {
      return { data: empty, error: null };
    }
  },

  async generateMnemonic() {
    return { data: { words: [], phrase: "" }, error: desktopOnly() };
  },

  async registerLocalMnemonic() {
    return { data: { user: null, session: null }, error: desktopOnly() };
  },

  async unlockWithMnemonic() {
    return { data: { user: null, session: null }, error: desktopOnly() };
  },

  async forgotResetLocal() {
    return { error: desktopOnly() };
  },

  async tryAutoUnlock() {
    try {
      const { data, error } = await supabaseClient.auth.getSession();
      if (error || !data.session) return { data: { session: null }, error: null };
      return { data: { session: sessionFromSupabase(data.session) }, error: null };
    } catch (error) {
      return { data: { session: null }, error: toError(error) };
    }
  },

  async setPin() {
    return { error: desktopOnly() };
  },

  async unlockWithPin() {
    return { data: { session: null }, error: desktopOnly() };
  },

  async removePin() {
    return { error: desktopOnly() };
  },

  async updateDisplayName(displayName: string) {
    try {
      const {
        data: { user },
        error,
      } = await supabaseClient.auth.updateUser({
        data: { display_name: displayName },
      });
      if (error) return { data: { displayName }, error: toError(error) };
      // Also update profiles table
      const uid = user?.id;
      if (uid) {
        await supabaseClient.from("profiles").update({ display_name: displayName }).eq("id", uid);
        bootReads.invalidate(`profile:${uid}`); // the cached row now has a stale name
      }
      return { data: { displayName }, error: null };
    } catch (error) {
      return { data: { displayName }, error: toError(error) };
    }
  },

  async updateAvatarUrl(avatarUrl: string | null) {
    try {
      const user = await getAuthedUser();
      if (!user) return { data: { avatarUrl }, error: { message: "Not authenticated" } };
      const { error } = await supabaseClient
        .from("profiles")
        .update({ avatar_url: avatarUrl })
        .eq("id", user.id)
        .select("avatar_url")
        .single();
      if (error) return { data: { avatarUrl }, error: toError(error) };
      bootReads.invalidate(`profile:${user.id}`);
      return { data: { avatarUrl }, error: null };
    } catch (error) {
      return { data: { avatarUrl }, error: toError(error) };
    }
  },

  async getStoredMnemonic() {
    return { data: { phrase: null }, error: desktopOnly() };
  },

  async getSession() {
    try {
      const { data, error } = await supabaseClient.auth.getSession();
      if (error) return { data: { session: null }, error: toError(error) };
      return { data: { session: sessionFromSupabase(data.session) }, error: null };
    } catch (error) {
      return { data: { session: null }, error: toError(error) };
    }
  },

  async refreshSession() {
    try {
      const { data, error } = await supabaseClient.auth.refreshSession();
      if (error) return { data: { user: null, session: null }, error: toError(error) };
      const session = sessionFromSupabase(data.session);
      return { data: { user: session?.user ?? null, session }, error: null };
    } catch (error) {
      return { data: { user: null, session: null }, error: toError(error) };
    }
  },

  onAuthStateChange(callback: AuthListener) {
    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((event, supaSession) => {
      const eventMap: Record<string, AuthChangeEvent> = {
        INITIAL_SESSION: "INITIAL_SESSION",
        SIGNED_IN: "SIGNED_IN",
        SIGNED_OUT: "SIGNED_OUT",
        TOKEN_REFRESHED: "TOKEN_REFRESHED",
        USER_UPDATED: "TOKEN_REFRESHED",
      };
      const mapped = eventMap[event] ?? "TOKEN_REFRESHED";
      callback(mapped, sessionFromSupabase(supaSession));
    });
    return { data: { subscription: { unsubscribe: () => subscription.unsubscribe() } } };
  },

  async signOut() {
    try {
      const { error } = await supabaseClient.auth.signOut();
      if (error) return { error: toError(error) };
      return { error: null };
    } catch (error) {
      return { error: toError(error) };
    }
  },

  async signUpWithEmail({ email, password, displayName }) {
    try {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName ?? "" } },
      });
      if (error) return { data: { user: null, session: null }, error: toError(error) };
      const session = sessionFromSupabase(data.session);
      return {
        data: {
          user:
            (session?.user ?? data.user)
              ? { id: data.user!.id, email: data.user!.email ?? null }
              : null,
          session,
        },
        error: null,
      };
    } catch (error) {
      return { data: { user: null, session: null }, error: toError(error) };
    }
  },

  async signInWithEmail({ email, password }) {
    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) return { data: { user: null, session: null }, error: toError(error) };
      const session = sessionFromSupabase(data.session);
      return { data: { user: session?.user ?? null, session }, error: null };
    } catch (error) {
      return { data: { user: null, session: null }, error: toError(error) };
    }
  },

  async sendOtp({ email }) {
    try {
      const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        // Invite-only (TX-4): a first sign-in creates the account, and Supabase's
        // before-user-created hook (public.hook_before_user_created) lets that
        // happen only for an invited address; anyone else is refused with
        // `invite_only` and no account or email. Existing users never reach the
        // hook. Until sign-ups are switched on, Auth refuses new addresses as
        // `signup_disabled` (otp-send-error.ts has the copy for each).
        options: { shouldCreateUser: true },
      });
      if (error) return { data: {}, error: toOtpSendError(error) };
      return { data: {}, error: null };
    } catch (error) {
      return { data: {}, error: toOtpSendError(error) };
    }
  },

  async verifyOtp({ email, token, sentAt }) {
    try {
      const { data, error } = await supabaseClient.auth.verifyOtp({
        email,
        token,
        type: "email",
      });
      if (error) return { data: { user: null, session: null }, error: toError(error) };
      const session = sessionFromSupabase(data.session);
      // An invited user exists from invite time but is only confirmed on their first
      // sign-in, so "first confirmed" (not "first created") marks a new user.
      const firstSeenAt = data.user?.email_confirmed_at
        ? new Date(data.user.email_confirmed_at).getTime()
        : 0;
      const isNewUser = !!sentAt && !!firstSeenAt && firstSeenAt >= sentAt - 30_000;
      return { data: { user: session?.user ?? null, session, isNewUser }, error: null };
    } catch (error) {
      return { data: { user: null, session: null, isNewUser: false }, error: toError(error) };
    }
  },
};
