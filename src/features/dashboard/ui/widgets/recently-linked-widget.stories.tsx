import type { Meta, StoryObj } from "@storybook/react";

import type { RecentLinkItem } from "@/features/spine/recent";
import { RecentlyLinkedList } from "./recently-linked-widget";

function endpoint(type: string, id: string, label: string, tombstoned = false) {
  return { type, id, label, icon: null, tombstoned };
}

let seq = 0;
function item(over: Partial<RecentLinkItem> = {}): RecentLinkItem {
  seq += 1;
  return {
    id: `l${seq}`,
    relationKind: "references",
    origin: "manual",
    createdAt: `2026-06-27T00:00:0${seq}Z`,
    source: endpoint("task", "t1", "Ship the launch page"),
    target: endpoint("contact", "c1", "Acme Corp"),
    ...over,
  };
}

const ITEMS: RecentLinkItem[] = [
  item({ relationKind: "blocks", source: endpoint("task", "t1", "Ship the launch page"), target: endpoint("task", "t2", "Draft the proposal") }),
  item({ relationKind: "works-at", source: endpoint("contact", "c1", "Dana Lee"), target: endpoint("company", "co1", "Acme Corp") }),
  item({ relationKind: "paid-by", source: endpoint("payment", "p1", "Invoice #1043"), target: endpoint("contact", "c1", "Dana Lee") }),
  item({ relationKind: "mentions", source: endpoint("note", "n1", "Account plan"), target: endpoint("task", "t3", "Deleted task", true) }),
];

const meta: Meta<typeof RecentlyLinkedList> = {
  title: "Spine/RecentlyLinkedWidget",
  component: RecentlyLinkedList,
  decorators: [
    (Story) => (
      <div className="h-80 w-96 overflow-hidden rounded-lg border border-border bg-card">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Recent links across the workspace; clicking an end deep-links to its hub. */
export const Populated: Story = {
  args: { items: ITEMS },
};

/** A tombstoned endpoint renders dimmed as "Deleted [type]" and isn't clickable. */
export const WithTombstone: Story = {
  args: { items: [ITEMS[3]] },
};

/** No links yet — a quiet teaching empty state, never an error tone. */
export const Empty: Story = {
  args: { items: [] },
};
