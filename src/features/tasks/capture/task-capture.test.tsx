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
import { EMPTY_FIELDS, loadDraft, saveDraft } from "./capture-draft";
import {
  type CaptureAttachmentHandler,
  type CaptureTemplateProvider,
  registerCaptureAttachments,
  registerCaptureTemplates,
} from "./capture-hooks";

const ME = "u-me";
const SAM = "u-sam";
const WS = "w1";
const SECRET = "Acquire Northwind quietly";

const h = rs.hoisted(() => ({
  userId: "u-me",
  runtime: null as unknown,
  bundle: null as unknown,
  store: null as unknown,
}));

// The workspace's shared store, as a loaded snapshot (no store: saves go
// straight to the runtime, the store's own behaviour is its tests').
rs.mock("../../../lib/sync/react", () => ({
  useWorkspaceStore: () => h.store ?? null,
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

import { TaskCaptureBody, taskForFiles } from "./task-capture";

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
  h.store = null;
  registerCaptureTemplates(null);
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

  it("words changed under another type (⌘2, then back) come along as words", async () => {
    saveDraft(ME, WS, {
      segments: [{ text: "Old words" }],
      keep: [],
      description: "",
      subtasks: [],
      fields: EMPTY_FIELDS,
    });
    renderBody({}, referenceStore({}), "Pick up the keys");
    const title = await screen.findByRole("textbox", { name: "Task title" });
    await waitFor(() => expect(title.textContent).toBe("Pick up the keys"));
  });

  it("a capture the server refused comes back on the next open, kept apart from the draft", async () => {
    saveDraft(
      ME,
      WS,
      {
        segments: [{ text: "Refused words" }],
        keep: [],
        description: "",
        subtasks: [],
        fields: EMPTY_FIELDS,
      },
      "refused",
    );
    renderBody();
    const title = await screen.findByRole("textbox", { name: "Task title" });
    await waitFor(() => expect(title.textContent).toBe("Refused words"));
    expect(loadDraft(ME, WS, "refused")).toBeNull();
  });

  it("reopened (after Esc, or a reload), its date words are read as a date again, like freshly typed ones", async () => {
    // The first Esc after "tomorrow 3pm" keeps it as words while the capture is
    // open; the draft it leaves must not carry that into the next open.
    saveDraft(ME, WS, {
      segments: [{ text: "Call the printer tomorrow 3pm" }],
      keep: ["tomorrow 3pm"],
      description: "",
      subtasks: [],
      fields: EMPTY_FIELDS,
    });
    renderBody();
    await screen.findByText(/Draft restored/);
    fireEvent.click(screen.getByRole("button", { name: /^Create\s*⏎$/ }));
    await waitFor(() => expect(fake.saved.length).toBe(1));
    const [task] = fake.saved;
    expect(task.title).toBe("Call the printer");
    expect(task.scheduledAt).toBeTruthy();
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
      subtasks: ["Mock it up", "Review it @sam"],
      fields: EMPTY_FIELDS,
    });
    renderBody();
    await waitFor(() =>
      expect(destination().getAttribute("aria-label")).toBe("Destination: Design requests"),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Create\s*⏎$/ }));
    await waitFor(() => expect(fake.saved.length).toBe(3));
    const [parent, mock, review] = fake.saved;
    expect(parent.assigneeId).toBeNull();
    expect(parent.teamId).toBe("t-design");
    expect(parent.bucketId).toBe("p-requests");
    // Its breakdown goes with it: same project, nobody's (U14-6)...
    expect(mock.parentId).toBe(parent.id);
    expect(mock.assigneeId).toBeNull();
    expect(mock.bucketId).toBe("p-requests");
    // ...unless a line names its own person.
    expect(review.assigneeId).toBe(SAM);
  });
});

