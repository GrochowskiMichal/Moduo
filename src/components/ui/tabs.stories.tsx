import type { Meta, StoryObj } from "@storybook/react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

const meta: Meta<typeof Tabs> = {
  title: "Components/ui/tabs",
  component: Tabs,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

const SECTIONS = [
  { value: "appearance", label: "Appearance", body: "Tune theme, accent, density, radius, and fonts." },
  { value: "account", label: "Account", body: "Email, password, and connected providers." },
  { value: "workspace", label: "Workspace", body: "Workspace name, members, and defaults." },
];

export const Horizontal: Story = {
  render: () => (
    <Tabs defaultValue="appearance" className="w-[480px]">
      <TabsList>
        {SECTIONS.map((s) => (
          <TabsTrigger key={s.value} value={s.value}>{s.label}</TabsTrigger>
        ))}
      </TabsList>
      {SECTIONS.map((s) => (
        <TabsContent key={s.value} value={s.value} className="rounded-lg border border-border bg-card p-4 text-sm text-foreground">
          {s.body}
        </TabsContent>
      ))}
    </Tabs>
  ),
};

export const LineVariant: Story = {
  render: () => (
    <Tabs defaultValue="appearance" className="w-[480px]">
      <TabsList variant="line">
        {SECTIONS.map((s) => (
          <TabsTrigger key={s.value} value={s.value}>{s.label}</TabsTrigger>
        ))}
      </TabsList>
      {SECTIONS.map((s) => (
        <TabsContent key={s.value} value={s.value} className="pt-3 text-sm text-foreground">
          {s.body}
        </TabsContent>
      ))}
    </Tabs>
  ),
};

export const Vertical: Story = {
  render: () => (
    <Tabs defaultValue="appearance" orientation="vertical" className="flex h-[260px] gap-4">
      <TabsList variant="line" className="w-40 flex-col border-b-0 border-r border-border">
        {SECTIONS.map((s) => (
          <TabsTrigger key={s.value} value={s.value}>{s.label}</TabsTrigger>
        ))}
      </TabsList>
      {SECTIONS.map((s) => (
        <TabsContent key={s.value} value={s.value} className="flex-1 text-sm text-foreground">
          {s.body}
        </TabsContent>
      ))}
    </Tabs>
  ),
};
