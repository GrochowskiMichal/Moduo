// TV-U14 · the Task capture body (tasks-v3 §10; AC10.1–10.3, AC5.1, AC5.4).
// Rendered on its own with a fake runtime: a restored draft, the "From:" chip,
// the destination row's states (team needs a project, the team's default,
// unfiled for someone else) and what Create sends.

import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { CaptureContext } from "../../../lib/capture-registry";
import { ReferenceStoreProvider } from "../../spine/references/context";
import type { ResolveContext } from "../../spine/references/resolvers";
import type { ReferencePreviewApi } from "../../spine/references/rows";
import { ReferenceStore } from "../../spine/references/store";
import type { Bucket, Task, Team } from "../model";
import { EMPTY_FIELDS, saveDraft } from "./capture-draft";

const ME = "u-me";
const SAM = "u-sam";
const WS = "w1";
const SECRET = "Acquire Northwind quietly";

const h = rs.hoisted(() => ({
  userId: "u-me",
  runtime: null as unknown,
  bundle: null as unknown,
}));

// The workspace's shared store, as a loaded snapshot (no store: saves go
// straight to the runtime, the store's own behaviour is its tests').
rs.mock("../../../lib/sync/react", () => ({
  useWorkspaceStore: () => null,
  useStoreSnapshot: () => ({ loaded: true, bundle: h.bundle }),
}));

rs.mock("../../../providers/auth-provider", () => ({
  useAuth: () => ({ runtime: h.runtime, userId: h.userId }),
}));
rs.mock("../../../providers/workspace-provider", () => ({
  useWorkspace: () => ({ selectedWorkspaceId: "w1", modulePermissions: { tasks: "edit" } }),
}));
rs.mock("../assignees", () => ({
  useAssignees: () => ({
    assignees: [
      {
        userId: "u-me",
        name: "Me",
        fullName: "Alex Rivera",
        avatarUrl: null,
        isMe: true,
        canTakeTasks: true,
      },
      {
        userId: "u-sam",
        name: "Sam Ortiz",
        fullName: "Sam Ortiz",
        avatarUrl: null,
        isMe: false,
        canTakeTasks: true,
      },
    ],
    currentUserId: "u-me",
    byId: () => null,
  }),
}));

import { TaskCaptureBody } from "./task-capture";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

const bucket = (id: string, name: string, over: Partial<Bucket> = {}): Bucket => ({
  id,
  workspaceId: WS,
  ownerId: ME,
  name,
  isSystem: false,
  group: null,
  position: id,
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  ...over,
});
const team = (id: string, name: string, defaultProjectId: string | null): Team => ({
  id,
  workspaceId: WS,
  name,
  mark: "",
  color: null,
  defaultProjectId,
  createdBy: ME,
  createdAt: "",
  updatedAt: "",
});

function fakeRuntime() {
  const saved: Task[] = [];
  const links: unknown[] = [];
  const bundle = {
    buckets: [
      bucket("inbox-me", "Inbox", { isSystem: true }),
      bucket("p-acme", "Acme rebrand"),
      bucket("p-requests", "Design requests"),
    ],
    tasks: [],
    tags: [],
    tagLinks: [],
    taskRelations: [],
    sections: [],
    teams: [team("t-design", "Design", "p-requests"), team("t-ops", "Ops", null)],
    teamMembers: [],
    truncated: [],
  };
  const runtime = {
    tasks: {
      seedInbox: rs.fn(async () => bucket("inbox-me", "Inbox", { isSystem: true })),
      upsertTask: rs.fn(async (task: Task) => {
        saved.push(task);
        return task;
      }),
      addReminder: rs.fn(async () => []),
      addWaiting: rs.fn(async () => []),
      opQueueAdd: rs.fn(async () => []),
      attachTag: rs.fn(async () => ({})),
    },
    spine: {
      createLink: rs.fn(async (input: unknown) => {
        links.push(input);
        return {};
      }),
      searchEntities: rs.fn(async () => []),
    },
  };
  return { runtime, saved, links, bundle };
}

