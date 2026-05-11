import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  Calendar,
  FilePlus2,
  Hash,
  Search,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";

import { Button } from "./button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  useCommandPaletteShortcut,
} from "./command";

const meta: Meta<typeof Command> = {
  title: "Components/ui/command",
  component: Command,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

function Items() {
  return (
    <>
      <CommandGroup heading="Suggestions">
        <CommandItem>
          <FilePlus2 />
          New note
          <CommandShortcut>⌘N</CommandShortcut>
        </CommandItem>
        <CommandItem>
          <Sparkles />
          Ask AI
          <CommandShortcut>⌘J</CommandShortcut>
        </CommandItem>
        <CommandItem>
          <Search />
          Search workspace
          <CommandShortcut>⌘F</CommandShortcut>
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Navigate">
        <CommandItem>
          <Hash />
          Go to note…
        </CommandItem>
        <CommandItem>
          <Users />
          Switch workspace
          <CommandShortcut>⌘⇧W</CommandShortcut>
        </CommandItem>
        <CommandItem>
          <Calendar />
          Open today
        </CommandItem>
        <CommandItem>
          <Settings />
          Settings
          <CommandShortcut>⌘,</CommandShortcut>
        </CommandItem>
      </CommandGroup>
    </>
  );
}

export const Inline: Story = {
  render: () => (
    <Command className="w-[480px] rounded-lg border border-border bg-popover">
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <Items />
      </CommandList>
    </Command>
  ),
};

function DialogDemo() {
  const [open, setOpen] = useState(false);
  useCommandPaletteShortcut(setOpen);
  return (
    <div className="flex flex-col items-start gap-3">
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open palette (⌘K)
      </Button>
      <p className="text-xs text-muted-foreground">
        Press ⌘K (or Ctrl+K) anywhere to open the palette.
      </p>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Type a command or search…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <Items />
        </CommandList>
      </CommandDialog>
    </div>
  );
}

export const PaletteDialog: Story = {
  render: () => <DialogDemo />,
};
