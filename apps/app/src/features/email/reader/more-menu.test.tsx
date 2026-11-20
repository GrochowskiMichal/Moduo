import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { MailExplain, MailThread } from "@/lib/runtime.types.mail-engine";

import { createMailCommands } from "../commands/triage";
import { createMailStore } from "../store/mail-store";
import { message, NOW, oneThreadEngine, row } from "../testing/reader-kit";
import { MailReader } from "./mail-reader";
import { menuOps, type ReaderMoreActions } from "./more-menu";

afterEach(cleanup);

const tick = () => act(async () => await new Promise((r) => setTimeout(r, 0)));
const behavior = { remoteImages: "block", trackerBlocking: true } as const;

const THREAD: MailThread = { row: row(), messages: [message()] };
const EXPLAIN: MailExplain = {
  stage: "known_contact",
  ruleId: null,
  customTabId: null,
  address: "jonas@acme.test",
  tab: "personal",
};

function setup() {
  let seq = 0;
  const applyOp = rs.fn(async () => ({ opIds: [`op${++seq}`] }));
  const undoOp = rs.fn(async () => {});
  const engine = oneThreadEngine(() => THREAD, {
    applyOp,
    undoOp,
    getRawMessage: async () => "raw",
    explainThread: async () => EXPLAIN,
  });
  const store = createMailStore({ engine });
  const undos: { label: string; onUndo: () => void }[] = [];
  let settingSeq = 0;
  const settings = {
    upsert: rs.fn(async () => `set${++settingSeq}`),
    remove: rs.fn(async () => true),
  };
  const ops = menuOps({
    commands: createMailCommands(store),
    settings,
    priorityPeople: () => [],
    showUndo: (label, onUndo) => undos.push({ label, onUndo }),
    onError: (m) => {
      throw new Error(m);
    },
  });
  const more: ReaderMoreActions = {
    remind: rs.fn(),
    unread: rs.fn(),
    move: rs.fn(),
    copyLink: rs.fn(),
    delete: rs.fn(),
    ...ops,
  };
  render(
    <TooltipProvider>
      <MailReader
        engine={engine}
        threadId="t1"
        version={0}
        behavior={behavior}
        now={() => NOW}
        selfAddresses={["robin@me.test"]}
        more={more}
        why={{ names: { rules: [], customTabs: [] } }}
        menuItems={() => <DropdownMenuItem>Labels…</DropdownMenuItem>}
      />
    </TooltipProvider>,
  );
  return { applyOp, undoOp, settings, undos, more };
}

function openMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }), {
    button: 0,
    pointerType: "mouse",
  });
  // "Label · key": the key cap is its own (aria-hidden) shortcut span.
  return screen.getAllByRole("menuitem").map((el) => {
    const key = el.querySelector('[data-slot="dropdown-menu-shortcut"]')?.textContent ?? "";
    const label = (el.textContent ?? "").slice(0, (el.textContent ?? "").length - key.length);
    return key ? `${label.trim()} · ${key}` : label.trim();
  });
}

async function pick(name: string) {
  openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name }));
  await tick();
}

describe("reader ⋯ menu (specs/mail-v3.md §8, AC26)", () => {
  it("items in order; mute, spam, block run ops", async () => {
    const { applyOp, undoOp, settings, undos, more } = setup();
    await tick();
    await tick();

    // specs/mail-improve.md AC14: Pin, Move and Private note join ⋯; Remind is on the toolbar.
    expect(openMenu()).toEqual([
      "Pin · p",
      "Move… · m",
      "Private note · n",
      "Mark unread · u",
      "Labels…",
      "Mute",
      "Why is this in Personal?",
      "Mark Priority",
      "Show original",
      "Copy link",
      "Block Jonas Weber",
      "Report spam",
      "Delete · #",
    ]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await tick();

    // Mute: the op, then an undo toast whose Undo undoes that op.
    await pick("Mute");
    expect(applyOp).toHaveBeenLastCalledWith({ kind: "mute", threadIds: ["t1"] });
    expect(undos.at(-1)?.label).toBe("Muted · new replies skip the inbox");
    await act(async () => undos.at(-1)!.onUndo());
    expect(undoOp).toHaveBeenLastCalledWith("op1");

    // Report spam.
    await pick("Report spam");
    expect(applyOp).toHaveBeenLastCalledWith({ kind: "spam", threadIds: ["t1"] });
    expect(undos.at(-1)?.label).toBe("Reported as spam");
    await act(async () => undos.at(-1)!.onUndo());
    expect(undoOp).toHaveBeenLastCalledWith("op2");

    // Block: saves the sender as blocked and moves the thread; Undo reverses both.
    await pick("Block Jonas Weber");
    expect(settings.upsert).toHaveBeenCalledWith("blocked_sender", { address: "jonas@acme.test" });
    expect(applyOp).toHaveBeenLastCalledWith({ kind: "block_sender", threadIds: ["t1"] });
    expect(undos.at(-1)?.label).toBe("Blocked Jonas Weber");
    await act(async () => undos.at(-1)!.onUndo());
    expect(undoOp).toHaveBeenLastCalledWith("op3");
    expect(settings.remove).toHaveBeenCalledWith("set1");

    // The rest call the page's actions.
    await pick("Move…");
    expect(more.move).toHaveBeenCalledWith("t1");
    await pick("Copy link");
    expect(more.copyLink).toHaveBeenCalledWith("t1");
    await pick("Delete");
    expect(more.delete).toHaveBeenCalledWith("t1");
    await pick("Mark Priority");
    expect(settings.upsert).toHaveBeenLastCalledWith("priority_person", {
      address: "jonas@acme.test",
    });
    expect(undos.at(-1)?.label).toBe("Jonas Weber is a Priority person");
  });

  it("opens Why here from the menu, and hides it without explainThread", async () => {
    setup();
    await tick();
    await tick();
    await pick("Why is this in Personal?");
    screen.getByRole("heading", { name: "Why this is in Personal" });
    screen.getByText("Jonas is in your contacts.");
    cleanup();

    const engine = oneThreadEngine(() => THREAD);
    render(
      <TooltipProvider>
        <MailReader
          engine={engine}
          threadId="t1"
          version={0}
          behavior={behavior}
          more={{
            unread: rs.fn(),
            move: rs.fn(),
            mute: rs.fn(),
            copyLink: rs.fn(),
            block: rs.fn(),
            spam: rs.fn(),
            delete: rs.fn(),
          }}
          why={{ names: { rules: [], customTabs: [] } }}
        />
      </TooltipProvider>,
    );
    await tick();
    const items = openMenu();
    expect(items.some((t) => t?.startsWith("Why is this"))).toBe(false);
    expect(items).toContain("Mark unread · u");
  });
});
