import { afterEach, describe, expect, it } from "@rstest/core";

import { isRowControl, listKeyAction, listKeyActionFor, ROW_TITLE_ATTR } from "./list-keys";

type Mods = { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean };
const press = (key: string, mods: Mods = {}) => ({
  key,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
});

describe("listKeyAction (tasks-v2 Q1-1)", () => {
  it("ignores modified keys: the palette, capture bar, module jumps and clipboard reach the app or the OS", () => {
    // ⌘K / Ctrl K (palette), ⌘⇧K (capture bar), ⌘N, ⌘, …
    expect(listKeyAction(press("k", { meta: true }))).toBeNull();
    expect(listKeyAction(press("k", { ctrl: true }))).toBeNull();
    expect(listKeyAction(press("K", { meta: true, shift: true }))).toBeNull();
    expect(listKeyAction(press("n", { meta: true }))).toBeNull();
    // ⌘C / ⌘V / ⌘X stay native — ⌘C used to open capture, ⌘X to complete.
    for (const key of ["c", "v", "x"]) {
      expect(listKeyAction(press(key, { meta: true }))).toBeNull();
      expect(listKeyAction(press(key, { ctrl: true }))).toBeNull();
    }
    // ⌘1–⌘7 jump between modules.
    for (const key of ["1", "2", "3", "4", "5", "6", "7"]) {
      expect(listKeyAction(press(key, { meta: true }))).toBeNull();
    }
    // Every list letter, arrow, Space and Enter, under every modifier.
    const listKeys = ["j", "k", "x", "e", "c", "b", "s", "d", "q", "ArrowDown", "ArrowUp"];
    for (const key of [...listKeys, "ArrowLeft", "ArrowRight", " ", "Enter"]) {
      for (const mods of [{ meta: true }, { ctrl: true }, { alt: true }] as Mods[]) {
        expect(listKeyAction(press(key, mods))).toBeNull();
      }
    }
  });

  it("keeps ⌘⌫, the one modified key the List binds", () => {
    expect(listKeyAction(press("Backspace", { meta: true }))).toBe("delete");
    expect(listKeyAction(press("Backspace", { ctrl: true }))).toBe("delete");
    expect(listKeyAction(press("Delete", { meta: true }))).toBe("delete");
    expect(listKeyAction(press("Backspace", { meta: true, alt: true }))).toBeNull();
    // A bare ⌫ isn't bound.
    expect(listKeyAction(press("Backspace"))).toBeNull();
  });

  it("maps the plain keys", () => {
    expect(listKeyAction(press("j"))).toBe("next");
    expect(listKeyAction(press("ArrowDown"))).toBe("next");
    expect(listKeyAction(press("k"))).toBe("prev");
    expect(listKeyAction(press("ArrowUp"))).toBe("prev");
    expect(listKeyAction(press("x"))).toBe("toggle-done");
    expect(listKeyAction(press(" "))).toBe("toggle-done");
    expect(listKeyAction(press("e"))).toBe("edit");
    expect(listKeyAction(press("Enter"))).toBe("edit");
    expect(listKeyAction(press("c"))).toBe("capture");
    expect(listKeyAction(press("b"))).toBe("bucket");
    expect(listKeyAction(press("s"))).toBe("schedule");
    expect(listKeyAction(press("d"))).toBe("due");
    expect(listKeyAction(press("q"))).toBe("queue");
    expect(listKeyAction(press("ArrowRight"))).toBe("expand");
    expect(listKeyAction(press("ArrowLeft"))).toBe("collapse");
    expect(listKeyAction(press("z"))).toBeNull();
    expect(listKeyAction(press("?", { shift: true }))).toBeNull();
  });
});

describe("a row's own controls (tasks-v2 Q1-2)", () => {
  it("leave Space/Enter to the focused button", () => {
    expect(listKeyAction(press(" "), { onControl: true })).toBeNull();
    expect(listKeyAction(press("Enter"), { onControl: true })).toBeNull();
  });

  it("still let the List's letters and ⌘⌫ through", () => {
    expect(listKeyAction(press("x"), { onControl: true })).toBe("toggle-done");
    expect(listKeyAction(press("j"), { onControl: true })).toBe("next");
    expect(listKeyAction(press("Backspace", { meta: true }), { onControl: true })).toBe("delete");
  });

  afterEach(() => document.body.replaceChildren());

  // A list with two rows (A selected) and a popover portaled out to <body>.
  function listDom() {
    const list = document.createElement("div");
    const row = (selected: boolean) => {
      const el = document.createElement("div");
      el.setAttribute("role", "row");
      el.setAttribute("aria-selected", String(selected));
      const title = document.createElement("button");
      title.setAttribute(ROW_TITLE_ATTR, "");
      const toggle = document.createElement("button");
      el.append(title, toggle);
      list.append(el);
      return { title, toggle };
    };
    const a = row(true);
    const b = row(false);
    const popoverInput = document.createElement("input");
    document.body.append(list, popoverInput);
    return { list, a, b, popoverInput };
  }

  it("are any element inside the list except the list itself and the selected row's title", () => {
    const { list, a, b } = listDom();
    expect(isRowControl(a.toggle, list)).toBe(true);
    expect(isRowControl(list, list)).toBe(false);
    expect(isRowControl(a.title, list)).toBe(false);
    // Another row's title, reached with Tab, keeps its own Space/Enter (selects its row).
    expect(isRowControl(b.title, list)).toBe(true);
    expect(isRowControl(null, list)).toBe(false);
  });

  it("listKeyActionFor: wires the portal, control and title rules together", () => {
    const { list, a, b, popoverInput } = listDom();
    const on = (target: EventTarget, key: string, mods: Mods = {}) =>
      listKeyActionFor({ ...press(key, mods), target }, list);

    expect(on(list, " ")).toBe("toggle-done");
    expect(on(list, "Enter")).toBe("edit");
    expect(on(list, "k", { meta: true })).toBeNull();
    // A row's toggle keeps Space/Enter; letters still drive the list.
    expect(on(a.toggle, " ")).toBeNull();
    expect(on(a.toggle, "Enter")).toBeNull();
    expect(on(a.toggle, "x")).toBe("toggle-done");
    // The selected row's title speaks for the row; another row's doesn't.
    expect(on(a.title, " ")).toBe("toggle-done");
    expect(on(a.title, "Enter")).toBe("edit");
    expect(on(b.title, " ")).toBeNull();
    // Keys typed in a portaled popover (React bubbles them to the list) are ignored —
    // Space, arrows and ⌘⌫ in its date field used to complete/move/delete the task.
    expect(on(popoverInput, " ")).toBeNull();
    expect(on(popoverInput, "ArrowDown")).toBeNull();
    expect(on(popoverInput, "Backspace", { meta: true })).toBeNull();
    expect(on(popoverInput, "x")).toBeNull();
  });
});
