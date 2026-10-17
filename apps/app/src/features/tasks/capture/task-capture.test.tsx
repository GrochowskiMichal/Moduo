// TV-U14 · the Task capture body (tasks-v3 §10; AC10.1–10.3, AC5.1, AC5.4).
// Rendered on its own with a fake runtime: a restored draft, the "From:" chip,
// the destination row's states (team needs a project, the team's default,
// unfiled for someone else) and what Create sends.

import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from "lexical";
import { Toaster } from "sonner";

import { CAPTURE_OPEN_EVENT } from "../../../lib/capture-open";
import type { CaptureContext, CaptureRequest } from "../../../lib/capture-registry";
import { ReferenceStoreProvider } from "../../spine/references/context";
import type { ResolveContext } from "../../spine/references/resolvers";
import type { ReferencePreviewApi } from "../../spine/references/rows";
import { ReferenceStore } from "../../spine/references/store";
import type { Bucket, Task, Team } from "../model";
import { type CaptureDraft, EMPTY_FIELDS, loadDraft, saveDraft } from "./capture-draft";
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
      mentionInTask: rs.fn(async () => {}),
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
  onDraftChange: (line: string) => void = () => {},
) {
  const onDone = rs.fn();
  const utils = render(
    <ReferenceStoreProvider store={store}>
      <TaskCaptureBody
        draft={draft}
        onDraftChange={onDraftChange}
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
    // Nobody picked: the pill says the team's, never "You" (MOD-135).
    expect(screen.getByRole("button", { name: /^Assign:\s*Design · unclaimed$/ })).toBeTruthy();
  });
});

// The pill's name joins its hidden "Assign: " and the value without the space.
const pillName = (label: string, value: string) => new RegExp(`^${label}:\\s*${value}$`);

