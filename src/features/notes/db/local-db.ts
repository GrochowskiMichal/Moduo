import Dexie, { type Table } from "dexie";
import type { LocalOutboxEntry, NoteMeta, SyncCursor } from "../types";

type LocalMetaKV = {
  key: string;
  value: string;
};

type LocalNotePin = {
  key: string;
  ownerId: string;
  noteId: string;
  isPinned: boolean;
  updatedAt: string;
};

export class NotesLocalDB extends Dexie {
  notes!: Table<NoteMeta, string>;
  syncCursors!: Table<SyncCursor, string>;
  outbox!: Table<LocalOutboxEntry, string>;
  meta!: Table<LocalMetaKV, string>;
  notePins!: Table<LocalNotePin, string>;

  constructor() {
    super("moduo_notes_v1");

    this.version(1).stores({
      notes: "id, ownerId, parentId, [ownerId+parentId], updatedAt, position, deletedAt",
      syncCursors: "noteId, lastPulledUpdateId, clientSeq",
      outbox: "id, noteId, ownerId, clientId, clientSeq, createdAt",
      meta: "key",
    });

    this.version(2).stores({
      notes: "id, ownerId, parentId, [ownerId+parentId], updatedAt, position, deletedAt",
      syncCursors: "noteId, lastPulledUpdateId, clientSeq",
      outbox: "id, noteId, ownerId, clientId, clientSeq, createdAt",
      meta: "key",
      notePins: "key, ownerId, noteId, [ownerId+noteId], updatedAt",
    });
  }
}

export const notesLocalDB = new NotesLocalDB();

export async function getMetaValue(key: string): Promise<string | null> {
  const row = await notesLocalDB.meta.get(key);
  return row?.value ?? null;
}

export async function setMetaValue(key: string, value: string): Promise<void> {
  await notesLocalDB.meta.put({ key, value });
}

function pinKey(ownerId: string, noteId: string): string {
  return `${ownerId}:${noteId}`;
}

export async function setLocalPin(ownerId: string, noteId: string, isPinned: boolean): Promise<void> {
  const now = new Date().toISOString();
  await notesLocalDB.notePins.put({
    key: pinKey(ownerId, noteId),
    ownerId,
    noteId,
    isPinned,
    updatedAt: now,
  });
}

export async function getLocalPinMap(ownerId: string): Promise<Map<string, boolean>> {
  const rows = await notesLocalDB.notePins.where("ownerId").equals(ownerId).toArray();
  return new Map(rows.map((row) => [row.noteId, row.isPinned]));
}
