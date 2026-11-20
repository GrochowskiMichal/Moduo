// Types for notes-doc.bundle.js (the bundle ships none). Mirrors the exports
// of apps/app/src/features/notes/editor/agent-write.ts.

type NotesLog = { snapshotB64: string | null; updatesB64: string[] };
type AgentEdit = { kind: "append" | "replace"; markdown: string };

export function agentWriteFromLog(input: NotesLog & { edit: AgentEdit }): {
  updateB64: string | null;
  bodyMd: string;
  bodyText: string;
};
export function bodyFromLog(input: NotesLog): { bodyMd: string; bodyText: string };
export function compactFromLog(input: NotesLog): string;
export function agentCreateDoc(
  noteId: string,
  markdown: string,
): { docStateB64: string; bodyText: string; bodyMd: string } | null;
