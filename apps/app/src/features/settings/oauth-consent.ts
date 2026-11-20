// Pure rules for the consent screen (/oauth/consent, MCPO-4; specs/mcp-oauth.md
// AC5, AC7, AC9, Assumptions #6 and #7). An app that signed in with OAuth gets
// an ordinary scoped connection: the same None / View / Edit card, caps and
// expiry as a new API key (api-keys.ts), so the two can't drift. No React here.

import { formatDate, formatStamp, formatWhen } from "../../lib/time-format";
import {
  clampScopes,
  DEFAULT_KEY_EXPIRY,
  DEFAULT_KEY_SCOPES,
  grantsAnyAccess,
  type KeyActor,
  type KeyCeilings,
  keyCeilings,
  type KeyExpiryChoice,
  keyScopeCaps,
  type McpKeyScopes,
  toKeyScopes,
} from "./api-keys";

/**
 * Apps whose sign-in returns over https to these domains (or their
 * subdomains) are the ones Moduo expects; every other app gets the quiet
 * "hasn't checked" line. Matched on where the sign-in returns, which the app
 * can't fake the way it can its name; the scheme counts too, since
 * `someapp://claude.ai/cb` hands the code to a local program, not claude.ai.
 */
export const CHECKED_APP_DOMAINS = ["claude.ai", "anthropic.com", "openai.com", "chatgpt.com"];

