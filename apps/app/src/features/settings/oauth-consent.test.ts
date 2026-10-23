// MCPO-4 · consent model (specs/mcp-oauth.md AC5, AC7, AC9): defaults, caps,
// the unchecked-app rule by domain, the move-workspace line, the cap and role
// messages.
import type { PermissionKey } from "@contracts/vocabularies";
import { describe, expect, it } from "@rstest/core";

import { formatDate, formatStamp, formatWhen } from "../../lib/time-format";
import { DEFAULT_KEY_EXPIRY, DEFAULT_KEY_SCOPES, type KeyActor } from "./api-keys";
import {
  appDisplayName,
  approveBlocker,
  CAP_MESSAGE,
  connectedAppLine,
  consentCeilings,
  consentTitle,
  deniedRedirect,
  expiredMessage,
  initialDraft,
  initialReplaceIds,
  initialWorkspaceId,
  isCheckedApp,
  moveLine,
  NO_ACCESS_MESSAGE,
  otherConnectionLine,
  replaceIdsToSend,
  replaceLabel,
  returnsTo,
  ROLE_MESSAGE,
  shownScopes,
  workspaceChoices,
} from "./oauth-consent";

const owner: KeyActor = { role: "owner", perms: [] };
const keyManagerViewer: KeyActor = {
  role: "editor",
  perms: ["ws.api_keys", "tasks.view", "notes.view"] as PermissionKey[],
};
const plainMember: KeyActor = { role: "editor", perms: ["tasks.create"] as PermissionKey[] };

describe("consent model: the app", () => {
  it("names the app, falling back to where it returns to", () => {
    expect(appDisplayName({ appName: "Claude", clientDomain: "claude.ai" })).toBe("Claude");
    expect(appDisplayName({ appName: "  ", clientDomain: "localhost" })).toBe("localhost");
    expect(appDisplayName({ appName: null, clientDomain: null })).toBe("An app");
    expect(consentTitle("Claude")).toBe("Claude wants to work in Moduo as you");
  });

  it("checks apps only by where they return over https (and subdomains)", () => {
    for (const d of [
      "claude.ai",
      "anthropic.com",
      "openai.com",
      "chatgpt.com",
      "www.chatgpt.com",
      "Claude.AI",
    ]) {
      expect(isCheckedApp("https", d)).toBe(true);
    }
    for (const d of [
      "localhost",
      "claude.ai.evil.com",
      "notclaude.ai",
      "moduo-official.app",
      "",
      null,
    ]) {
      expect(isCheckedApp("https", d)).toBe(false);
    }
    // A local program's own scheme can name any host: never checked.
    expect(isCheckedApp("evilapp", "claude.ai")).toBe(false);
    expect(isCheckedApp("http", "claude.ai")).toBe(false);
    expect(isCheckedApp(null, "claude.ai")).toBe(false);
  });

  it("shows where the sign-in returns, scheme and all unless it's the web", () => {
    expect(returnsTo("https", "claude.ai")).toBe("claude.ai");
    expect(returnsTo("http", "localhost")).toBe("localhost");
    expect(returnsTo("evilapp", "claude.ai")).toBe("evilapp://claude.ai");
    expect(returnsTo(null, null)).toBeNull();
  });

  it("words an expired sign-in with the app, or 'your app'", () => {
    expect(expiredMessage("Claude")).toBe(
      "This sign-in link has expired. Go back to Claude and connect again.",
    );
    expect(expiredMessage(null)).toBe(
      "This sign-in link has expired. Go back to your app and connect again.",
    );
  });
});

