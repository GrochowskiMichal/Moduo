import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import type { Note } from "../model";
import { buildNoteSections } from "../tree";
import { NoteTreeSidebar } from "./note-tree-sidebar";

let seq = 0;
function note(partial: Partial<Note> & { id: string; title: string }): Note {
  seq += 1;
  return {
    workspaceId: "ws1",
    createdBy: "u1",
    parentId: null,
    icon: null,
    isPinned: false,
    position: String(seq).padStart(10, "0"),
    isArchived: false,
    publishedAt: null,
    publishToken: null,
    docVersion: 0,
    createdAt: "2026-06-01T08:00:00.000Z",
    updatedAt: "2026-07-01T08:00:00.000Z",
    deletedAt: null,
    ...partial,
    shareMode: partial.shareMode ?? "custom",
    workspaceShared: partial.workspaceShared ?? false,
  };
}

const NOTES: Note[] = [
  note({ id: "pinned", title: "Team rituals", icon: "📌", isPinned: true }),
  note({ id: "inbox-1", title: "Random thought about pricing" }),
  note({ id: "inbox-2", title: "" }),
  note({ id: "clients", title: "Clients", icon: "🗂️" }),
  note({ id: "acme", title: "Acme", parentId: "clients" }),
  note({ id: "acme-kickoff", title: "Kickoff notes", parentId: "acme" }),
  note({ id: "projects", title: "Projects", icon: "🎯" }),
  note({ id: "moduo", title: "Moduo alpha", parentId: "projects" }),
  note({ id: "archived", title: "MTG decks 2024", isArchived: true }),
  note({ id: "trashed", title: "Old scratchpad", deletedAt: "2026-06-20T10:00:00.000Z" }),
];

const handlers = {
  onSelect: fn(),
  onCreateRoot: fn(),
  onCreateChild: fn(),
  onDropRow: fn(),
  onTogglePin: fn(),
  onSetIcon: fn(),
  onDuplicate: fn(),
  onArchive: fn(),
  onTrash: fn(),
  onRestore: fn(),
  onPurge: fn(),
};

const meta: Meta<typeof NoteTreeSidebar> = {
  title: "Notes/NoteTreeSidebar",
  component: NoteTreeSidebar,
  decorators: [
    (Story) => (
      <div className="h-[560px] w-64 border border-border bg-card">
        <Story />
      </div>
    ),
  ],
  args: {
    workspaceId: "ws-story",
    sections: buildNoteSections(NOTES),
    selectedId: "acme",
    canEdit: true,
    ...handlers,
  },
};
export default meta;

type Story = StoryObj<typeof NoteTreeSidebar>;

export const Default: Story = {};

export const ViewOnly: Story = {
  args: { canEdit: false },
};

export const EmptyWorkspace: Story = {
  args: {
    sections: buildNoteSections([]),
    selectedId: null,
  },
};
