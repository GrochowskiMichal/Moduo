import type { NoteMeta } from "../../types";

export type TeamMember = {
  id: string;
  name: string;
  role: string;
};

type BuildNotesTreeModelArgs = {
  notes: NoteMeta[];
  exposedSlugs: Record<string, string | null>;
  selectedNoteId: string | null;
  workspaceMembers: any[];
  currentUserId: string | null;
};

export function buildNotesTreeModel({
  notes,
  exposedSlugs,
  selectedNoteId,
  workspaceMembers,
  currentUserId,
}: BuildNotesTreeModelArgs) {
  const activeNotes = notes.filter((note) => !note.deletedAt && !note.isArchived);
  const listNotes = activeNotes;
  const byParent = groupNotesByParent(listNotes);
  const sectionNotes = listNotes
    .filter((note) => note.kind === "section" && !note.parentId)
    .sort((a, b) => a.position.localeCompare(b.position) || a.title.localeCompare(b.title));
  const pinnedNotes = listNotes
    .filter((note) => note.isPinned && note.kind === "note")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
  const publishedNotes = listNotes
    .filter((note) => note.kind === "note" && !!exposedSlugs[note.id])
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
  const sharedNotes = listNotes
    .filter((note) => note.kind === "note" && note.shareScope !== "private")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
  const teamMembers = buildTeamMembers(workspaceMembers, currentUserId);
  const notesById = new Map(activeNotes.map((note) => [note.id, note]));
  const selectedNote = activeNotes.find((note) => note.id === selectedNoteId) ?? null;
  const selectedEditorNote = selectedNote?.kind === "note" ? selectedNote : null;
  const breadcrumbSegments = buildBreadcrumbSegments(selectedEditorNote, notesById);

  return {
    activeNotes,
    listNotes,
    byParent,
    sectionNotes,
    pinnedNotes,
    publishedNotes,
    sharedNotes,
    teamMembers,
    isTeamWorkspace: teamMembers.length > 0,
    notesById,
    selectedNote,
    selectedEditorNote,
    breadcrumbSegments,
  };
}

function groupNotesByParent(listNotes: NoteMeta[]): Map<string | null, NoteMeta[]> {
  const grouped = new Map<string | null, NoteMeta[]>();
  for (const note of listNotes) {
    if (note.kind === "section") continue;
    const list = grouped.get(note.parentId) ?? [];
    list.push(note);
    grouped.set(note.parentId, list);
  }
  for (const [key, list] of grouped.entries()) {
    list.sort((a, b) => a.position.localeCompare(b.position));
    grouped.set(key, list);
  }
  return grouped;
}

function buildTeamMembers(workspaceMembers: any[], currentUserId: string | null): TeamMember[] {
  return workspaceMembers
    .map((member) => ({
      id: String(member.user_id ?? member.userId ?? ""),
      name: String(member.profiles?.display_name ?? member.displayName ?? member.user_id ?? member.userId ?? "Teammate"),
      role: String(member.role ?? "member"),
    }))
    .filter((member) => member.id && member.id !== currentUserId);
}

function buildBreadcrumbSegments(
  selectedEditorNote: NoteMeta | null,
  notesById: Map<string, NoteMeta>
): string[] {
  if (!selectedEditorNote) return ["Private"];
  const chain: string[] = [];
  const visited = new Set<string>([selectedEditorNote.id]);
  let parentId = selectedEditorNote.parentId;

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = notesById.get(parentId);
    if (!parent || parent.deletedAt || parent.isArchived) break;
    chain.push(parent.title || "Untitled");
    parentId = parent.parentId;
  }

  chain.reverse();
  return [...chain, selectedEditorNote.title || "Untitled"];
}
