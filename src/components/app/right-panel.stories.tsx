// The right panel's title row (tasks-v3 calls 72/72a, 89; SH-1): "Detail ▾"
// switches the module's registered views, *about this* above the hairline and
// *alongside* below, each with its ⌥ shortcut; one view is a plain title; a
// reference opened in the panel shows as "← item" and stacks. Shown at the
// 280 px floor and at the 320 px default rail width.
import type { Meta, StoryObj } from "@storybook/react";
import { CheckSquare, Mail } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { type PanelItem, RightPanel, usePanelStack } from "./right-panel";

function Frame({ width, children }: { width: "floor" | "rail"; children: React.ReactNode }) {
  return (
    <div className="flex gap-6 p-6">
      <aside
        className={
          width === "floor"
            ? "h-96 w-70 rounded-xl border border-border bg-card p-2"
            : "h-96 w-80 rounded-xl border border-border bg-card p-2"
        }
      >
        {children}
      </aside>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return <p className="px-1 text-sm text-muted-foreground">{text}</p>;
}

function CalendarPanel({ width }: { width: "floor" | "rail" }) {
  const [active, setActive] = useState("tasks");
  return (
    <Frame width={width}>
      <RightPanel
        module="calendar"
        activeId={active}
        onChange={setActive}
        views={{
          tasks: () => <Placeholder text="This week's tasks, alongside the calendar." />,
          detail: () => <Placeholder text="The selected event or task." />,
          notes: () => <Placeholder text="Notes linked to the selection." />,
        }}
      />
    </Frame>
  );
}

type Entry = { key: string; kind: "task" | "email"; title: string };

function StackPanel({ width }: { width: "floor" | "rail" }) {
  const [active, setActive] = useState("detail");
  const { stack, push, back, clear } = usePanelStack<Entry>();
  const items: PanelItem[] = stack.map((entry) => ({
    key: entry.key,
    title: entry.title,
    icon: entry.kind === "task" ? CheckSquare : Mail,
    open: { label: entry.kind === "task" ? "Open in Tasks" : "Open in Email", onOpen: () => {} },
    render: () => (
      <div className="flex flex-col gap-2 px-1">
        <Placeholder text={`The ${entry.kind} opened from a reference.`} />
        {entry.kind === "task" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => push({ key: "email:7", kind: "email", title: "Re: Round 1 feedback" })}
          >
            Open its linked email
          </Button>
        ) : null}
      </div>
    ),
  }));
  return (
    <Frame width={width}>
      <RightPanel
        module="email"
        activeId={active}
        onChange={setActive}
        items={items}
        onBack={back}
        onClearItems={clear}
        views={{
          reader: () => <Placeholder text="The open thread." />,
          contact: () => <Placeholder text="The sender." />,
          detail: () => (
            <div className="flex flex-col gap-2 px-1">
              <Placeholder text="Linked to this thread:" />
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  push({
                    key: "task:1",
                    kind: "task",
                    title: "Collect assets for the October newsletter banner",
                  })
                }
              >
                Open "Collect assets…"
              </Button>
            </div>
          ),
          task: () => <Placeholder text="The task made from this email." />,
        }}
      />
    </Frame>
  );
}

const meta: Meta = {
  title: "App/RightPanel",
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** Calendar's three views: Detail and Notes about the selection, Tasks alongside. */
export const ViewMenu: Story = { render: () => <CalendarPanel width="rail" /> };

/** The same at the 280 px floor (call 89). */
export const ViewMenuAtFloor: Story = { render: () => <CalendarPanel width="floor" /> };

/** One registered view: the title row names it, with no menu (Tasks today). */
export const SingleView: Story = {
  render: () => (
    <Frame width="rail">
      <RightPanel
        module="tasks"
        activeId="details"
        onChange={() => {}}
        views={{ details: () => <Placeholder text="The selected task." /> }}
      />
    </Frame>
  ),
};

/** Open a reference, then another from inside it: "← item" stacks, back pops one. */
export const ItemStack: Story = { render: () => <StackPanel width="rail" /> };

/** A long item name wraps instead of truncating, at the floor. */
export const ItemStackAtFloor: Story = { render: () => <StackPanel width="floor" /> };
