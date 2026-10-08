// The scopes payload end to end: what the per-module None / View / Edit rows
// send to the runtime when a key is created or its access is edited, and how
// the permission model (creator cap, creator-only widening) shows up.
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TooltipProvider } from "../../../components/ui/tooltip";
import type { WorkspaceApiKey } from "../../../lib/runtime";

const mocks = rs.hoisted(() => {
  const workspace = {
    listApiKeys: rs.fn(),
    createApiKey: rs.fn(),
    setApiKeyScopes: rs.fn(),
    revokeApiKey: rs.fn(),
    getMcpEndpoint: () => "https://example.supabase.co/functions/v1/moduo-mcp",
  };
  const chat = { isEnabled: rs.fn(() => Promise.resolve(true)) };
  const ownerWs = { id: "w1", name: "Studio", role: "owner" as const };
  return {
    workspace,
    chat,
    ownerWs,
    // One runtime object for the whole run, like AuthProvider's (held in state) —
    // a fresh one per render would re-run the section's key fetch every render.
    auth: { runtime: { workspace, chat }, userId: "u-me" },
    // Swapped by tests; stable between renders otherwise.
    ws: {
      current: {
        selectedWorkspace: ownerWs as { id: string; name: string; role: string },
        myPerms: [] as string[],
        members: [] as Array<Record<string, unknown>>,
        can: (_key: string): boolean => true,
      },
    },
    toast: { success: rs.fn(), error: rs.fn() },
  };
});

rs.mock("../../../providers/auth-provider", () => ({ useAuth: () => mocks.auth }));
rs.mock("../../../providers/workspace-provider", () => ({ useWorkspace: () => mocks.ws.current }));
rs.mock("sonner", () => ({ toast: mocks.toast }));

import { ApiKeysSection } from "./api-keys-section";

const NONE = {
  tasks: "none",
  notes: "none",
  calendar: "none",
  email: "none",
  contacts: "none",
  chat: "none",
  links: "none",
};

function storedKey(
  scopes: Record<string, string>,
  overrides: Partial<WorkspaceApiKey> = {},
): WorkspaceApiKey {
  return {
    id: "k1",
    workspaceId: "w1",
    name: "Claude",
    keyPrefix: "moduo_sk_ab12cd",
    scopes,
    createdBy: "u-me",
    createdAt: "2026-10-01T00:00:00Z",
    lastUsedAt: null,
    ...overrides,
  };
}

const anna = {
  id: "m2",
  workspaceId: "w1",
  userId: "u-anna",
  role: "editor",
  roleId: null,
  overrides: {},
  perms: ["tasks.view", "tasks.create", "tasks.edit", "tasks.delete", "notes.view"],
  joinedAt: null,
  isActive: true,
  removedAt: null,
  displayName: "Anna",
  avatarUrl: null,
};

const ui = () => (
  <TooltipProvider>
    <ApiKeysSection />
  </TooltipProvider>
);

function renderSection() {
  const view = render(ui());
  return { user: userEvent.setup(), rerender: () => view.rerender(ui()) };
}

/** The None / View / Edit option for one module, inside `scope` (a card or a key row). */
function scopeOption(scope: HTMLElement, module: string, level: "None" | "View" | "Edit") {
  return within(within(scope).getByRole("radiogroup", { name: `${module} access` })).getByRole(
    "radio",
    { name: level },
  );
}

const newKeyCard = () => screen.getByLabelText("Name").closest("section") as HTMLElement;
const keyRow = (name: string) =>
  screen.getByText(name, { selector: "p" }).closest("li") as HTMLElement;
// Plain DOM reads (the repo's render tests don't type jest-dom's matchers).
const isChecked = (el: HTMLElement) => el.getAttribute("aria-checked") === "true";
const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled;

beforeEach(() => {
  rs.clearAllMocks();
  mocks.chat.isEnabled.mockImplementation(() => Promise.resolve(true));
  mocks.ws.current = {
    selectedWorkspace: mocks.ownerWs,
    myPerms: [],
    members: [],
    can: () => true,
  };
});
afterEach(cleanup);

