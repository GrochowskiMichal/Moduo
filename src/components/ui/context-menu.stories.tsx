import type { Meta, StoryObj } from "@storybook/react";
import { Copy, FilePlus2, FolderOpen, Pencil, Pin, Share2, Trash2 } from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./context-menu";

const meta: Meta<typeof ContextMenu> = {
  title: "Components/ui/context-menu",
  component: ContextMenu,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex h-40 w-72 items-center justify-center rounded-lg border border-dashed border-border bg-card text-sm text-muted-foreground">
          Right-click anywhere
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>Note</ContextMenuLabel>
        <ContextMenuItem>
          <Pin />
          Pin
          <ContextMenuShortcut>⌘P</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem>
          <Copy />
          Copy link
          <ContextMenuShortcut>⌘⇧C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem>
          <FilePlus2 />
          Duplicate
        </ContextMenuItem>
        <ContextMenuItem>
          <Pencil />
          Rename
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderOpen />
            Move to…
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem>Pinned</ContextMenuItem>
            <ContextMenuItem>Inbox</ContextMenuItem>
            <ContextMenuItem>Archive</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem>
          <Share2 />
          Publish
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive">
          <Trash2 />
          Move to trash
          <ContextMenuShortcut>⌫</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
};
