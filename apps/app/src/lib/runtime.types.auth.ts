/** The runtime port's auth (implemented in runtime.web.auth.ts). */

export type RuntimeSession = {
  access_token: string;
  refresh_token?: string | null;
  expires_at?: number;
  user: {
    id: string;
    email?: string | null;
  };
};

export type AuthChangeEvent = "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED";
export type AuthListener = (event: AuthChangeEvent, session: RuntimeSession | null) => void;

export type RuntimeResult<T> = Promise<{ data: T; error: { message: string } | null }>;

/** A failed code request: Auth's message plus, when it sent them, its error code and HTTP status. */
export type OtpSendError = { message: string; code?: string; status?: number };

export type LocalAuthState = {
  profileExists: boolean;
  displayName: string | null;
  userId: string | null;
  hasPin: boolean;
  hasKeychainMnemonic: boolean;
};

export type AuthMnemonic = {
  words: string[];
  phrase: string;
};

export type AuthRuntime = {
  getLocalAuthState(): RuntimeResult<LocalAuthState>;
  generateMnemonic(): RuntimeResult<AuthMnemonic>;
  registerLocalMnemonic(args: {
    displayName: string;
    mnemonicPhrase: string;
    inviteToken?: string;
  }): RuntimeResult<{ user: RuntimeSession["user"] | null; session: RuntimeSession | null }>;
  unlockWithMnemonic(args: {
    mnemonicPhrase: string;
    inviteToken?: string;
  }): RuntimeResult<{ user: RuntimeSession["user"] | null; session: RuntimeSession | null }>;
  forgotResetLocal(): Promise<{ error: { message: string } | null }>;
  tryAutoUnlock(): RuntimeResult<{ session: RuntimeSession | null }>;
  setPin(pin: string): Promise<{ error: { message: string } | null }>;
  unlockWithPin(pin: string): RuntimeResult<{ session: RuntimeSession | null }>;
  removePin(): Promise<{ error: { message: string } | null }>;
  updateDisplayName(displayName: string): RuntimeResult<{ displayName: string }>;
  /** Writes `profiles.avatar_url`. Pass null to clear the picture. */
  updateAvatarUrl(avatarUrl: string | null): RuntimeResult<{ avatarUrl: string | null }>;
  getStoredMnemonic(): RuntimeResult<{ phrase: string | null }>;
  getSession(): RuntimeResult<{ session: RuntimeSession | null }>;
  refreshSession(): RuntimeResult<{
    user: RuntimeSession["user"] | null;
    session: RuntimeSession | null;
  }>;
  onAuthStateChange(cb: AuthListener): { data: { subscription: { unsubscribe(): void } } };
  signOut(): Promise<{ error: { message: string } | null }>;
  /** Cloud (Supabase) signup — desktop: links local identity to Supabase; web: primary signup. */
  signUpWithEmail(args: {
    email: string;
    password: string;
    displayName?: string;
  }): RuntimeResult<{ user: RuntimeSession["user"] | null; session: RuntimeSession | null }>;
  /** Cloud sign-in with email + password. */
  signInWithEmail(args: {
    email: string;
    password: string;
  }): RuntimeResult<{ user: RuntimeSession["user"] | null; session: RuntimeSession | null }>;
  /**
   * Send a magic OTP code to the given email (web primary auth). The error keeps
   * Supabase's `code` and HTTP `status` so the sign-in screen can say what went
   * wrong in its own words (otp-send-error.ts) instead of Auth's raw text.
   */
  sendOtp(args: { email: string }): Promise<{ data: {}; error: OtpSendError | null }>;
  /** Verify the OTP code received by email and sign the user in. */
  verifyOtp(args: { email: string; token: string; sentAt?: number }): RuntimeResult<{
    user: RuntimeSession["user"] | null;
    session: RuntimeSession | null;
    isNewUser?: boolean;
  }>;
};
