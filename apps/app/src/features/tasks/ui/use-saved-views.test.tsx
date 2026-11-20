// MOD-142 — making and updating saved views from the page: the Views
// header's + hands out a new blank view, named only when it's saved; while
// one of your views has unsaved changes the toolbar shows a clear Save, its ▾
// holding "Save as new view…" and "Revert changes"; someone else's view saves
// only as a new one.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";

import { TooltipProvider } from "../../../components/ui/tooltip";
import { tasksViewDefaults } from "../display";
import { renderWithTasks } from "../testing/render-with-tasks";
import { newViewPrefs, type TaskView, viewPayload } from "../views";
import { useSavedViews } from "./use-saved-views";

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
afterEach(cleanup);

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 60)));

function view(over: Partial<TaskView> = {}): TaskView {
  return {
    id: "v1",
    workspaceId: "w1",
    ownerId: "me",
    name: "Waiting",
    scope: "all",
    projectId: null,
    filters: [],
    display: {},
    shared: false,
    position: 0,
    seed: null,
    createdAt: "2026-10-15T09:00:00.000Z",
    updatedAt: "2026-10-15T09:00:00.000Z",
    deletedAt: null,
    ...over,
  };
}

/**
 * The hook on the page's real saved views (the provider's ops), over a fake
 * server: `createView` and `updateView` are what Save and Save as new reach.
 */
async function renderSavedViews({
  openView = null as TaskView | null,
  drafting = false,
  dirty = false,
}) {
  const saved = view({ id: "v-new", name: "Launch week" });
  const server = {
    createView: rs.fn(async () => saved),
    updateView: rs.fn(async ({ viewId }: { viewId: string }) => ({
      ...(openView ?? saved),
      id: viewId,
    })),
  };
  const onOpen = rs.fn();
  const onNewView = rs.fn();
  const revert = rs.fn();
  const prefs = { ...newViewPrefs(), layout: "board" as const };
  function Harness() {
    const views = useSavedViews({
      workspaceId: "w1",
      userId: "me",
      place: "all",
      openView,
      drafting,
      onNewView,
      prefs,
      dirty,
      revert,
      placeTitle: "All",
      projectIds: [],
      onOpen,
      urlViewId: null,
      onUrlViewConsumed: () => {},
      canShare: true,
      canModerate: false,
    });
    return (
      <TooltipProvider>
        <div data-testid="toolbar">{views.viewSave}</div>
        <output data-testid="save-as">{views.saveAsMenu?.label ?? ""}</output>
        <button type="button" onClick={() => views.viewActions.onNew?.()}>
          Views +
        </button>
        {views.dialog}
      </TooltipProvider>
    );
  }
  await renderWithTasks(<Harness />, {
    seed: { views: openView ? [openView] : [] },
    runtime: { tasks: server },
    userId: "me",
  });
  return { server, onOpen, onNewView, revert, prefs };
}

async function openMore() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "More ways to save" }), {
    button: 0,
    pointerType: "mouse",
  });
  await settle();
  return screen.getByRole("menu");
}

describe("a new view (MOD-142)", () => {
  it("the Views header's + opens one", async () => {
    const { onNewView } = await renderSavedViews({});
    fireEvent.click(screen.getByRole("button", { name: "Views +" }));
    expect(onNewView).toHaveBeenCalledTimes(1);
  });

  it("shows Save view… from the start, and is named when it's saved", async () => {
    const { server, onOpen, revert, prefs } = await renderSavedViews({ drafting: true });
    // It saves from its own button, not the ⋯.
    expect(screen.getByTestId("save-as").textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Save view…" }));
    const dialog = screen.getByRole("dialog", { name: "Name this view" });
    const field = within(dialog).getByRole("textbox", { name: "View name" }) as HTMLInputElement;
    expect(field.value).toBe("");
    expect(within(dialog).getByRole("button", { name: "Save view" }).hasAttribute("disabled")).toBe(
      true,
    );
    fireEvent.change(field, { target: { value: "Launch week" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save view" }));
    });
    expect(server.createView).toHaveBeenCalledWith({
      workspaceId: "w1",
      id: expect.any(String),
      name: "Launch week",
      scope: "all",
      projectId: null,
      ...viewPayload(prefs),
    });
    // The new view opens, and the blank copy is let go.
    expect(revert).toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledWith("view:v-new");
  });

  it("once changed, its ▾ can start it over", async () => {
    const { revert } = await renderSavedViews({ drafting: true, dirty: true });
    const menu = await openMore();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Revert changes" }));
    // It runs once the menu has closed (a ▾ item may open a dialog).
    await settle();
    expect(revert).toHaveBeenCalledTimes(1);
  });
});

describe("updating a view you're on (MOD-142)", () => {
  it("shows nothing while it's as saved", async () => {
    await renderSavedViews({ openView: view() });
    expect(screen.queryByTestId("view-changes")).toBeNull();
  });

  it("your view with changes: a clear Save, then Save as new view… and Revert in its ▾", async () => {
    const mine = view();
    const { server, revert, prefs } = await renderSavedViews({ openView: mine, dirty: true });
    const save = within(screen.getByTestId("toolbar")).getByRole("button", { name: "Save" });
    expect(save.className).toContain("bg-state-active");
    await act(async () => {
      fireEvent.click(save);
    });
    expect(server.updateView).toHaveBeenCalledWith({
      workspaceId: "w1",
      viewId: "v1",
      patch: viewPayload(prefs),
    });
    expect(revert).toHaveBeenCalled();

    const menu = await openMore();
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Save as new view…", "Revert changes"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Save as new view…" }));
    await settle();
    expect(screen.getByRole("dialog", { name: "Save as a new view" })).toBeTruthy();
  });

  it("someone else's view saves only as a new one", async () => {
    await renderSavedViews({ openView: view({ ownerId: "them", shared: true }), dirty: true });
    const toolbar = screen.getByTestId("toolbar");
    expect(within(toolbar).queryByRole("button", { name: "Save" })).toBeNull();
    expect(within(toolbar).getByRole("button", { name: "Save as new view…" })).toBeTruthy();
    const menu = await openMore();
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Revert changes"]);
  });

  it("a new view's blank start is All's defaults, never All's own Filter", () => {
    expect(newViewPrefs().filters).toEqual([]);
    expect(newViewPrefs().group).toBe(tasksViewDefaults("all").group);
  });
});
