// AC20: two or more picked threads turn the reader into the bulk summary with
// five actions, and Make tasks makes one task per thread under one undo.
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { HotkeyScope } from "@/lib/hotkeys/scope";
import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

import { convertEach } from "../commands/convert-many";
import { createMailSpineCommands, type MailSpinePort } from "../commands/spine";
import type { MailKeyId } from "../keys";
import { createMailStore } from "../store/mail-store";
import { createFakeMailEngine } from "../testing/fake-engine";
import { FIXTURE_NOW_MS, generateFixture } from "../testing/fixture";
import { MailShell } from "./mail-shell";

afterEach(cleanup);

const tick = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

function press(key: string, extra: KeyboardEventInit = {}) {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key,
        bubbles: true,
        cancelable: true,
        ...extra,
      }),
    );
  });
}

async function mount(onIntent: (id: MailKeyId, threadIds: string[]) => void) {
  const engine = createFakeMailEngine({
    fixture: generateFixture({ messages: 300 }),
    now: () => FIXTURE_NOW_MS,
  });
  const store = createMailStore({ engine, accounts: await engine.listAccounts() });
  const ui = render(
    <TooltipProvider>
      <HotkeyScope scope="email">
        <MailShell
          store={store}
          now={() => FIXTURE_NOW_MS}
          onIntent={onIntent}
          renderReader={() => <p>One conversation</p>}
        />
      </HotkeyScope>
    </TooltipProvider>,
  );
  await tick();
  await tick();
  return { ui, engine, store };
}

/** A spine port that only counts tasks (the gestures it needs for `t`). */
function taskPort() {
  let n = 0;
  const tasks = new Set<string>();
  const port: MailSpinePort = {
    upsertRef: async (t) => ({ id: `ref-${t.threadId}`, created: false }),
    removeRef: async () => {},
    createTask: async () => {
      const id = `task${++n}`;
      tasks.add(id);
      return { id };
    },
    deleteTask: async (id) => {
      tasks.delete(id);
    },
    createNote: async () => ({ id: "note" }),
    deleteNote: async () => {},
    createEvent: async () => ({ id: "ev" }),
    deleteEvent: async () => {},
    createLink: async () => null,
    deleteLink: async () => {},
    isLinked: async () => false,
    resolveContactId: () => null,
  } as MailSpinePort;
  return { port, tasks };
}

describe("bulk reader (AC20)", () => {
  it("n selected with five actions; t makes n tasks", async () => {
    const onIntent = rs.fn<(id: MailKeyId, threadIds: string[]) => void>();
    await mount(onIntent);
    screen.getByText("One conversation");

    // Pick three threads: x, then ⇧J twice.
    press("j");
    press("x");
    press("J", { shiftKey: true, code: "KeyJ" });
    press("J", { shiftKey: true, code: "KeyJ" });
    const reader = screen.getByRole("region", { name: "3 selected" });
    within(reader).getByRole("heading", { name: "3 selected" });
    within(reader).getByText(/Every action below applies to all 3, as one step that/);
    expect(within(reader).getAllByRole("listitem")).toHaveLength(3);
    const buttons = within(reader)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(buttons).toEqual(["Donee", "Snooze…s", "Make taskst", "Move…m", "Delete#"]);
    within(reader).getByText(/clears the selection\./);
    expect(screen.queryByText("One conversation")).toBeNull();

    // `t` and the button both hand every picked thread to the page.
    press("t");
    expect(onIntent).toHaveBeenLastCalledWith("email.convert", expect.any(Array));
    const picked = onIntent.mock.calls.at(-1)![1];
    expect(picked).toHaveLength(3);
    fireEvent.click(within(reader).getByRole("button", { name: /^Make tasks/ }));
    expect(onIntent).toHaveBeenLastCalledWith("email.convert", picked);

    // Make tasks: one task per thread, and one undo removes them all.
    const { port, tasks } = taskPort();
    const rows = picked.map((id) => ({ threadId: id, subject: id, snippet: "", senders: [] }));
    const res = await convertEach(
      createMailSpineCommands(port),
      rows as unknown as MailThreadRow[],
    );
    expect(res.count).toBe(3);
    expect(tasks.size).toBe(3);
    await res.undo();
    expect(tasks.size).toBe(0);

    // Esc clears the selection; the reader comes back.
    press("Escape", { code: "Escape" });
    screen.getByText("One conversation");
  });

  it("Done on the bulk reader is one op over every picked thread", async () => {
    const { engine } = await mount(() => {});
    const apply = rs.spyOn(engine, "applyOp");
    press("j");
    press("x");
    press("J", { shiftKey: true, code: "KeyJ" });
    const reader = screen.getByRole("region", { name: "2 selected" });
    fireEvent.click(within(reader).getByRole("button", { name: /^Done/ }));
    await tick();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![0]).toMatchObject({ kind: "done" });
    expect(apply.mock.calls[0]![0].threadIds).toHaveLength(2);
  });

  it("a failed convert leaves no task behind", async () => {
    const { port, tasks } = taskPort();
    let calls = 0;
    const spine = createMailSpineCommands({
      ...port,
      createTask: async (input) => {
        if (++calls === 3) throw new Error("tasks down");
        return port.createTask(input);
      },
    });
    const rows = ["a", "b", "c"].map((id) => ({
      threadId: id,
      subject: id,
      snippet: "",
      senders: [],
    })) as unknown as MailThreadRow[];
    await expect(convertEach(spine, rows)).rejects.toThrow("tasks down");
    expect(tasks.size).toBe(0);
  });
});
