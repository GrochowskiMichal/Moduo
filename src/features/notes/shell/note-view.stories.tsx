/**
 * The New Notes reading column (NR-3): the real `NoteView` + `NoteEditor` on
 * the real sync engine, fed by a fake runtime. The note's doc arrives through
 * the engine's pull (built from the AC9 fidelity fixture), so the story shows
 * the whole path: honest provider → schema nodes drawn through the view
 * registry → meta line under the title → "Linked from" footer → shared prose.
 */

import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { Meta, StoryObj } from "@storybook/react";
import { useMemo } from "react";
import { fn } from "storybook/test";
import type { EntityLink, EntityRecord, EntityRef, RelationKind } from "../../../lib/entity-links";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { FIDELITY_MD } from "../editor/fidelity.fixture";
import { buildDocStateFromMarkdown } from "../editor/materialize";
import type { NotesEditorBridge } from "../editor/notes-editor-bridge";
import type { Note } from "../model";
import { NotesSyncEngineV2 } from "../sync/engine-v2";
import { NoteView } from "./note-view";

const WS = "story-ws";

function note(id: string, partial: Partial<Note> = {}): Note {
  return {
    id,
    workspaceId: WS,
    createdBy: "u1",
    parentId: null,
    title: "Plan",
    icon: null,
    isPinned: false,
    position: "0000001000",
    isArchived: false,
    publishedAt: null,
    publishToken: null,
    docVersion: 0,
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    deletedAt: null,
    shareMode: "custom",
    workspaceShared: false,
    inInbox: false,
    fullWidth: false,
    ...partial,
  };
}

let seq = 0;
function link(noteId: string, other: EntityRef, kind: RelationKind, incoming = false): EntityLink {
  seq += 1;
  const self = { type: "note", id: noteId };
  const source = incoming ? other : self;
  const target = incoming ? self : other;
  return {
    id: `l${seq}`,
    workspaceId: WS,
    sourceType: source.type,
    sourceId: source.id,
    targetType: target.type,
    targetId: target.id,
    relationKind: kind,
    origin: "manual",
    createdBy: "u1",
    createdAt: "2026-10-10T08:00:00.000Z",
    deletedAt: null,
  };
}

function record(ref: EntityRef, label: string): EntityRecord {
  return { workspaceId: WS, type: ref.type, id: ref.id, label, icon: null, deletedAt: null };
}

function fakeRuntime(noteId: string, withLinks: boolean): ModuoRuntime {
  const built = buildDocStateFromMarkdown(noteId, FIDELITY_MD)!;
  const acme = { type: "company", id: "co1" };
  const t1 = { type: "task", id: "t1" };
  const t2 = { type: "task", id: "t2" };
  const call = { type: "event", id: "e1" };
  const standup = { type: "note", id: "n-standup" };
  const kickoff = { type: "note", id: "n-kickoff" };
  const links = withLinks
    ? [
        link(noteId, acme, "references"),
        link(noteId, t1, "references"),
        link(noteId, t2, "spawned-from", true),
        link(noteId, call, "references"),
        link(noteId, standup, "references", true),
        link(noteId, kickoff, "mentions", true),
      ]
    : [];
  const records = [
    record(acme, "Acme"),
    record(t1, "Send the deck"),
    record(t2, "Book the room"),
    record(call, "Thu call"),
    record(standup, "Monday standup"),
    record(kickoff, "Kickoff notes"),
  ];
  return {
    notesV2: {
      pullDoc: async () => ({ snapshotB64: built.docStateB64, docVersion: 1, updates: [] }),
      pushUpdates: async () => ({ inserted: 0, duplicates: 0, maxUpdateId: null }),
      saveSnapshot: async () => ({ folded: 0, docVersion: 1, refused: false }),
    },
    spine: {
      listLinks: async () => links,
      getEntities: async ({ refs }: { refs: EntityRef[] }) =>
        records.filter((r) => refs.some((ref) => ref.type === r.type && ref.id === r.id)),
    },
  } as unknown as ModuoRuntime;
}

const bridge: NotesEditorBridge = {
  getNoteMeta: () => null,
  openNote: () => {},
  createChildNote: () => null,
  tasks: {
    canEditTasks: false,
    getTask: () => null,
    listLinkableTasks: () => [],
    toggleTask: () => {},
    renameTask: () => {},
    scheduleTaskAt: () => {},
    mintTask: async () => null,
    linkExistingTask: () => {},
    detachTaskLines: () => {},
    detachAndDeleteTask: () => {},
    revertMintIfJustMinted: () => false,
    restoreDetachedTasks: () => {},
    openTaskDetail: () => {},
  },
  // The `[[` picker and the ⌘K dialog (NR-4) search these.
  listNotes: () => [
    note("n-roadmap", { title: "Roadmap" }),
    note("n-q4", { title: "Q4 roadmap review" }),
    note("n-groceries", { title: "Groceries" }),
  ],
  createLinkedNote: () => ({ id: crypto.randomUUID(), created: Promise.resolve(true) }),
  openComments: fn(),
};

function Harness({ fullWidth, withLinks }: { fullWidth: boolean; withLinks: boolean }) {
  // A fresh note id per mount keeps the IndexedDB cache from an earlier
  // story out of this one.
  const noteId = useMemo(() => crypto.randomUUID(), []);
  const runtime = useMemo(() => fakeRuntime(noteId, withLinks), [noteId, withLinks]);
  const engine = useMemo(() => new NotesSyncEngineV2(runtime, WS), [runtime]);
  // The shell's sensors (the editor drop zone listens to the shell's drags).
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  return (
    <DndContext sensors={sensors}>
      <div className="h-screen bg-background">
        <NoteView
          topBar={<div className="h-(--bar-h) border-b border-hairline" />}
          runtime={runtime}
          engine={engine}
          workspaceId={WS}
          editorNoteId={noteId}
          note={note(noteId, { fullWidth })}
          isDraft={false}
          editable
          degraded={false}
          loading={false}
          canEdit
          seedWelcome={false}
          bridge={bridge}
          onTitleDerived={fn()}
          onRestore={fn()}
          onOpenEntity={fn()}
          onOpenDetail={fn()}
        />
      </div>
    </DndContext>
  );
}

const meta = {
  title: "Notes/Note view",
  component: Harness,
  parameters: { layout: "fullscreen" },
  args: { fullWidth: false, withLinks: true },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadingWidth: Story = {};

export const FullWidth: Story = { args: { fullWidth: true } };

export const NothingLinked: Story = { args: { withLinks: false } };
