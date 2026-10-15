// MOD-142 — making and updating saved views from the page: the Views
// header's + hands out a new blank view, named only when it's saved; while
// one of your views has unsaved changes the toolbar shows a clear Save, its ▾
// holding "Save as new view…" and "Revert changes"; someone else's view saves
// only as a new one.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { TooltipProvider } from "../../../components/ui/tooltip";
import { tasksViewDefaults } from "../display";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { newViewPrefs, type TaskView } from "../views";
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

function renderSavedViews({ openView = null as TaskView | null, drafting = false, dirty = false }) {
  const saved = view({ id: "v-new", name: "Launch week" });
  const api = {
    views: openView ? [openView] : [],
    saveView: rs.fn(async () => saved),
    saveViewChanges: rs.fn(async () => true),
    renameView: rs.fn(),
    shareView: rs.fn(),
    deleteView: rs.fn(),
    moveView: rs.fn(),
    seedViews: rs.fn(async () => true),
    reachedServer: true,
  } as unknown as TasksModuleApi;
  const onOpen = rs.fn();
  const onNewView = rs.fn();
  const revert = rs.fn();
  const prefs = { ...newViewPrefs(), layout: "board" as const };
  function Harness() {
    const views = useSavedViews({
      api,
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
  render(<Harness />);
  return { api, onOpen, onNewView, revert, prefs };
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
  it("the Views header's + opens one", () => {
    const { onNewView } = renderSavedViews({});
    fireEvent.click(screen.getByRole("button", { name: "Views +" }));
    expect(onNewView).toHaveBeenCalledTimes(1);
  });

  it("shows Save view… from the start, and is named when it's saved", async () => {
    const { api, onOpen, revert, prefs } = renderSavedViews({ drafting: true });
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
    expect(api.saveView).toHaveBeenCalledWith({
      name: "Launch week",
      scope: "all",
      projectId: null,
      prefs,
    });
    // The new view opens, and the blank copy is let go.
    expect(revert).toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledWith("view:v-new");
  });

  it("once changed, its ▾ can start it over", async () => {
    const { revert } = renderSavedViews({ drafting: true, dirty: true });
    const menu = await openMore();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Revert changes" }));
    expect(revert).toHaveBeenCalledTimes(1);
  });
});

describe("updating a view you're on (MOD-142)", () => {
  it("shows nothing while it's as saved", () => {
    renderSavedViews({ openView: view() });
    expect(screen.queryByTestId("view-changes")).toBeNull();
  });

  it("your view with changes: a clear Save, then Save as new view… and Revert in its ▾", async () => {
    const mine = view();
    const { api, revert, prefs } = renderSavedViews({ openView: mine, dirty: true });
    const save = within(screen.getByTestId("toolbar")).getByRole("button", { name: "Save" });
    expect(save.className).toContain("bg-state-active");
    await act(async () => {
      fireEvent.click(save);
    });
    expect(api.saveViewChanges).toHaveBeenCalledWith("v1", prefs);
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
    renderSavedViews({ openView: view({ ownerId: "them", shared: true }), dirty: true });
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
