// The second half of connecting Google, Zoom or Outlook. The provider redirects to the
// connect function, which only checks its signed state and sends the browser
// back here with the code; this page then posts code + state with the signed-in
// session, and the function saves the tokens only when this user is the one who
// started.
//
// The page also finishes on its own only when this tab started the connect
// (`rememberConnectStart`). Anything else asks first, naming the signed-in
// account (a desktop Zoom connect always finishes in the browser this way).
// → supabase/functions/_shared/oauth-connect.ts

import { supabaseClient } from "../../lib/runtime.web.client";

export type ConnectProvider = "google" | "zoom" | "microsoft";

export type ConnectReturn = {
  provider: ConnectProvider;
  code: string;
  state: string;
  /** The page's search without the connect params ("" or "?…"). */
  search: string;
};

export type ConnectOutcome =
  | { provider: ConnectProvider; status: "connected" }
  | { provider: ConnectProvider; status: "failed"; message: string }
  | {
      provider: ConnectProvider;
      status: "confirm";
      title: string;
      /** Posts the finish; resolves to connected or failed. */
      confirm: () => Promise<ConnectOutcome>;
    };

/** Dispatched on window after a connect the person confirmed, so open views re-read. */
export const CONNECT_FINISHED_EVENT = "moduo:connect-finished";

const FUNCTIONS: Record<ConnectProvider, string> = {
  google: "booking-google-connect",
  zoom: "booking-zoom-connect",
  microsoft: "calendar-microsoft-web",
};

const LABELS: Record<ConnectProvider, string> = {
  google: "Google",
  zoom: "Zoom",
  microsoft: "Outlook",
};

const PARAMS = ["connect", "connect_code", "connect_state"];

const STARTED_KEY = "moduo:connect-state";

/** The connect a page's search comes back from (see connectReturnUrl), or null. */
export function parseConnectReturn(search: string): ConnectReturn | null {
  const params = new URLSearchParams(search);
  const provider = params.get("connect");
  if (provider !== "google" && provider !== "zoom" && provider !== "microsoft") return null;
  const code = params.get("connect_code") ?? "";
  const state = params.get("connect_state") ?? "";
  for (const key of PARAMS) params.delete(key);
  const rest = params.toString();
  return { provider, code, state, search: rest ? `?${rest}` : "" };
}

export function connectFailureMessage(provider: ConnectProvider, error: string | null): string {
  const label = LABELS[provider];
  if (error === "wrong_account") {
    return `${label} wasn't connected: it was started from a different Moduo account. Sign in as that account and connect again.`;
  }
  return `${label} didn't connect. Try again.`;
}

export function connectDoneMessage(provider: ConnectProvider): string {
  return `${LABELS[provider]} connected.`;
}

export function connectConfirmTitle(provider: ConnectProvider, email: string | null): string {
  return `Connect ${LABELS[provider]} to ${email || "this Moduo account"}?`;
}

/** Call with the consent URL right before this tab leaves for it, so the return finishes without asking. */
export function rememberConnectStart(consentUrl: string): void {
  try {
    const state = new URL(consentUrl).searchParams.get("state");
    if (state) sessionStorage.setItem(STARTED_KEY, state);
  } catch {
    // No storage: the return asks before finishing instead.
  }
}

function takeStartedState(): string | null {
  try {
    const state = sessionStorage.getItem(STARTED_KEY);
    sessionStorage.removeItem(STARTED_KEY);
    return state;
  } catch {
    return null;
  }
}

const CONNECTED_KEY = "moduo:connected:";

/** Outlook only: the page adds the login just connected as its calendar account. */
function markConnected(provider: ConnectProvider, data: unknown): void {
  if (provider !== "microsoft") return;
  const email = (data as { email?: unknown } | null)?.email;
  if (typeof email !== "string" || !email) return;
  try {
    sessionStorage.setItem(`${CONNECTED_KEY}${provider}`, email);
  } catch {
    // No storage: nothing is added on its own; connecting again adds it.
  }
}

/**
 * The login this tab just finished connecting to `provider` (on its own or
 * confirmed), until `clearJustConnected`; null when nothing waits.
 */
export function justConnected(provider: ConnectProvider): string | null {
  try {
    return sessionStorage.getItem(`${CONNECTED_KEY}${provider}`) || null;
  } catch {
    return null;
  }
}

export function clearJustConnected(provider: ConnectProvider): void {
  try {
    sessionStorage.removeItem(`${CONNECTED_KEY}${provider}`);
  } catch {
    // Nothing stored.
  }
}

let finishing: Promise<ConnectOutcome | null> | null = null;
let noticed = false;

/**
 * The connect this page load came back from, finished when this tab started it.
 * Runs once; later calls share the outcome. Null when the page didn't come back
 * from one.
 */
export function finishConnectReturn(): Promise<ConnectOutcome | null> {
  finishing ??= finish();
  return finishing;
}

/** The outcome for the one place that tells the person; null on every later call. */
export async function takeConnectNotice(): Promise<ConnectOutcome | null> {
  const outcome = await finishConnectReturn();
  if (!outcome || noticed) return null;
  noticed = true;
  return outcome;
}

async function finish(): Promise<ConnectOutcome | null> {
  const back = parseConnectReturn(window.location.search);
  if (!back) return null;
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${back.search}${window.location.hash}`,
  );
  const started = takeStartedState();
  if (!back.code || !back.state) return failed(back.provider, null);
  if (started === back.state) return await post(back);
  return {
    provider: back.provider,
    status: "confirm",
    title: connectConfirmTitle(back.provider, await signedInEmail()),
    confirm: async () => {
      const outcome = await post(back);
      if (outcome.status === "connected") window.dispatchEvent(new Event(CONNECT_FINISHED_EVENT));
      return outcome;
    },
  };
}

function failed(provider: ConnectProvider, error: string | null): ConnectOutcome {
  return { provider, status: "failed", message: connectFailureMessage(provider, error) };
}

async function post(back: ConnectReturn): Promise<ConnectOutcome> {
  try {
    const { data, error } = await supabaseClient.functions.invoke(FUNCTIONS[back.provider], {
      body: { action: "finish", code: back.code, state: back.state },
    });
    if (!error) {
      markConnected(back.provider, data);
      return { provider: back.provider, status: "connected" };
    }
    return failed(back.provider, await errorCode(error));
  } catch {
    return failed(back.provider, null);
  }
}

async function signedInEmail(): Promise<string | null> {
  try {
    const { data } = await supabaseClient.auth.getSession();
    return data.session?.user.email ?? null;
  } catch {
    return null;
  }
}

/** The function's `{ error }` code from a non-2xx invoke error. */
async function errorCode(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown } | null)?.context;
  if (!(context instanceof Response)) return null;
  try {
    const body = (await context.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}
