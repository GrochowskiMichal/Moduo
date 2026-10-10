// RF-1 · References (tasks-v3 §11, AC10.6): the four forms and privacy. A
// task reference renders as a link, a chip, a card and a hover preview with
// the right facts; a reader who can't open the item gets "Private item", with
// no title anywhere in the DOM or in the notification text; a deleted item
// reads "Deleted task"; answers are lazy, batched, cached and live.
//
// Plain `createElement` (this file is `.ts`, the name the spec's test map uses).

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

import { groupNotifications, type NotificationItem, notificationSummary } from "./notifications";
import { ReferenceHostProvider, ReferenceStoreProvider } from "./references/context";
import { PRIVATE_ITEM_LABEL } from "./references/kinds";
import { type ResolveContext, taskFacts } from "./references/resolvers";
import type { ReferencePreviewApi, TaskPreviewRow } from "./references/rows";
import { ReferenceStore } from "./references/store";
import { plainReferenceName, referenceTextToPlain, referenceUri } from "./references/text";
import type { ReferenceDisplay, ReferenceRef } from "./references/types";
import { Reference } from "./references/ui/reference";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(cleanup);

const NOW = new Date(2026, 9, 14, 10, 0, 0); // Wed Oct 14 2026
const TASK_ID = "11111111-1111-4111-8111-111111111111";
const PRIVATE_ID = "22222222-2222-4222-8222-222222222222";
const DELETED_ID = "33333333-3333-4333-8333-333333333333";
const SECRET_TITLE = "Acquire Northwind quietly";

/** A task row as the server would send it (Fri Oct 16 due, in Acme rebrand). */
function taskRow(over: Partial<TaskPreviewRow> = {}): TaskPreviewRow {
  return {
    id: TASK_ID,
    title: "Collect assets",
    status: "todo",
    dueDate: new Date(2026, 9, 16, 12).toISOString(),
    bucketId: "b1",
    assigneeId: "u2",
    number: 142,
    deletedAt: null,
    ...over,
  };
}

/** Fake previews: only rows the reader may see come back (the RLS contract). */
function fakePreviews(rows: Record<string, TaskPreviewRow>) {
  const tasks = rs.fn(async ({ ids, card }: { ids: string[]; card: boolean }) =>
    ids
      .filter((id) => rows[id])
      .map((id) => {
        const row = rows[id] as TaskPreviewRow;
        return card
          ? {
              ...row,
              projectName: "Acme rebrand",
              projectIsInbox: false,
              subtasks: { done: 2, total: 5 },
            }
          : row;
      }),
  );
  const none = rs.fn(async () => []);
  const previews = {
    tasks,
    projects: none,
    notes: none,
    events: none,
    contacts: none,
    emails: none,
    tags: none,
    searchProjects: none,
    searchTags: none,
    resolveHandle: rs.fn(async () => null),
  } as unknown as ReferencePreviewApi;
  return { previews, tasks };
}

function makeStore(rows: Record<string, TaskPreviewRow>) {
  const { previews, tasks } = fakePreviews(rows);
  const context: ResolveContext = {
    workspaceId: "w1",
    previews,
    taskKey: "MOD",
    personOf: (id) => (id === "u2" ? { name: "Sam Okafor", id: "u2", avatarUrl: null } : null),
    now: () => NOW,
  };
  const store = new ReferenceStore({
    context: () => context,
    schedule: (fn) => queueMicrotask(fn),
  });
  return { store, tasks };
}

function withStore(
  store: ReferenceStore,
  node: ReactNode,
  host?: Parameters<typeof ReferenceHostProvider>[0]["host"],
) {
  const inner = host ? createElement(ReferenceHostProvider, { host }, node) : node;
  return render(createElement(ReferenceStoreProvider, { store }, inner));
}

function reference(id: string, display: ReferenceDisplay) {
  return createElement(Reference, { type: "task", id, display });
}