describe("consent model: defaults and caps", () => {
  it("starts at the key card's defaults: Tasks View, 90 days, no private channels", () => {
    expect(initialDraft(null)).toEqual({
      scopes: { ...DEFAULT_KEY_SCOPES },
      expiry: DEFAULT_KEY_EXPIRY,
      includePrivateChat: false,
    });
    expect(DEFAULT_KEY_EXPIRY).toBe("90");
    expect(DEFAULT_KEY_SCOPES.tasks).toBe("view");
  });

  it("pre-fills a reconnect with what the connection holds now", () => {
    const draft = initialDraft({
      workspaceId: "w1",
      scopes: { tasks: "edit", chat: "view" },
      expiresAt: null,
      includePrivateChat: true,
    });
    expect(draft.scopes.tasks).toBe("edit");
    expect(draft.scopes.chat).toBe("view");
    expect(draft.scopes.notes).toBe("none");
    expect(draft.expiry).toBe("never");
    expect(draft.includePrivateChat).toBe(true);
    expect(
      initialDraft({
        workspaceId: "w1",
        scopes: {},
        expiresAt: "2027-01-01T00:00:00Z",
        includePrivateChat: false,
      }).expiry,
    ).toBe(DEFAULT_KEY_EXPIRY);
  });

  it("caps each module at the person's own access, with the row's reason", () => {
    const ceilings = consentCeilings(keyManagerViewer);
    expect(ceilings.tasks).toEqual({ max: "view", why: "You can only view Tasks yourself." });
    expect(ceilings.calendar.max).toBe("none");
    expect(ceilings.calendar.why).toBe("You don't have access to Calendar yourself.");
    expect(consentCeilings(owner).tasks).toEqual({ max: "edit", why: null });
    expect(
      shownScopes({ ...DEFAULT_KEY_SCOPES, tasks: "edit", calendar: "edit" }, keyManagerViewer),
    ).toMatchObject({ tasks: "view", calendar: "none" });
  });

  it("never offers more than the person can do now, even on a reconnect that held more", () => {
    expect(consentCeilings(keyManagerViewer).tasks.max).toBe("view");
  });
});

describe("consent model: workspaces", () => {
  const workspaces = [
    { id: "w1", name: "Moduo Labs", actor: plainMember },
    { id: "w2", name: "Elsewhere", actor: keyManagerViewer },
    { id: "w3", name: "Mine", actor: owner },
  ];

  it("lists every workspace, off with the role message where the person can't manage keys", () => {
    const choices = workspaceChoices(workspaces, ["w3"]);
    expect(choices[0]).toEqual({
      id: "w1",
      name: "Moduo Labs",
      disabled: true,
      full: false,
      reason: ROLE_MESSAGE,
    });
    expect(choices[1]).toMatchObject({ disabled: false, full: false, reason: null });
    expect(choices[2]).toMatchObject({ disabled: false, full: true, reason: CAP_MESSAGE });
  });

  it("starts on the connection's workspace, else the remembered one, else the first that qualifies", () => {
    const choices = workspaceChoices(workspaces, []);
    expect(initialWorkspaceId(choices, "w3", "w2")).toBe("w3");
    expect(initialWorkspaceId(choices, null, "w3")).toBe("w3");
    expect(initialWorkspaceId(choices, null, "w1")).toBe("w2");
    expect(initialWorkspaceId(workspaceChoices([workspaces[0]], []), null, "w1")).toBeNull();
  });

  it("says when approving moves the app to another workspace", () => {
    const nameOf = (id: string) => workspaces.find((w) => w.id === id)?.name ?? null;
    expect(moveLine("Claude", { workspaceId: "w2" }, "w3", nameOf)).toBe(
      "This moves Claude from Elsewhere to Mine.",
    );
    expect(moveLine("Claude", { workspaceId: "w2" }, "w2", nameOf)).toBeNull();
    expect(moveLine("Claude", null, "w2", nameOf)).toBeNull();
    expect(moveLine("Claude", { workspaceId: "gone" }, "w2", nameOf)).toBe(
      "This moves Claude from another workspace to Elsewhere.",
    );
  });

  it("turns Approve off with the role, cap or no-access message", () => {
    const [noRole, open, full] = workspaceChoices(workspaces, ["w3"]);
    const some = { ...DEFAULT_KEY_SCOPES };
    const nothing = { ...DEFAULT_KEY_SCOPES, tasks: "none" as const };
    expect(approveBlocker(null, some)).toBe(ROLE_MESSAGE);
    expect(approveBlocker(noRole, some)).toBe(ROLE_MESSAGE);
    expect(approveBlocker(full, some)).toBe(CAP_MESSAGE);
    expect(approveBlocker(open, nothing)).toBe(NO_ACCESS_MESSAGE);
    expect(approveBlocker(open, some)).toBeNull();
    // A ticked replacement in the full workspace frees its place.
    expect(approveBlocker(full, some, true)).toBeNull();
    expect(approveBlocker(noRole, some, true)).toBe(ROLE_MESSAGE);
  });
});