describe("creating a key", () => {
  it("sends the scope each module row shows — every module spelled out, Chat included", async () => {
    mocks.workspace.listApiKeys.mockResolvedValue([]);
    mocks.workspace.createApiKey.mockResolvedValue({
      ...storedKey({ ...NONE, notes: "edit", email: "view", chat: "view" }),
      secret: "moduo_sk_secret",
    });
    const { user } = renderSection();
    await screen.findByText("No keys yet.");

    await user.type(screen.getByLabelText("Name"), "Claude");
    await user.click(scopeOption(newKeyCard(), "Tasks", "None"));
    await user.click(scopeOption(newKeyCard(), "Notes", "Edit"));
    await user.click(scopeOption(newKeyCard(), "Email", "View"));
    await user.click(scopeOption(newKeyCard(), "Chat", "View"));
    await user.click(screen.getByRole("button", { name: "Create key" }));

    await waitFor(() => expect(mocks.workspace.createApiKey).toHaveBeenCalledTimes(1));
    expect(mocks.workspace.createApiKey).toHaveBeenCalledWith({
      workspaceId: "w1",
      name: "Claude",
      scopes: { ...NONE, notes: "edit", email: "view", chat: "view" },
    });
    // Announced as ready (by an always-mounted region) — never the secret itself.
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Claude is ready."),
    );
    expect(screen.getByRole("status").textContent).not.toContain("moduo_sk_secret");
    expect(screen.getByText("moduo_sk_secret")).toBeTruthy();
    // The form resets to the default (read-only Tasks) for the next key.
    expect(isChecked(scopeOption(newKeyCard(), "Tasks", "View"))).toBe(true);
    expect(isChecked(scopeOption(newKeyCard(), "Notes", "None"))).toBe(true);
  });

  it("starts at read-only Tasks and sends that default as-is", async () => {
    mocks.workspace.listApiKeys.mockResolvedValue([]);
    mocks.workspace.createApiKey.mockResolvedValue({
      ...storedKey({ tasks: "view" }),
      secret: "s",
    });
    const { user } = renderSection();
    await screen.findByText("No keys yet.");

    await user.type(screen.getByLabelText("Name"), "Reader{Enter}");

    await waitFor(() => expect(mocks.workspace.createApiKey).toHaveBeenCalledTimes(1));
    expect(mocks.workspace.createApiKey.mock.calls[0][0].scopes).toEqual({
      ...NONE,
      tasks: "view",
    });
  });

  it("says when a grant lists tools that need another module, and stops once they won't", async () => {
    mocks.workspace.listApiKeys.mockResolvedValue([]);
    const { user } = renderSection();
    await screen.findByText("No keys yet.");
    const note = "Moving scheduled tasks also needs Tasks: Edit.";
    // What a Calendar segment is described by: its hint, plus the note while one shows.
    const calendarDescription = () =>
      (scopeOption(newKeyCard(), "Calendar", "Edit").getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent)
        .join(" ");

    expect(calendarDescription()).toBe("Events and scheduled tasks");
    await user.click(scopeOption(newKeyCard(), "Calendar", "Edit"));
    expect(calendarDescription()).toBe(`Events and scheduled tasks ${note}`);
    expect(screen.getByText(note, { selector: ".sr-only" })).toBeTruthy(); // announced once
    await user.click(scopeOption(newKeyCard(), "Tasks", "Edit"));
    expect(calendarDescription()).toBe("Events and scheduled tasks");
    expect(screen.queryByText(note)).toBeNull();
  });

  it("won't create a key that reaches nothing", async () => {
    mocks.workspace.listApiKeys.mockResolvedValue([]);
    const { user } = renderSection();
    await screen.findByText("No keys yet.");

    await user.type(screen.getByLabelText("Name"), "Nothing");
    await user.click(scopeOption(newKeyCard(), "Tasks", "None"));

    expect(isDisabled(screen.getByRole("button", { name: "Create key" }))).toBe(true);
    expect(screen.getByText("Give the key access to at least one module.")).toBeTruthy();
    await user.click(screen.getByLabelText("Name"));
    await user.keyboard("{Enter}"); // Enter-to-create obeys the same rule
    expect(mocks.workspace.createApiKey).not.toHaveBeenCalled();
  });

  it("never offers more than you can do yourself, and says why", async () => {
    // A member who can view Notes and work in Tasks, nothing else.
    mocks.ws.current = {
      selectedWorkspace: { id: "w1", name: "Studio", role: "editor" },
      myPerms: ["tasks.view", "tasks.edit", "notes.view"],
      members: [],
      can: (key: string) => key === "ws.api_keys",
    };
    mocks.workspace.listApiKeys.mockResolvedValue([]);
    renderSection();
    await screen.findByText("No keys yet.");

    expect(isDisabled(scopeOption(newKeyCard(), "Notes", "Edit"))).toBe(true);
    expect(isDisabled(scopeOption(newKeyCard(), "Notes", "View"))).toBe(false);
    expect(within(newKeyCard()).getByText("You can only view Notes yourself.")).toBeTruthy();
    expect(isDisabled(scopeOption(newKeyCard(), "Contacts", "View"))).toBe(true);
    expect(
      within(newKeyCard()).getByText("You don't have access to Contacts yourself."),
    ).toBeTruthy();
    expect(isDisabled(scopeOption(newKeyCard(), "Tasks", "Edit"))).toBe(false);
  });

  it("starts at nothing when your role can't see Tasks, rather than offering a key it would refuse", async () => {
    mocks.ws.current = {
      selectedWorkspace: { id: "w1", name: "Studio", role: "editor" },
      myPerms: ["notes.view"],
      members: [],
      can: (key: string) => key === "ws.api_keys",
    };
    mocks.workspace.listApiKeys.mockResolvedValue([]);
    const { user } = renderSection();
    await screen.findByText("No keys yet.");

    expect(isChecked(scopeOption(newKeyCard(), "Tasks", "None"))).toBe(true);
    await user.type(screen.getByLabelText("Name"), "Reader");
    expect(isDisabled(screen.getByRole("button", { name: "Create key" }))).toBe(true);
  });

  it("notes the plan when chat isn't on for this workspace", async () => {
    mocks.chat.isEnabled.mockImplementation(() => Promise.resolve(false));
    mocks.workspace.listApiKeys.mockResolvedValue([]);
    renderSection();
    await screen.findByText("No keys yet.");
    expect(
      await within(newKeyCard()).findByText("Chat is on the Duo and Team plans."),
    ).toBeTruthy();
  });

  it("hands a late secret over in a toast after a switch mid-create, leaving the new workspace alone", async () => {
    mocks.workspace.listApiKeys.mockImplementation(async (workspaceId: string) =>
      workspaceId === "w2"
        ? [storedKey({ tasks: "edit" }, { id: "k9", workspaceId: "w2", name: "Side bot" })]
        : [],
    );
    let finishCreate: (value: unknown) => void = () => {};
    mocks.workspace.createApiKey.mockReturnValue(
      new Promise((resolve) => {
        finishCreate = resolve;
      }),
    );
    const { user, rerender } = renderSection();
    await screen.findByText("No keys yet.");

    await user.type(screen.getByLabelText("Name"), "Claude");
    await user.click(screen.getByRole("button", { name: "Create key" }));
    mocks.ws.current = {
      ...mocks.ws.current,
      selectedWorkspace: { id: "w2", name: "Side project", role: "owner" },
    };
    rerender();
    await screen.findByText("Side bot");
    await act(async () =>
      finishCreate({ ...storedKey({ tasks: "view" }), secret: "moduo_sk_late" }),
    );

    expect(mocks.toast.success).toHaveBeenCalledWith(
      "Claude is ready in Studio.",
      expect.objectContaining({
        duration: Infinity,
        action: expect.objectContaining({ label: "Copy key" }),
      }),
    );
    expect(screen.queryByText("moduo_sk_late")).toBeNull(); // not revealed in Side project's view
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Claude"); // not reset by the late create
    expect(screen.getByText("Side bot")).toBeTruthy(); // w2's list stands
    expect(mocks.workspace.listApiKeys.mock.calls.map(([id]) => id)).toEqual(["w1", "w2"]);
  });
});

