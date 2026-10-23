// TV-U17 · Tasks' welcome: the role question once, the basics with "Learn
// more" / "Explore on your own", three steps with Back / Next and dots, Esc and
// Close always there; and when it opens by itself (once per person, never for
// someone who already made tasks here), what it seeds, and what a role answer
// does.

import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";

import {
  currentPreferences,
  DEFAULT_PREFERENCES,
  updatePreferences,
} from "../../../lib/preferences";
import { setDomainReconciledForTest } from "../../../lib/prefs-sync";
import { CACHE_VERSION, cacheKey, memoryCache } from "../../../lib/sync/cache";
import { setStoreOptionsForTests, workspaceStore } from "../../../lib/sync/store";
import type { TaskCommands } from "../commands";
import { makeTask } from "../helpers";
import type { Bucket, Task } from "../model";
import {
  type FakeRuntimeExtras,
  FakeTasksProvider,
  fakeTasksRuntime,
  type FakeTasksSeed,
} from "../testing/fake-tasks";
import { requestTasksWelcome } from "../welcome-request";
import { TasksWelcomeDialog } from "./tasks-welcome-dialog";
import { type TasksWelcome, useTasksWelcome, type WelcomeStep } from "./use-tasks-welcome";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
beforeEach(() => {
  localStorage.clear();
  updatePreferences({ tasksOnboarding: { ...DEFAULT_PREFERENCES.tasksOnboarding } });
  setDomainReconciledForTest("preferences", null);
});
afterEach(cleanup);

function fakeWelcome(step: WelcomeStep, over: Partial<TasksWelcome> = {}): TasksWelcome {
  return {
    open: true,
    step,
    setStep: rs.fn(),
    close: rs.fn(),
    chooseRole: rs.fn(),
    starterName: null,
    reopen: rs.fn(),
    ...over,
  };
}

