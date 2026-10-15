// TV-U17 · Tasks' welcome: the role question once, the basics with "Learn
// more" / "Explore on your own", three steps with Back / Next and dots, Esc and
// Close always there; and when it opens by itself (once per person, never for
// someone who already made tasks here), what it seeds, and what a role answer
// does.

import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";

import {
  currentPreferences,
  DEFAULT_PREFERENCES,
  updatePreferences,
} from "../../../lib/preferences";
import { setDomainReconciledForTest } from "../../../lib/prefs-sync";
import type { Task } from "../model";
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

function task(id: string, creatorId: string): Task {
  return { id, creatorId } as unknown as Task;
}

function fakeApi(over: Record<string, unknown> = {}) {
  return {
    tasks: [] as Task[],
    buckets: [] as Array<{ id: string }>,
    inbox: { id: "inbox-1" },
    canEdit: true,
    currentUserId: ME,
    reachedServer: true,
    restLoaded: true,
    createTask: rs.fn(() => Promise.resolve(null)),
    ...over,
  } as never;
}

function renderWelcome(
  api: ReturnType<typeof fakeApi>,
  opts: { isOwner?: boolean; runtime?: unknown; onFirstView?: () => void } = {},
) {
  return renderHook(
    ({ a }) =>
      useTasksWelcome({
        api: a,
        runtime: (opts.runtime ?? null) as never,
        workspaceId: "ws-1",
        isOwner: opts.isOwner ?? false,
        onFirstView: opts.onFirstView ?? (() => undefined),
      }),
    { initialProps: { a: api } },
  );
}

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe("useTasksWelcome", () => {
  it("waits for the person's preferences, then opens on the role question, once", async () => {
    const { result } = renderWelcome(fakeApi());
    expect(result.current.open).toBe(false);
    act(() => setDomainReconciledForTest("preferences", ME));
    expect(result.current.open).toBe(true);
    expect(result.current.step).toBe("role");
    expect(currentPreferences().tasksOnboarding.welcomeSeenAt).not.toBeNull();
    await flush();
  });

  it("opens on the basics when the role was already answered", () => {
    updatePreferences({
      tasksOnboarding: { ...DEFAULT_PREFERENCES.tasksOnboarding, roleAt: "2026-10-13T09:00:00Z" },
    });
    setDomainReconciledForTest("preferences", ME);
    const { result } = renderWelcome(fakeApi());
    expect(result.current.step).toBe("basics");
  });

  it("never opens once seen, and never for someone who already made tasks here", () => {
    setDomainReconciledForTest("preferences", ME);
    const experienced = renderWelcome(fakeApi({ tasks: [task("t1", ME)] }));
    expect(experienced.result.current.open).toBe(false);
    // Marked seen quietly: no other device asks either.
    expect(currentPreferences().tasksOnboarding.welcomeSeenAt).not.toBeNull();
    experienced.unmount();
    const again = renderWelcome(fakeApi());
    expect(again.result.current.open).toBe(false);
  });

  it("waits while the tasks come only from this device's copy", () => {
    setDomainReconciledForTest("preferences", ME);
    const { result, rerender } = renderWelcome(fakeApi({ reachedServer: false }));
    expect(result.current.open).toBe(false);
    rerender({ a: fakeApi({ reachedServer: true }) });
    expect(result.current.open).toBe(true);
  });

  it("seeds the three teaching tasks in the owner's empty workspace, once", async () => {
    setDomainReconciledForTest("preferences", ME);
    const api = fakeApi();
    renderWelcome(api, { isOwner: true });
    await flush();
    await flush();
    const create = (api as unknown as { createTask: ReturnType<typeof rs.fn> }).createTask;
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
    const api = fakeApi({ archivedBuckets: [{ id: "old" }], archivedTasks: [task("t0", ME)] });
    renderWelcome(api, { isOwner: true });
    await flush();
    await flush();
    expect(
      (api as unknown as { createTask: ReturnType<typeof rs.fn> }).createTask,
    ).not.toHaveBeenCalled();
  });

  it("stops seeding when the workspace changes mid-way", async () => {
    setDomainReconciledForTest("preferences", ME);
    let release: () => void = () => {};
    const createTask = rs.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve(null);
        }),
    );
    const api = fakeApi({ createTask });
    const view = renderHook(
      ({ ws }) =>
        useTasksWelcome({
          api,
          runtime: null,
          workspaceId: ws,
          isOwner: true,
          onFirstView: () => undefined,
        }),
      { initialProps: { ws: "ws-1" } },
    );
    await flush();
    expect(createTask).toHaveBeenCalledTimes(1);
    view.rerender({ ws: "ws-2" });
    await act(async () => release());
    await flush();
    expect(createTask).toHaveBeenCalledTimes(1);
  });

  it("never seeds a workspace someone else prepared", async () => {
    setDomainReconciledForTest("preferences", ME);
    const api = fakeApi({ tasks: [task("t1", "organiser")], buckets: [{ id: "p1" }] });
    const { result } = renderWelcome(api, { isOwner: false });
    await flush();
    expect(result.current.open).toBe(true);
    expect(
      (api as unknown as { createTask: ReturnType<typeof rs.fn> }).createTask,
    ).not.toHaveBeenCalled();
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
    const { result } = renderWelcome(fakeApi({ buckets: [{ id: "p1" }] }), {
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

  it("Skip records the question as asked, with no role", () => {
    setDomainReconciledForTest("preferences", ME);
    const onFirstView = rs.fn();
    const { result } = renderWelcome(fakeApi(), { onFirstView });
    act(() => result.current.chooseRole(null));
    expect(onFirstView).not.toHaveBeenCalled();
    expect(currentPreferences().tasksOnboarding.role).toBeNull();
    expect(currentPreferences().tasksOnboarding.roleAt).not.toBeNull();
  });

  it("Help → What's in Tasks reopens it at the basics", () => {
    updatePreferences({
      tasksOnboarding: {
        ...DEFAULT_PREFERENCES.tasksOnboarding,
        welcomeSeenAt: "2026-10-13T09:00:00Z",
      },
    });
    setDomainReconciledForTest("preferences", ME);
    const { result } = renderWelcome(fakeApi());
    expect(result.current.open).toBe(false);
    act(() => requestTasksWelcome());
    expect(result.current.open).toBe(true);
    expect(result.current.step).toBe("basics");
  });
});
