/** The runtime port's notes, notesV2 (implemented in runtime.web.notes.ts). */

import type {
  NoteDocPull,
  NoteFavorite,
  NotesImportRow,
  NotesV2Bundle,
  Note as NoteV2,
} from "../features/notes/model";

/** NR-7: what `notesV2.joinLive` reports to the open editor. Everything
 * comes from the server; the client sends nothing over Realtime. */
export type NoteLiveJoin = {
  noteId: string;
  selfUserId: string;
  /** Something was saved (by anyone, agents included), or the socket
   * rejoined: pull. Messages never carry note content. */
  onPull(): void;
  /** Who has the note open right now (user ids, self included), as the
   * server stamped them; [] when this person may not view it. */
  onViewers(userIds: string[]): void;
};

/** NR-7: an open note's live channel. */
export type NoteLiveChannel = {
  /** Say goodbye and stop listening for this note. */
  close(): void;
};

/**
 * LEGACY read-only notes surface. Two survivors: the one-time redb import
 * (desktop reads the local store through them) and the legacy dashboard
 * notes-preview widget. The write half died with the Wave-3 rebuild —
 * mutations go through `notesV2`.
 */
export type NotesRuntime = {
  list(workspaceId: string): Promise<any[]>;
  getDocState(workspaceId: string, noteId: string): Promise<any>;
};

/**
 * Wave-3 Notes rebuild surface (specs/notes.md NO-1). Cloud-first on both
 * platforms (desktop delegates wholesale). Writes = notes_op_* intent RPCs;
 * reads degrade pre-migration (`degraded: true` on the bundle). The legacy
 * `notes` namespace above retires with NO-2/NO-3.
 */
