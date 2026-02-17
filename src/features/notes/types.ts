export type NoteKind = "category" | "folder" | "note";

export type NoteMeta = {
  id: string;
  workspaceId: string;
  ownerId: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  kind: NoteKind;
  tags: string[];
  isPinned: boolean;
  position: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type NoteTreeNode = NoteMeta & {
  children: NoteTreeNode[];
  depth: number;
};

export type SyncUpdate = {
  id: number;
  noteId: string;
  clientId: string;
  clientSeq: number;
  updateB64: string;
  createdAt: string;
};

export type SyncCursor = {
  workspaceId: string;
  noteId: string;
  lastPulledUpdateId: number;
  clientSeq: number;
  lastCompactedUpdateId: number;
};

export type NotesSyncStatus = "offline" | "syncing" | "synced" | "error";

export type SlashCommand = {
  id:
    | "paragraph"
    | "h1"
    | "h2"
    | "h3"
    | "bullet"
    | "number"
    | "todo"
    | "quote"
    | "code"
    | "divider"
    | "toggle";
  title: string;
  keywords: string[];
  group: "Basic" | "Lists" | "Blocks";
};

export type LocalOutboxEntry = {
  id: string;
  scopeKey: string;
  workspaceId: string;
  noteId: string;
  ownerId: string;
  clientId: string;
  clientSeq: number;
  updateB64: string;
  createdAt: string;
};
