import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { fn } from "storybook/test";

import type { Note, NoteFavorite } from "../model";
import { buildSidebarSections } from "../sections";
import { NotesSidebar, type NotesSidebarProps } from "./notes-sidebar";
import type { FooterView } from "./sidebar-footer-views";

let seq = 0;
function note(partial: Partial<Note> & { id: string; title: string }): Note {
  seq += 1;
  return {
    workspaceId: "ws1",
    createdBy: "u1",
    parentId: null,
    icon: null,
    position: String(seq * 1000).padStart(10, "0"),
    isArchived: false,
    publishedAt: null,
    publishToken: null,
    docVersion: 0,
    createdAt: `2026-10-${String(seq).padStart(2, "0")}T08:00:00.000Z`,
    updatedAt: "2026-10-13T08:00:00.000Z",
    deletedAt: null,
    shareMode: "custom",
    workspaceShared: false,
    inInbox: false,
    fullWidth: false,
    ...partial,
  };
}

const NOTES: Note[] = [
  note({ id: "inbox-1", title: "Random thought about pricing", inInbox: true }),
  note({ id: "inbox-2", title: "", inInbox: true }),
  note({ id: "inbox-3", title: "Call notes — Dana, sync on pricing", inInbox: true }),
  note({ id: "inbox-3a", title: "Follow-ups", parentId: "inbox-3" }),
  note({ id: "clients", title: "Clients", icon: "🗂️" }),
  note({ id: "acme", title: "Acme", parentId: "clients" }),
  note({ id: "acme-kickoff", title: "Kickoff notes", parentId: "acme" }),
  note({ id: "projects", title: "Projects", icon: "🎯" }),
  note({ id: "moduo", title: "Moduo alpha", parentId: "projects" }),
  note({
    id: "handbook",
    title: "Team handbook",
    publishedAt: "2026-10-02T08:00:00.000Z",
    publishToken: "tok",
  }),
  note({ id: "archived", title: "MTG decks 2024", isArchived: true }),
  note({ id: "trashed", title: "Old scratchpad", deletedAt: "2026-10-10T10:00:00.000Z" }),
];

const FAVORITES: NoteFavorite[] = [
  { noteId: "acme", position: "0000001000", createdAt: "2026-10-01T00:00:00.000Z" },
  { noteId: "handbook", position: "0000002000", createdAt: "2026-10-01T00:00:00.000Z" },
];

type Args = Partial<NotesSidebarProps> & {
  favorites?: NoteFavorite[];
  initialView?: FooterView;
  /** Opens with the search showing this query. */
  initialSearch?: string;
};

/** The story's stand-in for the server's text search: notes whose title
 * doesn't hold the words but whose (made-up) text does. */
const STORY_TEXT: Record<string, string> = {
  handbook: "How we work. Weekly sync on Mondays, decisions go in the meeting note.",
  moduo: "Q4: sync engine, publish, comments. Meet moves to beta.",
};

/** The story's stand-in for notes__search's snippet: the first match marked
 * with U+E000 … U+E001, as the server marks it. */
function markFirst(text: string, query: string): string | null {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at === -1 || !query) return null;
  const end = at + query.length;
  return `${text.slice(0, at)}\uE000${text.slice(at, end)}\uE001${text.slice(end)}`;
}

function Harness({
  favorites = FAVORITES,
  notes = NOTES,
  initialView,
  initialSearch,
  ...rest
}: Args) {
  const [selectedId, setSelectedId] = useState<string | null>(rest.selectedId ?? "acme");
  const [view, setView] = useState<FooterView | null>(initialView ?? null);
  const [searchOpen, setSearchOpen] = useState(initialSearch !== undefined);
  const [query, setQuery] = useState(initialSearch ?? "");
  // The shell's sensors: a drag starts after 6 px, so a click still selects.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  return (
    <DndContext sensors={sensors}>
      <div className="h-160 w-(--width-sidebar) rounded-xl border border-border bg-card p-2">
        <NotesSidebar
          workspaceId="story"
          notes={notes}
          sections={buildSidebarSections({ notes, favorites })}
          favoritePositions={new Map(favorites.map((f) => [f.noteId, f.position]))}
          selectedId={selectedId}
          draftId={null}
          canEdit
          loading={false}
          footerView={view}
          onFooterViewChange={setView}
          onOpen={setSelectedId}
          onNewCapture={fn()}
          onNewPage={fn()}
          onCreateChild={fn()}
          onUnfavorite={fn()}
          onAction={fn()}
          onDropIntent={fn()}
          onUnarchive={fn()}
          onTrash={fn()}
          onRestore={fn()}
          onPurge={fn()}
          onImport={fn()}
          search={{
            open: searchOpen,
            query,
            onQueryChange: setQuery,
            onOpenChange: setSearchOpen,
            notes,
            searchText: async (q) =>
              notes
                .filter((n) => STORY_TEXT[n.id]?.toLowerCase().includes(q.toLowerCase()))
                .map((n) => ({
                  id: n.id,
                  title: n.title,
                  icon: n.icon,
                  context: null,
                  snippet: markFirst(STORY_TEXT[n.id] ?? "", q),
                  match: "body" as const,
                })),
          }}
          {...rest}
        />
      </div>
    </DndContext>
  );
}

const meta: Meta<typeof Harness> = {
  title: "Features/Notes/New Notes sidebar",
  component: Harness,
  parameters: { layout: "centered" },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Favorites · Inbox (with a nested capture) · Pages, and the footer row. */
export const Default: Story = {};

/** Search: titles match at once, what notes say a beat later, with the line it
 * was found in. */
export const Searching: Story = { args: { initialSearch: "sync" } };

/** Nothing captured: Inbox says where captures land, and Favorites hides. */
export const EmptyInbox: Story = {
  args: {
    favorites: [],
    notes: NOTES.filter((n) => !n.inInbox && n.parentId !== "inbox-3"),
  },
};

/** No favorites yet: the section isn't drawn at all. */
export const NoFavorites: Story = { args: { favorites: [] } };

/** A view-only member: no create, no drag, a reading menu. */
export const ViewOnly: Story = { args: { canEdit: false, onImport: undefined } };

/** First paint with nothing cached: skeleton rows. */
export const Loading: Story = { args: { loading: true, notes: [], favorites: [] } };

/** Type "pricing" into the search box to see ranked results replace the tree. */
export const Search: Story = {};

/** The Trash sub-view, with days left and Restore / Delete forever on hover. */
export const TrashView: Story = { args: { initialView: "trash" } };

/** The Archive sub-view. */
export const ArchiveView: Story = { args: { initialView: "archive" } };

/** A short sidebar with a long tree, to drag while scrolling (drops follow the pointer). */
export const LongTree: Story = {
  args: {
    notes: [
      ...NOTES,
      ...Array.from({ length: 30 }, (_, i) => note({ id: `page-${i}`, title: `Page ${i + 1}` })),
    ],
    onDropIntent: (intent) => {
      (window as unknown as { __lastDrop?: unknown }).__lastDrop = intent;
    },
  },
};

/** The Published sub-view. */
export const PublishedView: Story = { args: { initialView: "published" } };
