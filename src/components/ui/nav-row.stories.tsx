import type { Meta, StoryObj } from "@storybook/react";
import { Hash, Inbox, Layers, ListChecks } from "lucide-react";
import { useState } from "react";

import type { LabelColor } from "../tag-colors";
import { AtThreeDensities } from "./kit-densities";
import { type MenuKit, NavRow, NavRowDot, NavSectionHeader } from "./nav-row";

const meta: Meta<typeof NavRow> = {
  title: "Components/ui/nav-row",
  component: NavRow,
  decorators: [
    (Story) => (
      <div className="w-60 rounded-lg border border-hairline bg-card p-2">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

const rowMenu = (m: MenuKit) => (
  <>
    <m.Item onSelect={m.rename}>Rename</m.Item>
    <m.Item>Share</m.Item>
    <m.Sub>
      <m.SubTrigger>Open at</m.SubTrigger>
      <m.SubContent>
        <m.RadioGroup value="none">
          <m.RadioItem value="none">No default</m.RadioItem>
          <m.RadioItem value="morning">Morning</m.RadioItem>
        </m.RadioGroup>
      </m.SubContent>
    </m.Sub>
    <m.Separator />
    <m.Item variant="destructive">Delete bucket…</m.Item>
  </>
);

const BUCKETS: { id: string; name: string; count: number; color?: LabelColor }[] = [
  { id: "app", name: "Moduo App", count: 64, color: "blue" },
  { id: "op", name: "OP", count: 5, color: "violet" },
  { id: "mkt", name: "Marketing", count: 1, color: "amber" },
  { id: "landing", name: "Moduo Landing — pricing & booking pages", count: 6 },
  { id: "empty", name: "Someday", count: 0 },
];

/** The Tasks rail: icon rows, a section with a hover "+", dotted bucket rows with menus. Hover a row: the count swaps for ⋯ in the same slot. */
export const Rail: Story = {
  render: () => {
    const [current, setCurrent] = useState("all");
    const [names, setNames] = useState(() =>
      Object.fromEntries(BUCKETS.map((b) => [b.id, b.name])),
    );
    return (
      <nav aria-label="Buckets" className="flex flex-col gap-px">
        <NavRow
          label="All"
          icon={<Layers aria-hidden />}
          count={76}
          current={current === "all"}
          onSelect={() => setCurrent("all")}
        />
        <NavRow
          label="Queue"
          icon={<ListChecks aria-hidden />}
          count={4}
          current={current === "queue"}
          onSelect={() => setCurrent("queue")}
        />
        <NavRow
          label="Inbox"
          icon={<Inbox aria-hidden />}
          count={2}
          current={current === "inbox"}
          onSelect={() => setCurrent("inbox")}
        />
        <NavSectionHeader className="mt-3" label="Buckets" onAdd={() => {}} addLabel="New bucket" />
        {BUCKETS.map((b) => (
          <NavRow
            key={b.id}
            navId={b.id}
            label={names[b.id] ?? b.name}
            icon={<NavRowDot color={b.color} />}
            count={b.count}
            current={current === b.id}
            onSelect={() => setCurrent(b.id)}
            onRename={(name) => setNames((prev) => ({ ...prev, [b.id]: name }))}
            menu={rowMenu}
          />
        ))}
      </nav>
    );
  },
};

/** Every state on one surface: rest, hover (point at it), current, drop target, dragging, with an indicator. */
export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-px">
      <NavRow label="Rest" icon={<NavRowDot />} count={12} menu={rowMenu} />
      <NavRow label="Current" icon={<NavRowDot />} count={12} current menu={rowMenu} />
      <NavRow label="Drop target" icon={<NavRowDot />} count={12} dropTarget menu={rowMenu} />
      <NavRow label="Dragging" icon={<NavRowDot />} count={12} dragging menu={rowMenu} />
      <NavRow
        label="With an indicator"
        icon={<NavRowDot />}
        count={3}
        indicator={<span aria-hidden className="size-1.5 rounded-full bg-muted-foreground" />}
        menu={rowMenu}
      />
      <NavRow label="No count, menu only" icon={<NavRowDot />} menu={rowMenu} />
      <NavRow
        label="Hover + beside ⋯"
        icon={<NavRowDot color="teal" />}
        count={7}
        menu={rowMenu}
        onAdd={() => {}}
        addLabel="New task in this bucket"
      />
      <NavRow label="Count, no menu" icon={<Hash aria-hidden />} count={128} />
    </div>
  ),
};

/** A collapsible section with an aggregate count, and nested rows (the notes tree). */
export const SectionsAndLevels: Story = {
  render: () => {
    const [collapsed, setCollapsed] = useState(false);
    return (
      <div className="flex flex-col gap-px">
        <NavSectionHeader
          label="Clients"
          count={collapsed ? 14 : undefined}
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          onAdd={() => {}}
          addLabel="New bucket in Clients"
        />
        {!collapsed ? (
          <>
            <NavRow label="Acme" icon={<NavRowDot color="teal" />} count={9} menu={rowMenu} />
            <NavRow label="Globex" icon={<NavRowDot color="pink" />} count={5} menu={rowMenu} />
          </>
        ) : null}
        <NavSectionHeader className="mt-3" label="Notes" />
        <NavRow label="Product" icon={<NavRowDot />} />
        <NavRow label="Roadmap" level={1} icon={<NavRowDot />} />
        <NavRow label="Q4" level={2} icon={<NavRowDot />} />
      </div>
    );
  },
};

/** Rail rows and a section header at the three density steps: rows 36 / 32 / 28 px. */
export const Densities: Story = {
  render: () => (
    <AtThreeDensities direction="column">
      <nav aria-label="Projects" className="flex flex-col gap-px">
        <NavSectionHeader
          label="Client work"
          count={3}
          onToggle={() => {}}
          onAdd={() => {}}
          menu={rowMenu}
        />
        <NavRow label="Inbox" icon={<Inbox aria-hidden />} count={4} current />
        <NavRow label="Moduo App" icon={<NavRowDot color="blue" />} count={64} menu={rowMenu} />
        <NavRow label="Marketing" icon={<NavRowDot color="amber" />} count={1} menu={rowMenu} />
      </nav>
    </AtThreeDensities>
  ),
};