export type NotesV2Runtime = {
  listMeta(workspaceId: string): Promise<NotesV2Bundle>;
  /** Snapshot + update-log-since-cursor for one note (the sync engine's pull). */
  pullDoc(input: {
    workspaceId: string;
    noteId: string;
    sinceUpdateId?: number | null;
    /** NR-7: the snapshot version this session already holds. When the
     * server's is the same the snapshot isn't sent again (`snapshotB64`
     * null): live pulls after every save stay small. */
    knownDocVersion?: number | null;
  }): Promise<NoteDocPull>;
  create(input: {
    workspaceId: string;
    id?: string | null;
    parentId?: string | null;
    title?: string;
    position?: string;
    icon?: string | null;
  }): Promise<NoteV2>;
  rename(input: { workspaceId: string; noteId: string; title: string }): Promise<NoteV2>;
  /** Reparent/reorder. `followParent`: in the same transaction, the note
   * drops its own sharing and follows the new parent's ("Match the new
   * parent"); if that is refused, the move is undone too. */
  move(input: {
    workspaceId: string;
    noteId: string;
    parentId: string | null;
    position: string;
    followParent?: boolean;
  }): Promise<NoteV2>;
  setMeta(input: {
    workspaceId: string;
    noteId: string;
    patch: { icon?: string | null; isPinned?: boolean; fullWidth?: boolean };
  }): Promise<NoteV2>;
  /** NR-1: move a note between the stored Inbox and Pages. Filing INTO the
   * Inbox re-roots a nested note (Inbox only holds roots). */
  fileNote(input: {
    workspaceId: string;
    noteId: string;
    inInbox: boolean;
    position?: string;
  }): Promise<NoteV2>;
  /** NR-1: the viewer's own favorites in this workspace. Degrades to []
   * while the table isn't deployed (a sidebar never walls). */
  listFavorites(workspaceId: string): Promise<NoteFavorite[]>;
  /** NR-1: add/remove/reorder one of the viewer's favorites. */
  setFavorite(input: {
    workspaceId: string;
    noteId: string;
    value: boolean;
    position?: string | null;
  }): Promise<void>;
  duplicate(input: {
    workspaceId: string;
    sourceNoteId: string;
    position?: string;
  }): Promise<NoteV2>;
  archive(input: { workspaceId: string; noteId: string }): Promise<NoteV2>;
  unarchive(input: { workspaceId: string; noteId: string }): Promise<NoteV2>;
  trash(input: { workspaceId: string; noteId: string }): Promise<{
    trashedIds: string[];
    count: number;
  }>;
  restore(input: { workspaceId: string; noteId: string }): Promise<{
    restoredIds: string[];
    count: number;
  }>;
  purge(input: { workspaceId: string; noteId: string }): Promise<{ count: number }>;
  /** 30-day trash sweep on module load; degrades quietly pre-deploy. */
  purgeExpired(workspaceId: string): Promise<{ count: number }>;
  publish(input: { workspaceId: string; noteId: string }): Promise<NoteV2>;
  unpublish(input: { workspaceId: string; noteId: string }): Promise<NoteV2>;
  /** Public read URL for a published note's token (NO-9, the notes-public
   * edge function renders the subtree from body_md). Pure string builder. */
  publishedUrl(token: string): string;
  /** Recently-touched notes for the dashboard widget (NO-10). Trashed
   * excluded; degrades to [] pre-migration (a widget never walls). */
  recent(input: { workspaceId: string; limit?: number }): Promise<
    {
      id: string;
      title: string;
      bodyText: string;
      updatedAt: string;
      isArchived: boolean;
      publishedAt: string | null;
    }[]
  >;
  /** Idempotent outbox push (batched CRDT updates + optional derived body). */
  pushUpdates(input: {
    workspaceId: string;
    noteId: string;
    clientId: string;
    updates: Array<{ clientSeq: number; updateB64: string }>;
    bodyText?: string | null;
    bodyMd?: string | null;
  }): Promise<{ inserted: number; duplicates: number; maxUpdateId: number | null }>;
  /** Client-driven compaction: fold the update log into the snapshot.
   * With `expectedDocVersion`, the server refuses (`refused: true`, nothing
   * changed, `docVersion` = the current one) when another client folded
   * since — overwriting its snapshot would lose the rows it folded. */
  saveSnapshot(input: {
    workspaceId: string;
    noteId: string;
    snapshotB64: string;
    uptoUpdateId: number;
    bodyText?: string | null;
    bodyMd?: string | null;
    expectedDocVersion?: number | null;
  }): Promise<{ folded: number; docVersion: number; refused: boolean }>;
  /** ONCE-ONLY materialization of a never-materialized note's CRDT doc
   * (NOTE-FIX-1). Safe to call optimistically: the server refuses (without
   * erroring) the moment the doc exists in any form, so two devices opening
   * the same blank imported note can't fork it into a duplicated doc. */
  seedDoc(input: {
    workspaceId: string;
    noteId: string;
    docStateB64: string;
    bodyText?: string | null;
    bodyMd?: string | null;
  }): Promise<{ seeded: boolean; reason: string | null; docVersion: number | null }>;
  /** Notes carrying a body but NO CRDT doc — the repair sweep's work list.
   * Degrades to [] pre-migration (the sweep is opportunistic, never a wall). */
  listUnmaterialized(input: {
    workspaceId: string;
    limit?: number;
  }): Promise<{ id: string; bodyMd: string }[]>;
  importNotes(input: {
    workspaceId: string;
    rows: NotesImportRow[];
  }): Promise<{ imported: number; skipped: number }>;
  mention(input: {
    workspaceId: string;
    noteId: string;
    mentionedUserIds: string[];
  }): Promise<void>;
  /** Full-text sidebar search (NO-8, AC8) over the server `search_tsv` GIN
   * index; trashed excluded, archived flagged. Degrades to [] pre-migration. */
  search(input: { workspaceId: string; query: string; limit?: number }): Promise<
    {
      id: string;
      title: string;
      bodyText: string;
      isArchived: boolean;
      deletedAt: string | null;
    }[]
  >;
  /** `body_md` for a set of notes — the per-note / tree markdown export source. */
  fetchExportDocs(input: {
    workspaceId: string;
    ids: string[];
  }): Promise<{ id: string; title: string; bodyMd: string }[]>;
  /**
   * NR-7: follow an open note live: saved updates from others, and who is
   * viewing. The server sends both only to people who may view the note,
   * checked on every save and every heartbeat (`notes_live_here`); a
   * refusal just means nothing arrives and the editor keeps pulling.
   */
  joinLive(input: NoteLiveJoin): NoteLiveChannel;
};