describe("the dialog", () => {
  it("asks the role question once, each answer one click, with Skip", () => {
    const welcome = fakeWelcome("role");
    render(<TasksWelcomeDialog welcome={welcome} />);
    expect(screen.getByRole("heading", { name: "What will you run in Moduo?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Software/ }));
    expect(welcome.chooseRole).toHaveBeenCalledWith("developer");
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(welcome.chooseRole).toHaveBeenLastCalledWith(null);
  });

  it("closing the role question skips it (it's asked once)", () => {
    const welcome = fakeWelcome("role");
    render(<TasksWelcomeDialog welcome={welcome} />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(welcome.chooseRole).toHaveBeenCalledWith(null);
    expect(welcome.close).toHaveBeenCalled();
  });

  it("the basics: three lines, Learn more or Explore on your own, and where a starter went", () => {
    const welcome = fakeWelcome("basics", { starterName: "Project kickoff" });
    render(<TasksWelcomeDialog welcome={welcome} />);
    expect(screen.getByRole("heading", { name: "Welcome to Tasks" })).toBeTruthy();
    expect(screen.getByText(/captures a task/)).toBeTruthy();
    expect(screen.getByText(/Project kickoff is in your templates/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Learn more" }));
    expect(welcome.setStep).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Explore on your own" }));
    expect(welcome.close).toHaveBeenCalled();
  });

  it("a step: a clip, words, dots, Back and Next; the last says Done", () => {
    const first = fakeWelcome(1);
    const { unmount } = render(<TasksWelcomeDialog welcome={first} />);
    expect(screen.getByRole("heading", { name: "Above the line is yours" })).toBeTruthy();
    expect(document.querySelector("[data-slot=welcome-clip] img")).toBeTruthy();
    expect(screen.getByText("Step 1 of 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(first.setStep).toHaveBeenCalledWith("basics");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(first.setStep).toHaveBeenCalledWith(2);
    unmount();

    const focus = fakeWelcome(2);
    const second = render(<TasksWelcomeDialog welcome={focus} />);
    // Focus's step is the Focus empty state's own words (TV-F7).
    expect(screen.getByText(/one task at a time/)).toBeTruthy();
    expect(screen.getByText(/to add it to Focus/)).toBeTruthy();
    second.unmount();

    const last = fakeWelcome(3);
    render(<TasksWelcomeDialog welcome={last} />);
    expect(screen.getByText(/runs commands/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(last.close).toHaveBeenCalled();
  });
});

// ── when it opens by itself ───────────────────────────────────────────────

const ME = "user-me";
const WS = "ws-1";

function bucket(id: string, over: Partial<Bucket> = {}): Bucket {
  return {
    id,
    workspaceId: WS,
    ownerId: ME,
    name: id,
    isSystem: false,
    group: null,
    position: id,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    ...over,
  };
}

/** Your Inbox: where the teaching tasks go. */
const INBOX = bucket("inbox-1", { name: "Inbox", isSystem: true });

function task(id: string, creatorId: string, bucketId = INBOX.id): Task {
  return { ...makeTask({ workspaceId: WS, bucketId, title: id, position: id }), id, creatorId };
}

/**
 * The workspace as the server holds it (your Inbox, plus `over`), and a spy
 * for `createTask` (the teaching tasks).
 */
function fakeWorkspace(
  over: { tasks?: Task[]; buckets?: Bucket[]; createTask?: (...args: never[]) => unknown } = {},
) {
  const seed: FakeTasksSeed = {
    tasks: over.tasks ?? [],
    buckets: [INBOX, ...(over.buckets ?? [])],
  };
  const createTask = rs.fn(over.createTask ?? (() => Promise.resolve(null)));
  return { seed, createTask, commands: { createTask } as unknown as Partial<TaskCommands> };
}

type FakeWorkspace = ReturnType<typeof fakeWorkspace>;

/**
 * A provider on `ws`'s store, already read as a warm page finds it. `extras`
 * replaces runtime calls (a server slow to answer); `prepare` runs before the
 * store is made (a device copy to open from).
 */
async function tasksHost(
  ws: FakeWorkspace,
  opts: { extras?: FakeRuntimeExtras; prepare?: () => void } = {},
) {
  const fake = fakeTasksRuntime(ws.seed, opts.extras);
  opts.prepare?.();
  const store = workspaceStore(fake.runtime, ME, WS);
  const release = store.acquire();
  await store.whenRest();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FakeTasksProvider runtime={fake.runtime} userId={ME} workspaceId={WS} commands={ws.commands}>
        {children}
      </FakeTasksProvider>
    );
  }
  return { Wrapper, release, store };
}

async function renderWelcome(
  ws: FakeWorkspace,
  opts: { isOwner?: boolean; runtime?: unknown; onFirstView?: () => void } = {},
) {
  const host = await tasksHost(ws);
  const view = renderHook(
    () =>
      useTasksWelcome({
        runtime: (opts.runtime ?? null) as never,
        workspaceId: WS,
        isOwner: opts.isOwner ?? false,
        onFirstView: opts.onFirstView ?? (() => undefined),
      }),
    { wrapper: host.Wrapper },
  );
  // The provider holds the store now.
  host.release();
  return view;
}

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe("useTasksWelcome", () => {
  it("waits for the person's preferences, then opens on the role question, once", async () => {
    const { result } = await renderWelcome(fakeWorkspace());
    expect(result.current.open).toBe(false);
    act(() => setDomainReconciledForTest("preferences", ME));
    expect(result.current.open).toBe(true);
    expect(result.current.step).toBe("role");
    expect(currentPreferences().tasksOnboarding.welcomeSeenAt).not.toBeNull();
    await flush();
  });

  it("opens on the basics when the role was already answered", async () => {
    updatePreferences({
      tasksOnboarding: { ...DEFAULT_PREFERENCES.tasksOnboarding, roleAt: "2026-10-13T09:00:00Z" },
    });
    setDomainReconciledForTest("preferences", ME);
    const { result } = await renderWelcome(fakeWorkspace());
    expect(result.current.step).toBe("basics");
  });

  it("never opens once seen, and never for someone who already made tasks here", async () => {
    setDomainReconciledForTest("preferences", ME);
    const experienced = await renderWelcome(fakeWorkspace({ tasks: [task("t1", ME)] }));
    expect(experienced.result.current.open).toBe(false);
    // Marked seen quietly: no other device asks either.
    expect(currentPreferences().tasksOnboarding.welcomeSeenAt).not.toBeNull();
    experienced.unmount();
    const again = await renderWelcome(fakeWorkspace());
    expect(again.result.current.open).toBe(false);
  });

  it("waits while the tasks come only from this device's copy", async () => {
    setDomainReconciledForTest("preferences", ME);
    // The device copy holds the whole workspace (open and the rest); the
    // server answers only once let through.
    const cache = memoryCache();
    cache.records.set(cacheKey(ME, WS), {
      v: CACHE_VERSION,
      savedAt: Date.now(),
      tables: { buckets: { rows: [INBOX], cursor: null } },
      restLoaded: true,
      outbox: [],
    });
    let serverUp: () => void = () => {};
    const up = new Promise<void>((resolve) => {
      serverUp = resolve;
    });
    const ws = fakeWorkspace();
    const host = await tasksHost(ws, {
      prepare: () => setStoreOptionsForTests({ cache, listen: () => () => {} }),
      extras: {
        tasks: {
          syncRead: async ({ table, part }: { table: keyof FakeTasksSeed; part?: string }) => {
            await up;
            return {
              rows: table === "tasks" && part === "rest" ? [] : (ws.seed[table] ?? []),
              deleted: [],
              maxUpdatedAt: null,
              truncated: null,
            };
          },
        },
      },
    });
    expect(host.store.getSnapshot()).toMatchObject({ fromCache: true, restLoaded: true });
    const { result } = renderHook(
      () =>
        useTasksWelcome({
          runtime: null,
          workspaceId: WS,
          isOwner: false,
          onFirstView: () => undefined,
        }),
      { wrapper: host.Wrapper },
    );
    host.release();
    expect(result.current.open).toBe(false);
    await act(async () => serverUp());
    await waitFor(() => expect(result.current.open).toBe(true));
  });

  it("seeds the three teaching tasks in the owner's empty workspace, once", async () => {
    setDomainReconciledForTest("preferences", ME);
    const ws = fakeWorkspace();
    await renderWelcome(ws, { isOwner: true });
    await flush();
    await flush();
    const create = ws.createTask;
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls.map((c) => (c[0] as { bucketId: string }).bucketId)).toEqual([
      "inbox-1",
      "inbox-1",
      "inbox-1",
    ]);
    expect(currentPreferences().tasksOnboarding.seeded["ws-1"]).toBeTruthy();
  });

  it("never seeds a workspace whose only projects are archived", async () => {
    setDomainReconciledForTest("preferences", ME);
    // An archived project, with its task: the store sets both apart.
    const ws = fakeWorkspace({
      buckets: [bucket("old", { archivedAt: "2026-10-01T09:00:00Z" })],
      tasks: [task("t0", ME, "old")],
    });
    await renderWelcome(ws, { isOwner: true });
    await flush();
    await flush();
    expect(ws.createTask).not.toHaveBeenCalled();
  });

  it("stops seeding when the workspace changes mid-way", async () => {
    setDomainReconciledForTest("preferences", ME);
    let release: () => void = () => {};
    const ws = fakeWorkspace({
      createTask: () =>
        new Promise((resolve) => {
          release = () => resolve(null);
        }),
    });
    const host = await tasksHost(ws);
    const view = renderHook(
      ({ workspaceId }) =>
        useTasksWelcome({
          runtime: null,
          workspaceId,
          isOwner: true,
          onFirstView: () => undefined,
        }),
      { initialProps: { workspaceId: WS }, wrapper: host.Wrapper },
    );
    host.release();
    await flush();
    expect(ws.createTask).toHaveBeenCalledTimes(1);
    view.rerender({ workspaceId: "ws-2" });
    await act(async () => release());
    await flush();
    expect(ws.createTask).toHaveBeenCalledTimes(1);
  });

  it("never seeds a workspace someone else prepared", async () => {
    setDomainReconciledForTest("preferences", ME);
    const ws = fakeWorkspace({ tasks: [task("t1", "organiser")], buckets: [bucket("p1")] });
    const { result } = await renderWelcome(ws, { isOwner: false });
    await flush();
    expect(result.current.open).toBe(true);
    expect(ws.createTask).not.toHaveBeenCalled();
  });

  it("a role answer opens its first view and adds its starter template", async () => {
    setDomainReconciledForTest("preferences", ME);
    const onFirstView = rs.fn();
    const createStarterTemplate = rs.fn(() =>
      Promise.resolve({ id: "tpl-1", name: "Project kickoff" }),
    );
    const runtime = {
      tasks: { createStarterTemplate, listTemplates: rs.fn(() => Promise.resolve([])) },
    };
    const { result } = await renderWelcome(fakeWorkspace({ buckets: [bucket("p1")] }), {
      runtime,
      onFirstView,
    });
    act(() => result.current.chooseRole("pm"));
    expect(onFirstView).toHaveBeenCalledWith({ selection: "p1", board: true });
    expect(currentPreferences().tasksOnboarding).toMatchObject({ role: "pm" });
    expect(result.current.step).toBe("basics");
    await flush();
    expect(createStarterTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", starter: "kickoff" }),
    );
    expect(result.current.starterName).toBe("Project kickoff");
  });

  it("Skip records the question as asked, with no role", async () => {
    setDomainReconciledForTest("preferences", ME);
    const onFirstView = rs.fn();
    const { result } = await renderWelcome(fakeWorkspace(), { onFirstView });
    act(() => result.current.chooseRole(null));
    expect(onFirstView).not.toHaveBeenCalled();
    expect(currentPreferences().tasksOnboarding.role).toBeNull();
    expect(currentPreferences().tasksOnboarding.roleAt).not.toBeNull();
  });

  it("Help → What's in Tasks reopens it at the basics", async () => {
    updatePreferences({
      tasksOnboarding: {
        ...DEFAULT_PREFERENCES.tasksOnboarding,
        welcomeSeenAt: "2026-10-13T09:00:00Z",
      },
    });
    setDomainReconciledForTest("preferences", ME);
    const { result } = await renderWelcome(fakeWorkspace());
    expect(result.current.open).toBe(false);
    act(() => requestTasksWelcome());
    expect(result.current.open).toBe(true);
    expect(result.current.step).toBe("basics");
  });
});