describe("the pills say what the task will get (MOD-134, MOD-135)", () => {
  const draftWith = (fields: Record<string, unknown>) =>
    saveDraft(ME, WS, {
      segments: [{ text: "Draw the poster" }],
      keep: [],
      description: "",
      subtasks: [],
      fields: { ...EMPTY_FIELDS, ...fields },
    });

  it("Assign shows you, with your avatar, while the task will be yours", async () => {
    renderBody();
    const pill = await screen.findByRole("button", { name: pillName("Assign", "You") });
    expect(pill.querySelector('[data-slot="avatar"]')).toBeTruthy();
  });

  it("Assign says Unassigned once that's picked", async () => {
    draftWith({ assigneeId: null });
    renderBody();
    expect(
      await screen.findByRole("button", { name: pillName("Assign", "Unassigned") }),
    ).toBeTruthy();
  });

  it("Priority shows the app's three bars: all faint unset, the level's once set", async () => {
    renderBody();
    const unset = await screen.findByRole("button", { name: "Priority" });
    expect(unset.querySelector('svg[data-level="0"]')).toBeTruthy();
    cleanup();
    draftWith({ priority: "high" });
    renderBody();
    const set = await screen.findByRole("button", { name: pillName("Priority", "High") });
    expect(set.querySelector('svg[data-level="3"]')).toBeTruthy();
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

describe("a date cleared by hand (MOD-133)", () => {
  it("its × keeps the date words as words: the chip stays gone, the title keeps them", async () => {
    renderBody({}, referenceStore({}), "Ring the framer tomorrow 3pm");
    const clear = await screen.findByRole("button", { name: /^Clear Tomorrow/ });
    fireEvent.click(clear);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Clear Tomorrow/ })).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Create\s*⏎$/ }));
    await waitFor(() => expect(fake.saved.length).toBe(1));
    const [task] = fake.saved;
    expect(task.title).toBe("Ring the framer tomorrow 3pm");
    expect(task.scheduledAt ?? null).toBeNull();
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

  it("from a prefilled open, a template create leaves the kept draft alone", async () => {
    const apply = withTemplates();
    saveDraft(ME, WS, {
      segments: [{ text: "Kept with Esc" }],
      keep: [],
      description: "",
      subtasks: [],
      fields: EMPTY_FIELDS,
    });
    const { onDone } = renderBody(
      { draft: "From chat", held: { current: null } },
      referenceStore({}),
      "From chat",
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(await screen.findByRole("button", { name: "Template…" }));
    fireEvent.click(await screen.findByRole("button", { name: /Episode/ }));
    expect(await screen.findByText("Template: Episode")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Create\s*⏎$/ }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    cleanup();
    expect(loadDraft(ME, WS)?.segments).toEqual([{ text: "Kept with Esc" }]);
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

// The description is a Lexical editor (call #15). jsdom has no ClipboardEvent
// or DragEvent, and Lexical tells them apart by class name: stand-ins, and
// events built on their prototypes (docs/gotchas/notes.md, AT-2).
const events = globalThis as Record<string, unknown>;
events.ClipboardEvent ??= class ClipboardEvent extends Event {};
events.DragEvent ??= class DragEvent extends Event {};
function dispatchAs(kind: "ClipboardEvent" | "DragEvent", el: Element, type: string, data: object) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, data);
  Object.setPrototypeOf(event, (events[kind] as typeof Event).prototype);
  el.dispatchEvent(event);
}

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
  const paste = (el: Element, data: object) =>
    act(async () => {
      dispatchAs("ClipboardEvent", el, "paste", data);
      await new Promise((r) => setTimeout(r, 0));
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
    await paste(description(), clipboard([shot()]));
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
    await paste(description(), clipboard([shot()]));
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
    await paste(description(), clipboard([], "notes"));
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
  });

  const dropOf = (files: File[]) => ({
    dataTransfer: {
      types: ["Files"],
      files,
      items: files.map((f) => ({
        kind: "file",
        getAsFile: () => f,
        webkitGetAsEntry: () => ({ isDirectory: false }),
      })),
    },
  });

  it("files dropped on the capture become chips; a chip comes off again", async () => {
    await openWithTitle();
    fireEvent.drop(screen.getByRole("button", { name: "Destination: Inbox" }), dropOf([shot()]));
    expect(await screen.findByRole("button", { name: "Remove shot.png" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove shot.png" }));
    expect(screen.queryByRole("button", { name: "Remove shot.png" })).toBeNull();
  });

  it("a file dropped on the description's text becomes one chip (its editor takes the drop)", async () => {
    await openWithTitle();
    await act(async () => {
      dispatchAs("DragEvent", description(), "drop", dropOf([shot()]));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(await screen.findAllByRole("button", { name: "Remove shot.png" })).toHaveLength(1);
  });

  it("a file dropped on the box around the description's text becomes a chip too", async () => {
    await openWithTitle();
    const box = document.querySelector("[data-capture-description]");
    if (!box) throw new Error("no description box");
    fireEvent.drop(box, dropOf([shot()]));
    expect(await screen.findAllByRole("button", { name: "Remove shot.png" })).toHaveLength(1);
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

describe("The description: one editor, Markdown, ⏎ creates (call #15, MOD-117)", () => {
  const TASK_ID = "11111111-1111-4111-8111-111111111111";
  // A focused editor measures its caret; jsdom's Range can't.
  const rangeProto = Range.prototype as unknown as Record<string, unknown>;
  rangeProto.getBoundingClientRect ??= () => ({
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
  });
  rangeProto.getClientRects ??= () => [];

  async function openWith(description: string, mentions: CaptureDraft["mentions"] = []) {
    saveDraft(ME, WS, {
      segments: [{ text: "Fix the login screen" }],
      keep: [],
      description,
      subtasks: [],
      fields: EMPTY_FIELDS,
      mentions,
    });
    renderBody();
    await screen.findByText(/Draft restored/);
    const box = screen.getByRole("textbox", { name: "Description" });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // The caret at the end of the text, where Lexical reads it on a key.
    box.focus();
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    let last: Node | null = null;
    while (walker.nextNode()) last = walker.currentNode;
    const range = document.createRange();
    range.setStart(last ?? box, last ? (last.textContent?.length ?? 0) : 0);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    act(() => {
      (box as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor.update(
        () => $getRoot().selectEnd(),
        { discrete: true },
      );
    });
    return box;
  }

  it("shows its Markdown formatted, and ⏎ in it creates the task with that Markdown", async () => {
    const box = await openWith(`Check **this** with [task](moduo://task/${TASK_ID})`);
    expect(box.querySelector("strong")?.textContent).toBe("this");
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(fake.saved.length).toBe(1));
    expect(fake.saved[0]?.title).toBe("Fix the login screen");
    expect(fake.saved[0]?.description).toBe(`Check **this** with [task](moduo://task/${TASK_ID})`);
    // What it references links once the task exists, as the title's things do.
    await waitFor(() =>
      expect(fake.links).toContainEqual(
        expect.objectContaining({
          target: { type: "task", id: TASK_ID },
          relationKind: "mentions",
        }),
      ),
    );
  });

  it("a draft with a crafted description comes back quickly, and creates with it (security review)", async () => {
    const crafted = [
      "*a".repeat(2_500),
      Array.from({ length: 20 }, () => `- ${"*a".repeat(2_400)}`).join("\n"),
      "[x](".repeat(15_000),
    ].join("\n\n");
    const start = performance.now();
    const box = await openWith(crafted);
    expect(performance.now() - start).toBeLessThan(4000);
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(fake.saved.length).toBe(1));
    expect(fake.saved[0]?.description).toBe(crafted);
  });

  it("a restored draft still tells the people its description @-mentions", async () => {
    const box = await openWith("Ask @Sam Ortiz about it", [{ id: SAM, label: null }]);
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(fake.saved.length).toBe(1));
    await waitFor(() =>
      expect(fake.runtime.tasks.mentionInTask).toHaveBeenCalledWith({
        workspaceId: WS,
        taskId: fake.saved[0]?.id,
        userIds: [SAM],
      }),
    );
  });

  it("a restored draft tells someone mentioned by email (no name set) too", async () => {
    const box = await openWith("Ask @sam@example.com about it", [
      { id: SAM, label: "sam@example.com" },
    ]);
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(fake.saved.length).toBe(1));
    await waitFor(() =>
      expect(fake.runtime.tasks.mentionInTask).toHaveBeenCalledWith({
        workspaceId: WS,
        taskId: fake.saved[0]?.id,
        userIds: [SAM],
      }),
    );
  });

  it("⇧⏎ in it starts a new line and creates nothing", async () => {
    const box = await openWith("First line");
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fake.saved).toHaveLength(0);
    expect(box.querySelectorAll("p")).toHaveLength(2);
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
  /** Types into the description (one Lexical editor since call #15, MOD-117). */
  const typeDescription = async (text: string) => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const box = screen.getByRole("textbox", { name: "Description" });
    act(() => {
      (box as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor.update(
        () => {
          const root = $getRoot();
          root.clear();
          root.append($createParagraphNode().append($createTextNode(text)));
        },
        { discrete: true },
      );
    });
  };
  /** The description's words as shown. */
  const descriptionText = () => screen.getByRole("textbox", { name: "Description" }).textContent;
  const KEPT_SEGMENTS = [
    { text: "Kept with Esc " },
    { token: { kind: "person" as const, userId: SAM, label: "" } },
  ];
  const keepDraft = () =>
    saveDraft(ME, WS, {
      segments: KEPT_SEGMENTS,
      keep: [],
      description: "kept description",
      subtasks: ["kept subtask"],
      fields: EMPTY_FIELDS,
    });
  const keptIsThere = () => {
    const kept = loadDraft(ME, WS);
    expect(kept?.segments).toEqual(KEPT_SEGMENTS);
    expect(kept?.description).toBe("kept description");
    expect(kept?.subtasks).toEqual(["kept subtask"]);
  };
  /** The shell's context for one prefilled open: `held` lives as long as it. */
  const prefilledOpen = (words: string, openId = 1): Partial<CaptureContext> => ({
    draft: words,
    openId,
    held: { current: null },
  });
  const createButton = (name: RegExp) =>
    screen.getAllByRole("button").find((b) => name.test(b.textContent ?? "")) as HTMLButtonElement;

  it("starts fresh: an earlier draft's words and fields don't ride in", async () => {
    keepDraft();
    renderBody(prefilledOpen("Order frames"), referenceStore({}), "Order frames");
    await waitFor(() => expect(document.body.textContent).toContain("Order frames"));
    expect(document.body.textContent).not.toContain("Kept with Esc");
    expect(document.body.textContent).not.toContain("kept subtask");
    expect(screen.queryByText(/Draft restored/)).toBeNull();
  });

  it("T then Esc: the kept draft is still there", async () => {
    keepDraft();
    const { unmount } = renderBody(prefilledOpen("From chat", 7), referenceStore({}), "From chat");
    await waitFor(() => expect(document.body.textContent).toContain("From chat"));
    unmount();
    keptIsThere();
  });

  it("T then ⏎: the task is the message's, and the kept draft is still there", async () => {
    keepDraft();
    const { onDone } = renderBody(prefilledOpen("From chat"), referenceStore({}), "From chat");
    await waitFor(() => expect(createButton(/^Create⏎?$/).disabled).toBe(false));
    fireEvent.click(createButton(/^Create⏎?$/));
    await waitFor(() => expect(fake.saved.length).toBeGreaterThan(0));
    expect(fake.saved[0]?.title).toBe("From chat");
    expect(onDone).toHaveBeenCalled();
    cleanup();
    keptIsThere();
  });

  it("T then Create more: the emptied capture never overwrites the kept draft", async () => {
    keepDraft();
    renderBody(prefilledOpen("From chat"), referenceStore({}), "From chat");
    await waitFor(() => expect(createButton(/^Create more/).disabled).toBe(false));
    fireEvent.click(createButton(/^Create more/));
    await waitFor(() => expect(fake.saved.length).toBeGreaterThan(0));
    await waitFor(() => expect(document.body.textContent).not.toContain("From chat"));
    keptIsThere();
    cleanup();
    keptIsThere();
  });

  it("T, a type switch and back with nothing changed: the prefill stays, the kept draft doesn't show", async () => {
    keepDraft();
    const open = prefilledOpen("From chat");
    const first = renderBody(open, referenceStore({}), "From chat");
    await waitFor(() => expect(document.body.textContent).toContain("From chat"));
    first.unmount(); // ⌘2: the body goes, the shell's open (and `held`) stays
    renderBody(open, referenceStore({}), "From chat"); // ⌘3: back
    await waitFor(() => expect(document.body.textContent).toContain("From chat"));
    expect(document.body.textContent).not.toContain("Kept with Esc");
    expect(document.body.textContent).not.toContain("kept subtask");
    expect(screen.queryByText(/Draft restored/)).toBeNull();
    await waitFor(() => expect(createButton(/^Create⏎?$/).disabled).toBe(false));
    fireEvent.click(createButton(/^Create⏎?$/));
    await waitFor(() => expect(fake.saved.length).toBeGreaterThan(0));
    expect(fake.saved[0]?.title).toBe("From chat");
    cleanup();
    keptIsThere();
  });

  it("T, a change under another type, then back: the new words come along", async () => {
    const open = prefilledOpen("From chat");
    const first = renderBody(open, referenceStore({}), "From chat");
    await waitFor(() => expect(document.body.textContent).toContain("From chat"));
    first.unmount();
    renderBody(open, referenceStore({}), "From chat, edited as a note");
    await waitFor(() => expect(document.body.textContent).toContain("From chat, edited as a note"));
  });

  it("T, an edit, Esc, then a normal open: the kept draft comes back as it was, tokens and all", async () => {
    keepDraft();
    // A normal open first: the shell's line is the kept draft's words.
    let line = "";
    const normal = renderBody({}, referenceStore({}), "", (next) => {
      line = next;
    });
    await waitFor(() => expect(line).toContain("Kept with Esc"));
    normal.unmount();
    const first = renderBody(prefilledOpen("From chat"), referenceStore({}), "From chat");
    await waitFor(() => expect(document.body.textContent).toContain("From chat"));
    await typeDescription("typed in the prefilled capture");
    first.unmount();
    keptIsThere();
    // The shell gives the line back as it was before the prefill: the stored
    // draft (its person token included) is the one restored, not its words.
    renderBody({ openId: 2 }, referenceStore({}), line);
    await waitFor(() => expect(document.body.textContent).toContain("Kept with Esc"));
    expect(document.querySelector('[data-capture-token="person"]')).toBeTruthy();
    expect(document.body.textContent).not.toContain("From chat");
    expect(descriptionText()).toBe("kept description");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    keptIsThere();
  });

  /** T, a description and a file, ⏎ refused, then the toast's Restore: the request it opens. */
  async function refuseThenRestore(): Promise<CaptureRequest | undefined> {
    fake.runtime.tasks.upsertTask.mockImplementationOnce(async () => {
      throw new Error("You can't add tasks here.");
    });
    const opened: CaptureRequest[] = [];
    const onOpen = (e: Event) => opened.push((e as CustomEvent<CaptureRequest>).detail);
    window.addEventListener(CAPTURE_OPEN_EVENT, onOpen);
    render(<Toaster />);
    const first = renderBody(prefilledOpen("From chat"), referenceStore({}), "From chat");
    const shot = new File([new Uint8Array(4)], "shot.png", { type: "image/png" });
    await typeDescription("the refused one's words");
    await act(async () => {
      dispatchAs("ClipboardEvent", screen.getByRole("textbox", { name: "Description" }), "paste", {
        clipboardData: {
          types: ["Files"],
          files: [shot],
          items: [{ kind: "file", getAsFile: () => shot }],
          getData: () => "",
        },
      });
      await new Promise((r) => setTimeout(r, 0));
    });
    await screen.findByRole("button", { name: "Remove shot.png" });
    await waitFor(() => expect(createButton(/^Create⏎?$/).disabled).toBe(false));
    fireEvent.click(createButton(/^Create⏎?$/));
    first.unmount();
    await waitFor(() => expect(loadDraft(ME, WS, "refused")).not.toBeNull());
    // The newest toast is the front one (earlier tests' toasts stay in sonner).
    fireEvent.click((await screen.findAllByRole("button", { name: "Restore" }))[0] as HTMLElement);
    window.removeEventListener(CAPTURE_OPEN_EVENT, onOpen);
    return opened.at(-1);
  }
  /** The shell's context for a Restore's open (a fresh `held`). */
  const restoreOpen = (request: CaptureRequest | undefined, openId: number) => ({
    ...request,
    openId,
    held: { current: null },
  });

  it("T, ⏎ refused, then Restore: it opens in its own draft (files too), the kept one stays", async () => {
    keepDraft();
    const uploads: File[][] = [];
    registerCaptureAttachments((input) => uploads.push(input.files));
    const request = await refuseThenRestore();
    keptIsThere();
    // Kept until it's made: an open that doesn't happen loses nothing.
    expect(loadDraft(ME, WS, "refused")?.description).toBe("the refused one's words");
    expect(request).toMatchObject({ type: "task", draft: "From chat", fromRefused: true });
    const second = renderBody(restoreOpen(request, 3), referenceStore({}), "From chat");
    await waitFor(() => expect(document.body.textContent).toContain("From chat"));
    expect(descriptionText()).toBe("the refused one's words");
    expect(screen.getByRole("button", { name: "Remove shot.png" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("Kept with Esc");
    // Esc: both stay kept, files too.
    second.unmount();
    keptIsThere();
    expect(loadDraft(ME, WS, "refused")).not.toBeNull();
    // Opened again, switched to another type and back, and made: only the
    // refused one goes, and its file goes up once, with it.
    const again = restoreOpen(request, 4);
    const third = renderBody(again, referenceStore({}), "From chat");
    expect(await screen.findByRole("button", { name: "Remove shot.png" })).toBeTruthy();
    third.unmount();
    renderBody(again, referenceStore({}), "From chat");
    expect(await screen.findByRole("button", { name: "Remove shot.png" })).toBeTruthy();
    uploads.length = 0;
    await waitFor(() => expect(createButton(/^Create⏎?$/).disabled).toBe(false));
    fireEvent.click(createButton(/^Create⏎?$/));
    await waitFor(() => expect(loadDraft(ME, WS, "refused")).toBeNull());
    expect(uploads.map((files) => files.map((f) => f.name))).toEqual([["shot.png"]]);
    cleanup();
    keptIsThere();
    // Nothing of it comes back on a later open (no duplicate).
    window.localStorage.clear();
    renderBody({ openId: 5 }, referenceStore({}), "");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByRole("button", { name: "Remove shot.png" })).toBeNull();
    registerCaptureAttachments(null);
  });

  it("a restored capture made with Create more is no longer kept", async () => {
    keepDraft();
    registerCaptureAttachments(() => {});
    const request = await refuseThenRestore();
    renderBody(restoreOpen(request, 3), referenceStore({}), "From chat");
    await waitFor(() => expect(createButton(/^Create more/).disabled).toBe(false));
    fireEvent.click(createButton(/^Create more/));
    await waitFor(() => expect(fake.saved.length).toBeGreaterThan(0));
    cleanup();
    expect(loadDraft(ME, WS, "refused")).toBeNull();
    keptIsThere();
    window.localStorage.removeItem(`moduo:capture-draft:task:${ME}:${WS}`);
    renderBody({ openId: 4 }, referenceStore({}), "");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByText(/Draft restored/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove shot.png" })).toBeNull();
    registerCaptureAttachments(null);
  });

  it("a restored capture refused again on Create more stays kept through Esc", async () => {
    keepDraft();
    registerCaptureAttachments(() => {});
    const request = await refuseThenRestore();
    // Lexical measures the caret when the capture is filled back.
    Range.prototype.getBoundingClientRect ??= () => new DOMRect();
    Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
    // Refused once the emptied capture has drawn: it comes back into it.
    fake.runtime.tasks.upsertTask.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 50));
      throw new Error("Still not here.");
    });
    const second = renderBody(restoreOpen(request, 3), referenceStore({}), "From chat");
    await waitFor(() => expect(createButton(/^Create more/).disabled).toBe(false));
    fireEvent.click(createButton(/^Create more/));
    // The description editor empties a beat after the click, so wait for the
    // refusal itself (50 ms above) before reading what came back. Outside
    // `act`: inside it React would hold the emptied title until the end.
    await new Promise((r) => setTimeout(r, 150));
    await waitFor(() => expect(descriptionText()).toBe("the refused one's words"));
    second.unmount();
    expect(loadDraft(ME, WS, "refused")?.description).toBe("the refused one's words");
    keptIsThere();
    registerCaptureAttachments(null);
  });

  it("Restore into an open prefilled capture, then Esc: the refused one stays kept", async () => {
    render(<Toaster />);
    saveDraft(ME, WS, {
      segments: [{ text: "Refused while closed" }],
      keep: [],
      description: "",
      subtasks: [],
      fields: EMPTY_FIELDS,
    });
    fake.runtime.tasks.upsertTask.mockImplementationOnce(async () => {
      throw new Error("You can't add tasks here.");
    });
    const first = renderBody({ openId: 1 }, referenceStore({}), "");
    await waitFor(() => expect(createButton(/^Create⏎?$/).disabled).toBe(false));
    fireEvent.click(createButton(/^Create⏎?$/));
    first.unmount();
    await waitFor(() =>
      expect(loadDraft(ME, WS, "refused")?.segments).toEqual([{ text: "Refused while closed" }]),
    );
    // Chat's T opens the capture; the toast's Restore fills it.
    const open = prefilledOpen("From chat", 2);
    const second = renderBody(open, referenceStore({}), "From chat");
    await waitFor(() => expect(document.body.textContent).toContain("From chat"));
    fireEvent.click((await screen.findAllByRole("button", { name: "Restore" }))[0] as HTMLElement);
    await waitFor(() => expect(document.body.textContent).toContain("Refused while closed"));
    second.unmount();
    expect(loadDraft(ME, WS, "refused")?.segments).toEqual([{ text: "Refused while closed" }]);
    // Made in that open (back from a type switch): no longer kept.
    renderBody(open, referenceStore({}), "Refused while closed");
    await waitFor(() => expect(createButton(/^Create⏎?$/).disabled).toBe(false));
    fireEvent.click(createButton(/^Create⏎?$/));
    await waitFor(() => expect(loadDraft(ME, WS, "refused")).toBeNull());
  });

  it("a Restore that finds no refused capture here (another workspace) starts empty", async () => {
    keepDraft();
    renderBody(
      { draft: "Words from elsewhere", fromRefused: true, openId: 3, held: { current: null } },
      referenceStore({}),
      "Words from elsewhere",
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.body.textContent).not.toContain("Words from elsewhere");
    expect(document.body.textContent).not.toContain("Kept with Esc");
    keptIsThere();
  });

  it("a normal open keeps today's draft: what's typed is kept on the device", async () => {
    const first = renderBody({}, referenceStore({}), "");
    await typeDescription("normal words");
    await waitFor(() => expect(loadDraft(ME, WS)?.description).toBe("normal words"));
    first.unmount();
    expect(loadDraft(ME, WS)?.description).toBe("normal words");
  });
});