describe("a task reference in its four forms", () => {
  it("a chip shows the status icon, the title and one live fact (the due day)", async () => {
    const { store } = makeStore({ [TASK_ID]: taskRow() });
    withStore(store, reference(TASK_ID, "chip"));
    const chip = await screen.findByRole("button", { name: "Task: Collect assets, Fri" });
    expect(chip.textContent).toContain("Collect assets");
    expect(chip.textContent).toContain("Fri");
    expect(screen.getByRole("img", { name: "To do" })).toBeTruthy();
  });

  it("a link is the icon and the title, underlined, with no fact", async () => {
    const { store } = makeStore({ [TASK_ID]: taskRow() });
    withStore(store, reference(TASK_ID, "link"));
    const link = await screen.findByRole("button", { name: /Task: Collect assets/ });
    expect(link.querySelector(".underline")?.textContent).toBe("Collect assets");
    expect(link.textContent).not.toContain("Fri");
  });

  it("a card has the key facts and one action (Complete)", async () => {
    const { store } = makeStore({ [TASK_ID]: taskRow() });
    const setTaskDone = rs.fn();
    withStore(store, reference(TASK_ID, "card"), { setTaskDone, canEditTasks: true });
    const card = await screen.findByText("Collect assets");
    const root = card.closest("[data-slot='reference-card']") as HTMLElement;
    await waitFor(() => expect(root.textContent).toContain("MOD-142"));
    expect(root.textContent).toContain("Acme rebrand");
    expect(root.textContent).toContain("Fri");
    expect(root.textContent).toContain("2/5");
    fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(setTaskDone).toHaveBeenCalledWith(TASK_ID, true);
  });

  it("the hover preview is the card, read only when it opens (lazy)", async () => {
    const { store, tasks } = makeStore({ [TASK_ID]: taskRow() });
    withStore(store, reference(TASK_ID, "chip"));
    const chip = await screen.findByRole("button", { name: /Task: Collect assets/ });
    expect(tasks).toHaveBeenCalledTimes(1);
    expect(tasks.mock.calls[0]?.[0]).toMatchObject({ card: false });
    act(() => {
      fireEvent.focus(chip);
    });
    await waitFor(() => expect(screen.getByText("MOD-142")).toBeTruthy(), { timeout: 2000 });
    expect(tasks.mock.calls.some((c) => c[0]?.card === true)).toBe(true);
  });

  it("a click opens it in the page's panel; ⌘-click opens it full", async () => {
    const { store } = makeStore({ [TASK_ID]: taskRow() });
    const openInPanel = rs.fn();
    const full = rs.fn();
    window.addEventListener("moduo:entity:open", full as EventListener);
    withStore(store, reference(TASK_ID, "chip"), { openInPanel });
    const chip = await screen.findByRole("button", { name: /Task: Collect assets/ });
    fireEvent.click(chip);
    expect(openInPanel).toHaveBeenCalledWith({ type: "task", id: TASK_ID });
    fireEvent.click(chip, { metaKey: true });
    expect(full).toHaveBeenCalledTimes(1);
    const event = full.mock.calls[0]?.[0] as CustomEvent | undefined;
    expect(event?.detail).toEqual({ type: "task", id: TASK_ID });
    window.removeEventListener("moduo:entity:open", full as EventListener);
  });
});