describe("consent model: deny after Auth approved by itself", () => {
  it("drops the code and tells the app no on the same address and state", () => {
    const url = new URL(
      deniedRedirect("https://claude.ai/api/mcp/auth_callback?code=abc&state=xyz") ?? "",
    );
    expect(url.origin + url.pathname).toBe("https://claude.ai/api/mcp/auth_callback");
    expect(url.searchParams.get("code")).toBeNull();
    expect(url.searchParams.get("state")).toBe("xyz");
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(deniedRedirect("not a url")).toBeNull();
  });
});

describe("duplicate connections (MCPO-5 follow-up)", () => {
  const now = new Date("2026-10-23T15:00:00.000Z");
  const stale = {
    id: "c1",
    workspaceId: "w2",
    createdAt: "2026-10-21T09:00:00.000Z",
    lastUsedAt: "2026-10-22T10:00:00.000Z",
    recentlyUsed: false,
  };
  const live = {
    id: "c2",
    workspaceId: "w3",
    createdAt: "2026-10-23T14:00:00.000Z",
    lastUsedAt: "2026-10-23T14:59:30.000Z",
    recentlyUsed: true,
  };
  const never = { ...stale, id: "c3", lastUsedAt: null };
  const nameOf = (id: string) => ({ w2: "Elsewhere", w3: "Mine" })[id] ?? null;

  it("ticks every other connection except one used in the last two minutes", () => {
    expect(initialReplaceIds([live, stale, never])).toEqual(["c1", "c3"]);
    expect(initialReplaceIds([live])).toEqual([]);
    expect(initialReplaceIds([])).toEqual([]);
  });

  it("names the choice plainly", () => {
    expect(replaceLabel("Claude")).toBe("Replace your other Claude connection");
  });

  it("says when each was connected and last used, and where when it's another workspace", () => {
    expect(otherConnectionLine(stale, "w3", nameOf, now)).toBe(
      `Connected ${formatDate(stale.createdAt, now)} · Last used ${formatWhen(stale.lastUsedAt, now)} · in Elsewhere`,
    );
    expect(otherConnectionLine(live, "w3", nameOf, now)).toBe(
      `Connected ${formatDate(live.createdAt, now)} · Last used just now`,
    );
    expect(otherConnectionLine(never, "w9", () => null, now)).toBe(
      `Connected ${formatDate(never.createdAt, now)} · Never used · in another workspace`,
    );
  });

  it("sends only ticked ids that are still on offer", () => {
    expect(replaceIdsToSend([stale, live], ["c2", "gone", "c1"])).toEqual(["c1", "c2"]);
    expect(replaceIdsToSend([stale], [])).toEqual([]);
  });

  it("shows a connected app's date and last use to the minute in Settings", () => {
    const key = {
      oauthClientScheme: "https",
      oauthClientDomain: "claude.ai",
      createdAt: "2026-10-23T14:00:00.000Z",
      lastUsedAt: "2026-10-23T14:59:30.000Z",
    };
    expect(connectedAppLine(key, now)).toBe(
      `claude.ai · Connected ${formatStamp(key.createdAt, now)} · Last used ${formatStamp(key.lastUsedAt, now)}`,
    );
    expect(connectedAppLine({ ...key, lastUsedAt: null, oauthClientScheme: "someapp" }, now)).toBe(
      `someapp://claude.ai · Connected ${formatStamp(key.createdAt, now)} · Never used`,
    );
  });
});