describe("a key's row", () => {
  it("says who each key acts as", async () => {
    mocks.ws.current = { ...mocks.ws.current, members: [anna] };
    mocks.workspace.listApiKeys.mockResolvedValue([
      storedKey({ tasks: "view" }, { id: "k1", name: "Mine" }),
      storedKey({ tasks: "view" }, { id: "k2", name: "Annas", createdBy: "u-anna" }),
      storedKey({ tasks: "view" }, { id: "k3", name: "Gone", createdBy: "u-left" }),
      storedKey({ tasks: "view" }, { id: "k4", name: "Old", createdBy: null }),
    ]);
    renderSection();
    await screen.findByText("Mine");

    expect(within(keyRow("Mine")).getByText("Acts as you")).toBeTruthy();
    expect(within(keyRow("Annas")).getByText("Acts as Anna")).toBeTruthy();
    expect(
      within(keyRow("Gone")).getByText("Acts as a former member, so it has no access"),
    ).toBeTruthy();
    expect(within(keyRow("Gone")).getByText("No access")).toBeTruthy();
    expect(within(keyRow("Old")).getByText(/can't connect/)).toBeTruthy();
  });

  it("doesn't call a teammate's key dead while the member list hasn't loaded", async () => {
    mocks.ws.current = { ...mocks.ws.current, members: [] };
    mocks.workspace.listApiKeys.mockResolvedValue([
      storedKey({ tasks: "edit", notes: "view" }, { name: "Annas", createdBy: "u-anna" }),
    ]);
    renderSection();
    await screen.findByText("Annas");
    expect(within(keyRow("Annas")).getByText("Acts as a teammate")).toBeTruthy();
    expect(within(keyRow("Annas")).getByText("Edit: Tasks · View: Notes")).toBeTruthy();
    expect(within(keyRow("Annas")).queryByText(/former member/)).toBeNull();
  });

  it("shows what a key can actually do: its scopes, capped by its creator", async () => {
    mocks.ws.current = { ...mocks.ws.current, members: [anna] };
    mocks.workspace.listApiKeys.mockResolvedValue([
      storedKey({ tasks: "edit", notes: "edit" }, { name: "Annas", createdBy: "u-anna" }),
    ]);
    renderSection();
    await screen.findByText("Annas");
    // Anna can only view Notes, so her key can too.
    expect(within(keyRow("Annas")).getByText("Edit: Tasks · View: Notes")).toBeTruthy();
    expect(within(keyRow("Annas")).getByText(/Limited to what Anna can do/)).toBeTruthy();
  });
});

describe("editing a key's access", () => {
  it("saves the whole map and shows what the server stored", async () => {
    mocks.workspace.listApiKeys.mockResolvedValue([storedKey({ tasks: "view" })]);
    // The server answers with more than the draft (e.g. another change merged in).
    mocks.workspace.setApiKeyScopes.mockResolvedValue({
      ...NONE,
      tasks: "view",
      calendar: "edit",
      links: "view",
    });
    const { user } = renderSection();
    await screen.findByText("View: Tasks");

    await user.click(
      within(keyRow("Claude")).getByRole("button", { name: "Edit access for Claude" }),
    );
    const save = within(keyRow("Claude")).getByRole("button", { name: "Save" });
    expect(isDisabled(save)).toBe(true); // nothing changed yet

    await user.click(scopeOption(keyRow("Claude"), "Calendar", "Edit"));
    expect(isDisabled(save)).toBe(false);
    await user.click(save);

    await waitFor(() => expect(mocks.workspace.setApiKeyScopes).toHaveBeenCalledTimes(1));
    expect(mocks.workspace.setApiKeyScopes).toHaveBeenCalledWith("k1", {
      ...NONE,
      tasks: "view",
      calendar: "edit",
    });
    await screen.findByText("Edit: Calendar · View: Tasks, Links");
    expect(within(keyRow("Claude")).queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("lets you lower someone else's key, never raise it", async () => {
    mocks.ws.current = { ...mocks.ws.current, members: [anna] };
    mocks.workspace.listApiKeys.mockResolvedValue([
      storedKey({ tasks: "edit", notes: "view" }, { name: "Annas", createdBy: "u-anna" }),
    ]);
    mocks.workspace.setApiKeyScopes.mockResolvedValue({ ...NONE, tasks: "view", notes: "view" });
    const { user } = renderSection();
    await screen.findByText("Annas");

    await user.click(
      within(keyRow("Annas")).getByRole("button", { name: "Edit access for Annas" }),
    );
    expect(isDisabled(scopeOption(keyRow("Annas"), "Notes", "Edit"))).toBe(true);
    expect(isDisabled(scopeOption(keyRow("Annas"), "Email", "View"))).toBe(true);
    // Said once above the rows, not under each one, and read out with the
    // group (the greyed-out levels can't take focus to say it themselves).
    expect(
      within(keyRow("Annas")).getAllByText(
        "Only Anna can give this key more access. You can lower it or revoke it.",
      ).length,
    ).toBe(1);
    const group = within(keyRow("Annas")).getByRole("group", { name: "Annas access" });
    const reason = document.getElementById(group.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe(
      "Only Anna can give this key more access. You can lower it or revoke it.",
    );

    await user.click(scopeOption(keyRow("Annas"), "Tasks", "View"));
    await user.click(within(keyRow("Annas")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.workspace.setApiKeyScopes).toHaveBeenCalledTimes(1));
    expect(mocks.workspace.setApiKeyScopes).toHaveBeenCalledWith("k1", {
      ...NONE,
      tasks: "view",
      notes: "view",
    });
  });

  it("won't save a key down to no access", async () => {
    mocks.workspace.listApiKeys.mockResolvedValue([storedKey({ tasks: "view" })]);
    const { user } = renderSection();
    await screen.findByText("View: Tasks");

    await user.click(
      within(keyRow("Claude")).getByRole("button", { name: "Edit access for Claude" }),
    );
    await user.click(scopeOption(keyRow("Claude"), "Tasks", "None"));

    expect(isDisabled(within(keyRow("Claude")).getByRole("button", { name: "Save" }))).toBe(true);
    expect(
      within(keyRow("Claude")).getByText(/Give the key access to at least one module/),
    ).toBeTruthy();
    expect(mocks.workspace.setApiKeyScopes).not.toHaveBeenCalled();
  });

  it("reads a stored admin as None and never sends it back", async () => {
    mocks.workspace.listApiKeys.mockResolvedValue([storedKey({ tasks: "admin", notes: "edit" })]);
    mocks.workspace.setApiKeyScopes.mockResolvedValue({ ...NONE, notes: "edit", links: "view" });
    const { user } = renderSection();
    await screen.findByText("Edit: Notes");

    await user.click(
      within(keyRow("Claude")).getByRole("button", { name: "Edit access for Claude" }),
    );
    expect(isChecked(scopeOption(keyRow("Claude"), "Tasks", "None"))).toBe(true);
    await user.click(scopeOption(keyRow("Claude"), "Links", "View"));
    await user.click(within(keyRow("Claude")).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.workspace.setApiKeyScopes).toHaveBeenCalledTimes(1));
    const sent = mocks.workspace.setApiKeyScopes.mock.calls[0][1];
    expect(sent).toEqual({ ...NONE, notes: "edit", links: "view" });
    expect(Object.values(sent)).not.toContain("admin");
  });

  it("keeps the editor open with the draft when saving fails", async () => {
    mocks.workspace.listApiKeys.mockResolvedValue([storedKey({ tasks: "view" })]);
    mocks.workspace.setApiKeyScopes.mockRejectedValue(
      new Error("Your role doesn't include API keys in this workspace."),
    );
    const { user } = renderSection();
    await screen.findByText("View: Tasks");

    await user.click(
      within(keyRow("Claude")).getByRole("button", { name: "Edit access for Claude" }),
    );
    await user.click(scopeOption(keyRow("Claude"), "Email", "View"));
    await user.click(within(keyRow("Claude")).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Your role doesn't include API keys in this workspace.",
      ),
    );
    expect(isChecked(scopeOption(keyRow("Claude"), "Email", "View"))).toBe(true);
    expect(screen.getByText("View: Tasks")).toBeTruthy();
  });

  it("Cancel discards the draft", async () => {
    mocks.workspace.listApiKeys.mockResolvedValue([storedKey({ tasks: "view" })]);
    const { user } = renderSection();
    await screen.findByText("View: Tasks");

    await user.click(
      within(keyRow("Claude")).getByRole("button", { name: "Edit access for Claude" }),
    );
    await user.click(scopeOption(keyRow("Claude"), "Notes", "Edit"));
    await user.click(within(keyRow("Claude")).getByRole("button", { name: "Cancel" }));
    await user.click(
      within(keyRow("Claude")).getByRole("button", { name: "Edit access for Claude" }),
    );

    expect(isChecked(scopeOption(keyRow("Claude"), "Notes", "None"))).toBe(true);
    expect(mocks.workspace.setApiKeyScopes).not.toHaveBeenCalled();
  });
});

describe("without the API keys permission", () => {
  it("explains instead of showing the form", async () => {
    mocks.ws.current = { ...mocks.ws.current, can: () => false };
    renderSection();
    expect(screen.getByText(/Your role doesn.t include API keys in this workspace/)).toBeTruthy();
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(mocks.workspace.listApiKeys).not.toHaveBeenCalled();
  });
});