/** A references store where `rows` are the tasks this reader may open. */
function referenceStore(rows: Record<string, { title: string }>) {
  const none = async () => [];
  const previews = {
    tasks: async ({ ids }: { ids: string[] }) =>
      ids
        .filter((id) => rows[id])
        .map((id) => ({
          id,
          title: rows[id].title,
          status: "todo",
          dueDate: null,
          bucketId: "p-acme",
          assigneeId: null,
          number: 1,
          deletedAt: null,
        })),
    projects: none,
    notes: none,
    events: none,
    contacts: none,
    emails: none,
    tags: none,
    searchProjects: none,
    searchTags: none,
    resolveHandle: async () => null,
  } as unknown as ReferencePreviewApi;
  const context: ResolveContext = {
    workspaceId: WS,
    previews,
    taskKey: "MOD",
    personOf: () => null,
    now: () => new Date(2026, 9, 9, 10),
  };
  return new ReferenceStore({ context: () => context, schedule: (fn) => queueMicrotask(fn) });
}

function renderBody(
  context: Partial<CaptureContext> = {},
  store: ReferenceStore | null = referenceStore({}),
  draft = "",
) {
  const onDone = rs.fn();
  const utils = render(
    <ReferenceStoreProvider store={store}>
      <TaskCaptureBody
        draft={draft}
        onDraftChange={() => {}}
        writable
        onDone={onDone}
        context={{ source: null, openId: 1, ...context }}
        typeChip={<span>Task</span>}
      />
    </ReferenceStoreProvider>,
  );
  return { ...utils, onDone };
}

const destination = () => screen.getByRole("button", { name: /^Destination: / });

