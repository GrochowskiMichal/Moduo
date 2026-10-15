// The rows a reference preview reads (runtime.spine.previews.*). Each read is
// one batched select on the module's own table under its row-level security,
// which is `can_access` (PERM-1…9): a row the reader can't open never comes
// back, and that absence is what "Private item" means. Deleted rows the reader
// could open still come back with `deletedAt`, so they read "Deleted task".

export type TaskPreviewRow = {
  id: string;
  title: string;
  status: string;
  /** Due timestamp (timestamptz) or null. */
  dueDate: string | null;
  bucketId: string | null;
  assigneeId: string | null;
  number: number | null;
  deletedAt: string | null;
  /** Card level: the project's name, or null when the reader can't see it. */
  projectName?: string | null;
  /** Card level: whether the project is the owner's Inbox. */
  projectIsInbox?: boolean;
  /** Card level: subtasks finished and in all (live ones). */
  subtasks?: { done: number; total: number } | null;
};

export type ProjectPreviewRow = {
  id: string;
  name: string;
  isSystem: boolean;
  deletedAt: string | null;
  /** Card level: live tasks done and in all. */
  progress?: { done: number; total: number } | null;
};

export type NotePreviewRow = {
  id: string;
  title: string;
  icon: string | null;
  updatedAt: string;
  deletedAt: string | null;
  /** Card level: the head of the note's text. */
  excerpt?: string | null;
};

export type EventPreviewRow = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  attendeeCount: number;
  deletedAt: string | null;
};

export type ContactPreviewRow = {
  id: string;
  kind: "contact" | "company";
  name: string;
  /** A contact's role ("Brand manager"). */
  role: string | null;
  /** A contact's company name, when the reader can see it. */
  companyName: string | null;
  email: string | null;
  avatarUrl: string | null;
  deletedAt: string | null;
};

export type EmailPreviewRow = {
  id: string;
  subject: string;
  fromName: string | null;
  fromAddr: string | null;
  snippet: string | null;
  sentAt: string | null;
  /** A follow-up is set and not cleared: you're waiting on a reply. */
  waitingOnReply: boolean;
  deletedAt: string | null;
};

export type TagPreviewRow = {
  id: string;
  name: string;
  color: string | null;
  deletedAt: string | null;
};

/** A project a picker offers (`@` in prose). */
export type ProjectSearchRow = { id: string; name: string; isSystem: boolean };

/** A tag a picker offers (`#` in prose). */
export type TagSearchRow = { id: string; name: string; color: string | null };

type Batch = { workspaceId: string; ids: string[] };

/** The reads behind references (all RLS-checked; see the file comment). */
export type ReferencePreviewApi = {
  tasks(input: Batch & { card: boolean }): Promise<TaskPreviewRow[]>;
  projects(input: Batch & { card: boolean }): Promise<ProjectPreviewRow[]>;
  notes(input: Batch & { card: boolean }): Promise<NotePreviewRow[]>;
  events(input: Batch): Promise<EventPreviewRow[]>;
  contacts(input: Batch & { kind: "contact" | "company" }): Promise<ContactPreviewRow[]>;
  emails(input: Batch): Promise<EmailPreviewRow[]>;
  tags(input: Batch): Promise<TagPreviewRow[]>;
  searchProjects(input: {
    workspaceId: string;
    query: string;
    limit?: number;
  }): Promise<ProjectSearchRow[]>;
  searchTags(input: {
    workspaceId: string;
    query: string;
    limit?: number;
  }): Promise<TagSearchRow[]>;
  /** The id of the task a handle names (`MOD-142`, or an old key's), if the reader can see it. */
  resolveHandle(input: { workspaceId: string; handle: string }): Promise<string | null>;
};
