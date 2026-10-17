import type { Meta, StoryObj } from "@storybook/react";
import { Archive, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";

import { SidebarFooter, type SidebarFooterItem } from "./sidebar-footer";

// MOD-140 — a sidebar's quiet footer: Tasks' Archived · Recently deleted, side
// by side at the bottom of the sidebar. Icon and label at a roomy sidebar,
// the icon alone (with its tooltip and name) at a narrow one.

/** A sidebar column of the given width, the footer pinned to its bottom. */
function Sidebar({ width, children }: { width: "narrow" | "wide"; children: ReactNode }) {
  return (
    <div
      className={`flex h-48 flex-col justify-end rounded-xl border border-border bg-card p-2 ${
        width === "narrow" ? "w-56" : "w-72"
      }`}
    >
      {children}
    </div>
  );
}

function TasksFooter({ initial = null }: { initial?: "archived" | "trash" | null }) {
  const [current, setCurrent] = useState(initial);
  const items: SidebarFooterItem[] = [
    {
      icon: Archive,
      label: "Archived",
      active: current === "archived",
      onSelect: () => setCurrent("archived"),
    },
    {
      icon: Trash2,
      label: "Recently deleted",
      active: current === "trash",
      onSelect: () => setCurrent("trash"),
    },
  ];
  return <SidebarFooter items={items} label="Archive and trash" />;
}

const meta: Meta<typeof SidebarFooter> = {
  title: "Components/app/sidebar-footer",
  component: SidebarFooter,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** At 18rem (288 px) there's room for the words. */
export const Wide: Story = {
  render: () => (
    <Sidebar width="wide">
      <TasksFooter />
    </Sidebar>
  ),
};

/** At 14rem (224 px) the words step aside: icons, named and with tooltips. */
export const Narrow: Story = {
  render: () => (
    <Sidebar width="narrow">
      <TasksFooter />
    </Sidebar>
  ),
};

/** The destination you're on takes the neutral active fill. */
export const Current: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Sidebar width="wide">
        <TasksFooter initial="trash" />
      </Sidebar>
      <Sidebar width="narrow">
        <TasksFooter initial="archived" />
      </Sidebar>
    </div>
  ),
};