export function isCheckedApp(
  scheme: string | null | undefined,
  domain: string | null | undefined,
): boolean {
  if ((scheme ?? "").trim().toLowerCase() !== "https") return false;
  const host = (domain ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!host) return false;
  return CHECKED_APP_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * The domain the consent screen goes by: the server's reading of where the
 * sign-in returns, only when the browser's own reading of that redirect
 * (`new URL`) agrees and it carries no userinfo; else none (MOD-576: a
 * redirect like `https://x@claude.ai:@evil.com/cb` must never read claude.ai).
 */
export function agreedDomain(request: {
  clientScheme: string | null;
  clientDomain: string | null;
  redirectUri: string | null;
}): string | null {
  const domain = (request.clientDomain ?? "").trim().toLowerCase();
  if (!domain || !request.redirectUri) return null;
  let url: URL;
  try {
    url = new URL(request.redirectUri.trim());
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== (request.clientScheme ?? "").trim().toLowerCase()) return null;
  return url.hostname.toLowerCase() === domain ? domain : null;
}

/** Where the screen says the sign-in returns: the host for the web, the whole address start otherwise. */
export function returnsTo(
  scheme: string | null | undefined,
  domain: string | null | undefined,
): string | null {
  const s = (scheme ?? "").trim().toLowerCase();
  const host = (domain ?? "").trim();
  if (s === "https" || s === "http") return host || null;
  if (!s) return host || null;
  return `${s}://${host}`;
}

/**
 * A connected app's line in Settings → API keys: where it returns, when it
 * was connected and when it was last used, to the minute, so two "Claude"
 * connections made the same day can be told apart (MCPO-5 follow-up).
 */
export function connectedAppLine(
  key: {
    oauthClientScheme: string | null;
    oauthClientDomain: string | null;
    createdAt: string;
    lastUsedAt: string | null;
  },
  now: Date = new Date(),
): string {
  return [
    returnsTo(key.oauthClientScheme, key.oauthClientDomain),
    key.createdAt ? `Connected ${formatStamp(key.createdAt, now)}` : null,
    key.lastUsedAt ? `Last used ${formatStamp(key.lastUsedAt, now)}` : "Never used",
  ]
    .filter(Boolean)
    .join(" · ");
}

export const UNCHECKED_APP_NOTE = "Moduo hasn't checked this app.";

export const ROLE_MESSAGE = "Your role doesn't include API keys here. Ask the workspace owner.";

export const CAP_MESSAGE =
  "This workspace has 20 keys and connections. Disconnect or revoke one in Settings → API keys first.";

export const NO_ACCESS_MESSAGE = "Give the app access to at least one module.";

/** What the screen calls the app: its own name, else where it returns to. */
export function appDisplayName(request: {
  appName: string | null;
  clientDomain: string | null;
}): string {
  return request.appName?.trim() || request.clientDomain?.trim() || "An app";
}

export function consentTitle(appName: string): string {
  return `${appName} wants to work in Moduo as you`;
}

/** The screen for a sign-in that's unknown, used up or expired. */
export function expiredMessage(appName: string | null): string {
  return `This sign-in link has expired. Go back to ${appName?.trim() || "your app"} and connect again.`;
}

/** One workspace the person belongs to, as the screen needs it. */
export type ConsentWorkspace = {
  id: string;
  name: string;
  actor: KeyActor;
};

export type ConsentWorkspaceChoice = {
  id: string;
  name: string;
  /** The person can't manage keys here: listed, never choosable. */
  disabled: boolean;
  /** Why it's off, or why Approve is off there. */
  reason: string | null;
  /** At the 20 cap: choosable, but Approve is off with the cap message. */
  full: boolean;
};

export function canManageKeys(actor: KeyActor): boolean {
  return actor.role === "owner" || actor.perms.includes("ws.api_keys");
}

export function workspaceChoices(
  workspaces: readonly ConsentWorkspace[],
  fullWorkspaceIds: readonly string[],
): ConsentWorkspaceChoice[] {
  return workspaces.map((ws) => {
    const manage = canManageKeys(ws.actor);
    const full = manage && fullWorkspaceIds.includes(ws.id);
    return {
      id: ws.id,
      name: ws.name,
      disabled: !manage,
      full,
      reason: !manage ? ROLE_MESSAGE : full ? CAP_MESSAGE : null,
    };
  });
}

/**
 * The workspace the picker starts on: where the app is connected now (a
 * reconnect), else the one the person last worked in, else the first that
 * qualifies; null when none does.
 */
export function initialWorkspaceId(
  choices: readonly ConsentWorkspaceChoice[],
  connectionWorkspaceId: string | null,
  rememberedWorkspaceId: string | null,
): string | null {
  const open = choices.filter((c) => !c.disabled);
  for (const id of [connectionWorkspaceId, rememberedWorkspaceId]) {
    if (id && open.some((c) => c.id === id)) return id;
  }
  return open[0]?.id ?? null;
}

export type ConsentConnection = {
  workspaceId: string;
  scopes: Record<string, string>;
  expiresAt: string | null;
  includePrivateChat: boolean;
};

export type ConsentDraft = {
  scopes: McpKeyScopes;
  expiry: KeyExpiryChoice;
  includePrivateChat: boolean;
};

/**
 * Where the card starts: the key card's defaults (Tasks: View, 90 days, no
 * private channels), or on a reconnect what the connection holds now, so
 * access is always seen before it changes. A connection that never expires
 * starts at Never; one with an end date starts the default term again
 * (approving renews it from today).
 */
export function initialDraft(connection: ConsentConnection | null): ConsentDraft {
  if (!connection) {
    return {
      scopes: { ...DEFAULT_KEY_SCOPES },
      expiry: DEFAULT_KEY_EXPIRY,
      includePrivateChat: false,
    };
  }
  return {
    scopes: toKeyScopes(connection.scopes),
    expiry: connection.expiresAt ? DEFAULT_KEY_EXPIRY : "never",
    includePrivateChat: connection.includePrivateChat,
  };
}

/** The card's ceilings: up to the person's own access in the workspace. */
export function consentCeilings(actor: KeyActor): KeyCeilings {
  // Like a new key: approving checks the person's own access afresh, so what
  // a connection held before a role change can't be chosen again.
  return keyCeilings({
    stored: toKeyScopes({}),
    isMine: true,
    ownerName: "you",
    myCaps: keyScopeCaps(actor),
  });
}

/** What the card shows and sends: the draft, never above the person's own access there. */
export function shownScopes(draft: Readonly<McpKeyScopes>, actor: KeyActor): McpKeyScopes {
  return clampScopes(draft, keyScopeCaps(actor));
}

/** "This moves Claude from Moduo Labs to Elsewhere." when the picked workspace isn't the connection's. */
export function moveLine(
  appName: string,
  connection: { workspaceId: string } | null,
  toWorkspaceId: string | null,
  nameOf: (workspaceId: string) => string | null,
): string | null {
  if (!connection || !toWorkspaceId || connection.workspaceId === toWorkspaceId) return null;
  const from = nameOf(connection.workspaceId) ?? "another workspace";
  const to = nameOf(toWorkspaceId) ?? "this workspace";
  return `This moves ${appName} from ${from} to ${to}.`;
}

/**
 * Why Approve is off, or null when it can go. At the cap, a ticked
 * replacement in the same workspace frees its place (the server ends it
 * before counting, and checks the cap again).
 */
export function approveBlocker(
  choice: ConsentWorkspaceChoice | null,
  scopes: Readonly<McpKeyScopes>,
  freesPlace = false,
): string | null {
  if (!choice || choice.disabled) return ROLE_MESSAGE;
  if (choice.full && !freesPlace) return CAP_MESSAGE;
  if (!grantsAnyAccess(scopes)) return NO_ACCESS_MESSAGE;
  return null;
}

/**
 * Deny for a sign-in Supabase Auth already approved by itself (a returning
 * app): it can't be denied there any more, so the app is told no the OAuth
 * way, on the same return address and state, without the code it was given.
 */
export function deniedRedirect(heldRedirect: string): string | null {
  try {
    const url = new URL(heldRedirect);
    url.searchParams.delete("code");
    url.searchParams.set("error", "access_denied");
    url.searchParams.set("error_description", "The person denied the request.");
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Claude registers anew on every Connect, so a person can end up with several
 * identical "Claude" connections (MCPO-5 follow-up; docs/decisions/mcp.md).
 * The screen offers to replace the person's other connections to the same
 * app: ticked by default unless one was used in the last two minutes (it may
 * be the one in use now, say Claude in another window), which stays an
 * opt-in tick.
 */
export type OtherConnection = {
  id: string;
  workspaceId: string;
  createdAt: string;
  lastUsedAt: string | null;
  recentlyUsed: boolean;
};

/** The others ticked when the screen opens. */
export function initialReplaceIds(others: readonly OtherConnection[]): string[] {
  return others.filter((o) => !o.recentlyUsed).map((o) => o.id);
}

export function replaceLabel(appName: string): string {
  return `Replace your other ${appName} connection`;
}

/** "Connected Oct 21 · Last used Yesterday, 3:00 PM · in Elsewhere": enough to tell one from another. */
export function otherConnectionLine(
  other: OtherConnection,
  pickedWorkspaceId: string | null,
  nameOf: (workspaceId: string) => string | null,
  now: Date = new Date(),
): string {
  const used = other.recentlyUsed
    ? "Last used just now"
    : other.lastUsedAt
      ? `Last used ${formatWhen(other.lastUsedAt, now)}`
      : "Never used";
  const parts = [`Connected ${formatDate(other.createdAt, now)}`, used];
  if (other.workspaceId !== pickedWorkspaceId) {
    parts.push(`in ${nameOf(other.workspaceId) ?? "another workspace"}`);
  }
  return parts.join(" · ");
}

/** The ids to send: the ticked ones still on offer. */
export function replaceIdsToSend(
  others: readonly OtherConnection[],
  ticked: readonly string[],
): string[] {
  return others.filter((o) => ticked.includes(o.id)).map((o) => o.id);
}