let fake: ReturnType<typeof fakeRuntime>;
beforeEach(() => {
  fake = fakeRuntime();
  h.runtime = fake.runtime;
  h.bundle = fake.bundle;
  h.userId = ME;
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("a restored draft", () => {
  it("comes back for its person, and a linked item they can't open now reads Private item", async () => {
    saveDraft(ME, WS, {
      segments: [
        { text: "Follow up on " },
        { token: { kind: "thing", ref: { type: "task", id: "t-secret" }, label: SECRET } },
      ],
      keep: [],
      description: "",
      subtasks: [],
      fields: EMPTY_FIELDS,
    });
    renderBody();
    expect(await screen.findByText(/Draft restored/)).toBeTruthy();
    expect(await screen.findByText("Private item")).toBeTruthy();
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("closed with Esc and opened again, its tokens come back as tokens (not words)", async () => {
    saveDraft(ME, WS, {
      segments: [
        { text: "Fix the banner " },
        { token: { kind: "person", userId: SAM, label: "" } },
      ],
      keep: [],
      description: "",
      subtasks: [],
      fields: EMPTY_FIELDS,
    });
    // The shell kept the words the body last told it, names and all.
    const first = renderBody({}, referenceStore({}));
    await waitFor(() =>
      expect(destination().getAttribute("aria-label")).toBe("Destination: No project"),
    );
    first.unmount();
    renderBody({}, referenceStore({}), "Fix the banner @Sam Ortiz");
    await waitFor(() =>
      expect(destination().getAttribute("aria-label")).toBe("Destination: No project"),
    );
    expect(document.querySelector('[data-capture-token="person"]')).toBeTruthy();
  });

  it("a second person on this device never sees it", async () => {
    saveDraft(ME, WS, {
      segments: [{ text: "Book the dentist" }],
      keep: [],
      description: "",
      subtasks: [],
      fields: EMPTY_FIELDS,
    });
    h.userId = SAM;
    renderBody();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByText(/Draft restored/)).toBeNull();
    expect(document.body.textContent).not.toContain("Book the dentist");
  });
});

describe("where it goes (AC10.1, AC10.2; calls 20a, 94)", () => {
  it("⌘⇧K files to the Inbox; ⌘N in a project files there", async () => {
    const inbox = renderBody();
    await waitFor(() =>
      expect(destination().getAttribute("aria-label")).toBe("Destination: Inbox"),
    );
    inbox.unmount();
    renderBody({ destination: { projectId: "p-acme", sectionId: null } });
    await waitFor(() =>
      expect(destination().getAttribute("aria-label")).toBe("Destination: Acme rebrand"),
    );
  });

  it("@person with no project keeps it unfiled and shows the empty project slot", async () => {
    saveDraft(ME, WS, {
      segments: [
        { text: "Fix the banner " },
        { token: { kind: "person", userId: SAM, label: "" } },
      ],
      keep: [],
      description: "",
      subtasks: [],
      fields: EMPTY_FIELDS,
    });
    renderBody();
    await waitFor(() =>
      expect(destination().getAttribute("aria-label")).toBe("Destination: No project"),
    );
    expect(screen.getByText("Unfiled · Sam Ortiz finds it in My tasks")).toBeTruthy();
  });

  it("a team with a default project fills it in; one without asks before Create", async () => {
    saveDraft(ME, WS, {
      segments: [{ text: "Banner " }, { token: { kind: "team", teamId: "t-design", label: "" } }],
      keep: [],
      description: "",
      subtasks: [],
      fields: EMPTY_FIELDS,
    });
    const withDefault = renderBody();
    await waitFor(() =>
      expect(destination().getAttribute("aria-label")).toBe("Destination: Design requests"),
    );
    expect(screen.getByText("(team default)")).toBeTruthy();
    withDefault.unmount();

    saveDraft(ME, WS, {
      segments: [{ text: "Rota " }, { token: { kind: "team", teamId: "t-ops", label: "" } }],
      keep: [],
      description: "",
      subtasks: [],
      fields: EMPTY_FIELDS,
    });
    renderBody();
    await waitFor(() =>
      expect(destination().getAttribute("aria-label")).toBe("Destination: Pick a project"),
    );
    expect(
      (screen.getByRole("button", { name: /^Create\s*⏎$/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("a team task (54, 94)", () => {
  it("routed to a team with no one picked, it's nobody's, for the team to claim", async () => {
    saveDraft(ME, WS, {
      segments: [{ text: "Banner " }, { token: { kind: "team", teamId: "t-design", label: "" } }],
      keep: [],
      description: "",
      subtasks: [],
      fields: EMPTY_FIELDS,
    });
    renderBody();
    await waitFor(() =>
      expect(destination().getAttribute("aria-label")).toBe("Destination: Design requests"),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Create\s*⏎$/ }));
    await waitFor(() => expect(fake.saved.length).toBe(1));
    expect(fake.saved[0].assigneeId).toBeNull();
    expect(fake.saved[0].teamId).toBe("t-design");
    expect(fake.saved[0].bucketId).toBe("p-requests");
  });
});

describe("Create (AC10.3, AC5.4)", () => {
  async function createWith(context: Partial<CaptureContext>, removeSource = false) {
    saveDraft(ME, WS, {
      segments: [
        { text: "Reply to the launch thread " },
        { token: { kind: "priority", level: "high", label: "High priority" } },
      ],
      keep: [],
      description: "",
      subtasks: ["Draft the answer"],
      fields: EMPTY_FIELDS,
    });
    const { onDone } = renderBody(context);
    await screen.findByText(/Draft restored/);
    if (removeSource) fireEvent.click(screen.getByRole("button", { name: "Don't link it" }));
    fireEvent.click(screen.getByRole("button", { name: /^Create\s*⏎$/ }));
    await waitFor(() => expect(fake.saved.length).toBe(2));
    return onDone;
  }

  const source = {
    kind: "email" as const,
    label: "Re: Launch date",
    ref: { type: "email_thread", id: "e-1" },
  };

  it("files to the Inbox with the token's priority, the title without it, and the subtask under it", async () => {
    const onDone = await createWith({});
    const [parent, child] = fake.saved;
    expect(onDone).toHaveBeenCalled();
    expect(parent.title).toBe("Reply to the launch thread");
    expect(parent.priority).toBe("high");
    expect(parent.bucketId).toBe("inbox-me");
    expect(child.parentId).toBe(parent.id);
    expect(child.title).toBe("Draft the answer");
  });

  it("an open email rides along as From: and becomes a spawned-from link", async () => {
    await createWith({ source });
    await waitFor(() => expect(fake.links.length).toBe(1));
    expect(fake.links[0]).toMatchObject({
      source: { type: "task", id: fake.saved[0].id },
      target: { type: "email_thread", id: "e-1" },
      relationKind: "spawned-from",
    });
  });

  it("removing the From: chip links nothing", async () => {
    await createWith({ source }, true);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fake.links).toEqual([]);
  });
});