describe("a group's + (TV-U10)", () => {
  it("shows the status it opened with as a chip, and files the task in it", async () => {
    renderBody({ seed: { status: "in_progress" } }, referenceStore({}), "Sketch the banner");
    expect(await screen.findByRole("button", { name: "Clear In progress" })).toBeTruthy();
    const title = await screen.findByRole("textbox", { name: "Task title" });
    await waitFor(() => expect(title.textContent).toBe("Sketch the banner"));
    fireEvent.click(screen.getByRole("button", { name: /^Create\s*⏎$/ }));
    await waitFor(() => expect(fake.saved.length).toBe(1));
    expect(fake.saved[0]?.statusCategory).toBe("in_progress");
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

describe("From template (`/template`, More → Template…, TV-D15)", () => {
  function withTemplates() {
    const apply = rs.fn(async (_deps: unknown, _input: unknown) => "t-new" as string | null);
    const provider: CaptureTemplateProvider = {
      useChoices: () => ({
        loaded: true,
        choices: [
          {
            id: "tt-1",
            name: "Episode",
            title: "Record episode",
            subtasks: 3,
            dated: true,
            anchor: "due",
            project: "p-acme",
          },
          {
            id: "tt-2",
            name: "Onboarding",
            title: "Onboard a client",
            subtasks: 2,
            dated: true,
            anchor: "start",
            project: null,
          },
        ],
      }),
      apply,
    };
    registerCaptureTemplates(provider);
    h.store = { isOffline: () => false };
    (fake.runtime as { tasks: Record<string, unknown> }).tasks.applyTaskTemplate = rs.fn();
    return apply;
  }

  it("a picked template fills the title and its project, and Create makes it on the server", async () => {
    const apply = withTemplates();
    const { onDone } = renderBody();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(await screen.findByRole("button", { name: "Template…" }));
    fireEvent.click(await screen.findByRole("button", { name: /Episode/ }));
    expect(await screen.findByText("Template: Episode")).toBeTruthy();
    expect(destination().textContent).toContain("Acme rebrand");
    // Its description, subtasks, tags and priority come from the template.
    expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Tags/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Create\s*⏎$/ }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(onDone).toHaveBeenCalled();
    expect(apply.mock.calls[0]?.[1]).toMatchObject({
      templateId: "tt-1",
      title: "Record episode",
      projectId: "p-acme",
      date: null,
    });
    // Nothing went through the capture's own create.
    expect(fake.saved).toEqual([]);
  });

  it("a template that counts from its start hides Due and starts today", async () => {
    const apply = withTemplates();
    renderBody();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(await screen.findByRole("button", { name: "Template…" }));
    fireEvent.click(await screen.findByRole("button", { name: /Onboarding/ }));
    expect(await screen.findByText(/Its dates count from today/)).toBeTruthy();
    await screen.findByText("Template: Onboarding");
    expect(screen.queryByRole("button", { name: /^Due/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Create\s*⏎$/ }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    const sent = apply.mock.calls[0]?.[1] as { date: string | null; projectId: string | null };
    expect(sent.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sent.projectId).toBeNull();
  });

  it("a refused apply keeps the capture open with its template", async () => {
    const apply = withTemplates();
    apply.mockImplementation(async () => null);
    const { onDone } = renderBody();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(await screen.findByRole("button", { name: "Template…" }));
    fireEvent.click(await screen.findByRole("button", { name: /Episode/ }));
    expect(await screen.findByText("Template: Episode")).toBeTruthy();
    expect(destination().textContent).toContain("Acme rebrand");
    fireEvent.click(screen.getByRole("button", { name: /^Create\s*⏎$/ }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByText("Template: Episode")).toBeTruthy();
  });

  it("without a registered provider there's no Template… in More", async () => {
    renderBody();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await screen.findByText("Waiting on");
    expect(screen.queryByRole("button", { name: "Template…" })).toBeNull();
  });
});

describe("Files on a capture (AT-3, AT3-2)", () => {
  const shot = () => new File([new Uint8Array(4)], "shot.png", { type: "image/png" });
  const clipboard = (files: File[], text = "") => ({
    clipboardData: {
      types: [...(files.length > 0 ? ["Files"] : []), ...(text ? ["text/plain"] : [])],
      files,
      items: files.map((f) => ({ kind: "file", getAsFile: () => f })),
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
  });
  let handled: Array<Parameters<CaptureAttachmentHandler>[0]>;
  beforeEach(() => {
    handled = [];
    registerCaptureAttachments((input) => handled.push(input));
  });
  afterEach(() => registerCaptureAttachments(null));

  async function openWithTitle() {
    saveDraft(ME, WS, {
      segments: [{ text: "Fix the login screen" }],
      keep: [],
      description: "",
      subtasks: [],
      fields: EMPTY_FIELDS,
    });
    renderBody();
    await screen.findByText(/Draft restored/);
  }
  const description = () => screen.getByRole("textbox", { name: "Description" });

  it("a screenshot pasted into the description becomes a chip; Create sends it with the new task", async () => {
    await openWithTitle();
    fireEvent.paste(description(), clipboard([shot()]));
    expect(await screen.findByRole("button", { name: "Remove shot.png" })).toBeTruthy();
    expect(document.querySelector('[data-slot="capture-files"]')?.textContent).toContain(
      "shot.png",
    );
    fireEvent.click(screen.getByRole("button", { name: /^Create\s*⏎$/ }));
    await waitFor(() => expect(fake.saved.length).toBe(1));
    expect(handled).toHaveLength(1);
    expect(handled[0]).toMatchObject({ workspaceId: WS, userId: ME });
    expect(handled[0]?.files.map((f) => f.name)).toEqual(["shot.png"]);
    // The task is made first; the files go on it once it exists.
    await expect(handled[0]?.task).resolves.toEqual({ id: fake.saved[0]?.id, queued: false });
  });

  it("a capture the server refuses keeps its files: they come back with it", async () => {
    fake.runtime.tasks.upsertTask.mockImplementationOnce(async () => {
      throw new Error("You can't add tasks here.");
    });
    await openWithTitle();
    fireEvent.paste(description(), clipboard([shot()]));
    await screen.findByRole("button", { name: "Remove shot.png" });
    fireEvent.click(screen.getByRole("button", { name: /^Create\s*⏎$/ }));
    await waitFor(() => expect(loadDraft(ME, WS, "refused")).not.toBeNull());
    // Nothing was made, so nothing is attached anywhere.
    await expect(handled[0]?.task).resolves.toBeNull();
    cleanup();
    renderBody();
    expect(await screen.findByRole("button", { name: "Remove shot.png" })).toBeTruthy();
  });

  it("text pasted into the description stays text", async () => {
    await openWithTitle();
    fireEvent.paste(description(), clipboard([], "notes"));
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
  });

  it("files dropped on the capture become chips; a chip comes off again", async () => {
    await openWithTitle();
    fireEvent.drop(description(), {
      dataTransfer: {
        types: ["Files"],
        files: [shot()],
        items: [
          {
            kind: "file",
            getAsFile: () => shot(),
            webkitGetAsEntry: () => ({ isDirectory: false }),
          },
        ],
      },
    });
    expect(await screen.findByRole("button", { name: "Remove shot.png" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove shot.png" }));
    expect(screen.queryByRole("button", { name: "Remove shot.png" })).toBeNull();
  });

  it("a folder dropped on the capture is left out", async () => {
    await openWithTitle();
    fireEvent.drop(description(), {
      dataTransfer: {
        types: ["Files"],
        files: [],
        items: [
          { kind: "file", getAsFile: () => null, webkitGetAsEntry: () => ({ isDirectory: true }) },
        ],
      },
    });
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
  });
});

describe("taskForFiles (the file seam's task, AT3-2)", () => {
  it("made: the files go now; waiting offline: they wait with it; refused: nothing to attach to", async () => {
    const made = Promise.resolve({ created: [{ id: "t1" }], queued: [] as string[] });
    await expect(taskForFiles(made, "t1")).resolves.toEqual({ id: "t1", queued: false });
    const offline = Promise.resolve({ created: [] as { id: string }[], queued: ["t1"] });
    await expect(taskForFiles(offline, "t1")).resolves.toEqual({ id: "t1", queued: true });
    const refused = Promise.resolve({ created: [] as { id: string }[], queued: [] as string[] });
    await expect(taskForFiles(refused, "t1")).resolves.toBeNull();
    await expect(taskForFiles(Promise.reject(new Error("no")), "t1")).resolves.toBeNull();
  });
});

describe("a prefilled open (chat's T and /task, CV-7b)", () => {
  it("starts fresh: an earlier draft's words and fields don't ride in", async () => {
    saveDraft(ME, WS, {
      segments: [{ text: "Old abandoned task" }],
      keep: [],
      description: "old description",
      subtasks: ["old subtask"],
      fields: EMPTY_FIELDS,
    });
    renderBody({ draft: "Order frames" }, referenceStore({}), "Order frames");
    await waitFor(() => expect(document.body.textContent).toContain("Order frames"));
    expect(document.body.textContent).not.toContain("Old abandoned task");
    expect(document.body.textContent).not.toContain("old subtask");
    expect(screen.queryByText(/Draft restored/)).toBeNull();
  });
});