describe("privacy: an item the reader can't open", () => {
  it("reads 'Private item' in every form, with no title, type or click in the DOM", async () => {
    const { store } = makeStore({}); // the server sends nothing back: RLS hid it
    const { container } = withStore(
      store,
      createElement(
        "div",
        null,
        reference(PRIVATE_ID, "link"),
        reference(PRIVATE_ID, "chip"),
        reference(PRIVATE_ID, "card"),
      ),
    );
    await waitFor(() => expect(screen.getAllByText(PRIVATE_ITEM_LABEL)).toHaveLength(3));
    expect(container.innerHTML).not.toContain(SECRET_TITLE);
    expect(container.textContent).not.toMatch(/task/i);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("keeps a stored chip's old title out of the DOM once a store answers", async () => {
    const { store } = makeStore({});
    const { container } = withStore(
      store,
      createElement(Reference, {
        type: "task",
        id: PRIVATE_ID,
        display: "chip",
        fallbackLabel: SECRET_TITLE,
      }),
    );
    // Before the answer: a blank, never the stored title.
    expect(container.innerHTML).not.toContain(SECRET_TITLE);
    await screen.findByText(PRIVATE_ITEM_LABEL);
    expect(container.innerHTML).not.toContain(SECRET_TITLE);
  });

  it("never puts the title into the notification text", async () => {
    const { store } = makeStore({});
    const ref: ReferenceRef = { type: "task", id: PRIVATE_ID };
    const release = store.want(ref);
    await waitFor(() => expect(store.read(ref).status).toBe("private"));
    const item: NotificationItem = {
      id: "n1",
      source: "spine",
      workspaceId: "w1",
      targetType: "task",
      targetId: TASK_ID,
      op: "comments.add",
      payload: { excerpt: `Can you look at ${referenceUri(ref)} today?` },
      createdAt: "2026-10-14T09:00:00Z",
      readAt: null,
      dismissedAt: null,
      actorId: "u2",
      actorLabel: "Sam Okafor",
      actorType: "user",
    };
    const [group] = groupNotifications([item]);
    const text = notificationSummary(group, "u1", "Collect assets", (r) =>
      plainReferenceName(r, store.read(r)),
    );
    expect(text).toContain("Can you look at Private item today?");
    expect(text).not.toContain(SECRET_TITLE);
    expect(text).not.toContain(PRIVATE_ID);
    release();
  });

  it("the resolver answer for a hidden id carries no title at all", async () => {
    const { store } = makeStore({});
    const ref = { type: "task", id: PRIVATE_ID };
    store.want(ref);
    await waitFor(() => expect(store.read(ref)).toEqual({ status: "private" }));
  });
});

describe("deleted, live, batched", () => {
  it("a deleted task reads 'Deleted task', never struck through and with no title", async () => {
    const { store } = makeStore({
      [DELETED_ID]: taskRow({
        id: DELETED_ID,
        title: SECRET_TITLE,
        deletedAt: "2026-10-13T00:00:00Z",
      }),
    });
    const { container } = withStore(store, reference(DELETED_ID, "chip"));
    await screen.findByText("Deleted task");
    expect(container.innerHTML).not.toContain(SECRET_TITLE);
    expect(container.innerHTML).not.toContain("line-through");
  });

  it("references asked for in one tick go out as one read", async () => {
    const other = "44444444-4444-4444-8444-444444444444";
    const { store, tasks } = makeStore({
      [TASK_ID]: taskRow(),
      [other]: taskRow({ id: other, title: "Brand guidelines PDF" }),
    });
    withStore(
      store,
      createElement("div", null, reference(TASK_ID, "chip"), reference(other, "chip")),
    );
    await screen.findByRole("button", { name: /Brand guidelines PDF/ });
    expect(tasks).toHaveBeenCalledTimes(1);
    expect(tasks.mock.calls[0]?.[0]?.ids.sort()).toEqual([TASK_ID, other].sort());
  });

  it("updates in place when the task changes (Realtime → the store)", async () => {
    const rows = { [TASK_ID]: taskRow() };
    const { store } = makeStore(rows);
    withStore(store, reference(TASK_ID, "chip"));
    await screen.findByRole("button", { name: /Collect assets/ });
    rows[TASK_ID] = taskRow({ title: "Collect brand assets", status: "done" });
    act(() => store.applyLive({ table: "tasks", id: TASK_ID }));
    await screen.findByRole("button", { name: /Collect brand assets/ });
    expect(screen.getByRole("img", { name: "Done" })).toBeTruthy();
  });
});

describe("the facts behind the forms", () => {
  const ctx = {
    taskKey: "MOD",
    personOf: () => ({ name: "Sam Okafor", id: "u2", avatarUrl: null }),
    now: () => NOW,
  };

  it("a late task's due day is the quiet late tone; a finished one shows no date", () => {
    const late = taskFacts(taskRow({ dueDate: new Date(2026, 9, 12).toISOString() }), ctx, "chip");
    expect(late.factTone).toBe("late");
    const done = taskFacts(taskRow({ status: "done" }), ctx, "chip");
    expect(done.fact).toBeNull();
    expect(done.lead).toEqual({ kind: "status", category: "done" });
  });

  it("a task in a project the reader can't see says 'Private project', never 'Inbox'", () => {
    const facts = taskFacts(taskRow({ projectName: null }), ctx, "card");
    expect(facts.card?.meta.map((m) => m.text)).toContain("Private project");
  });

  it("an excerpt cut mid-reference ends in an ellipsis, never half a URI", () => {
    const cut = `See ${referenceUri({ type: "task", id: TASK_ID }).slice(0, 20)}`;
    expect(referenceTextToPlain(cut, () => "x")).toBe("See …");
  });
});
