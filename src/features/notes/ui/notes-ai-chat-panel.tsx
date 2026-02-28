import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import type { ModuoRuntime } from "../../../lib/runtime";
import type { NoteKind, NoteMeta } from "../types";
import type { NotesSyncEngine } from "../sync/sync-engine";
import { generatePosition, initialPosition } from "../utils/position";
import { decodeBase64ToUint8, encodeUint8ToBase64 } from "../utils/base64";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type NoteAttachment = {
  id: string;
  title: string;
};

type NoteSnapshot = {
  id: string;
  title: string;
  tags: string[];
  kind: string;
  deletedAt: string | null;
  isArchived: boolean;
};

type RunState = {
  lastCreatedNoteId: string | null;
  createdNotesInRun: number;
  createSignatures: Set<string>;
  noteWritesInRun: number;
  noteWriteFailures: string[];
  taskWritesInRun: number;
  taskWriteFailures: string[];
};

type Props = {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  userId: string | null;
  notes: NoteMeta[];
  syncEngine: NotesSyncEngine | null;
  onCreateNote: (parentId?: string | null, kind?: NoteKind) => Promise<string | null>;
  onUpdateTitle: (noteId: string, title: string) => Promise<void>;
};

function safeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeStateKind(value: unknown): string {
  const raw = String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");
  if (raw === "todo" || raw === "to_do") return "todo";
  if (raw === "inprogress" || raw === "in_progress") return "in_progress";
  if (raw === "inreview" || raw === "in_review") return "in_review";
  if (raw === "done") return "done";
  if (raw === "backlog") return "backlog";
  if (raw === "canceled" || raw === "cancelled") return "canceled";
  return raw || "todo";
}

function normalizePriority(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(4, Math.floor(value)));
  }
  const token = String(value ?? "").toLowerCase().trim();
  if (!token) return 2;
  if (["critical", "urgent", "highest", "p0", "very_high"].includes(token)) return 4;
  if (["high", "p1"].includes(token)) return 3;
  if (["medium", "normal", "p2"].includes(token)) return 2;
  if (["low", "p3"].includes(token)) return 1;
  if (["lowest", "trivial", "p4"].includes(token)) return 0;
  const asNum = Number(token);
  if (Number.isFinite(asNum)) return Math.max(0, Math.min(4, Math.floor(asNum)));
  return 2;
}

function normalizeAlias(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_\-.]/g, "");
}

function parseJsonResponse(raw: string): any | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const tryParse = (value: string) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const direct = tryParse(trimmed);
  if (direct) return direct;

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) ?? trimmed.match(/```\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const fromFence = tryParse(fenced[1].trim());
    if (fromFence) return fromFence;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const fromSlice = tryParse(trimmed.slice(start, end + 1));
    if (fromSlice) return fromSlice;
  }

  return null;
}

function extractTextFromXmlText(node: Y.XmlText): string {
  const parts: string[] = [];
  for (const op of node.toDelta()) {
    const value = op.insert as unknown;
    if (typeof value === "string") {
      parts.push(value);
      continue;
    }
    if (value instanceof Y.XmlElement) {
      parts.push(extractTextFromXmlElement(value));
      continue;
    }
    if (value instanceof Y.XmlText) {
      parts.push(extractTextFromXmlText(value));
      continue;
    }
  }
  return parts.join("");
}

function extractTextFromXmlElement(node: Y.XmlElement): string {
  const parts: string[] = [];
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlElement) {
      const chunk = extractTextFromXmlElement(child);
      if (chunk) parts.push(chunk);
      if (["paragraph", "heading", "quote", "listitem", "code"].includes(child.nodeName)) {
        parts.push("\n");
      }
      continue;
    }
    if (child instanceof Y.XmlText) {
      const chunk = extractTextFromXmlText(child);
      if (chunk) parts.push(chunk);
    }
  }
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

function pushParagraph(root: Y.XmlElement, text: string): void {
  const paragraph = new Y.XmlElement("paragraph");
  const textNode = new Y.XmlText();
  textNode.insert(0, text);
  paragraph.insert(0, [textNode]);
  root.push([paragraph]);
}

function pushHeading(root: Y.XmlElement, tag: "h1" | "h2" | "h3", text: string): void {
  const heading = new Y.XmlElement("heading");
  heading.setAttribute("tag", tag);
  const textNode = new Y.XmlText();
  textNode.insert(0, text);
  heading.insert(0, [textNode]);
  root.push([heading]);
}

function pushQuote(root: Y.XmlElement, text: string): void {
  const quote = new Y.XmlElement("quote");
  const textNode = new Y.XmlText();
  textNode.insert(0, text);
  quote.insert(0, [textNode]);
  root.push([quote]);
}

function pushCode(root: Y.XmlElement, text: string): void {
  const code = new Y.XmlElement("code");
  const textNode = new Y.XmlText();
  textNode.insert(0, text);
  code.insert(0, [textNode]);
  root.push([code]);
}

function pushList(root: Y.XmlElement, type: "bullet" | "number", items: string[]): void {
  const list = new Y.XmlElement("list");
  list.setAttribute("listType", type);
  items.forEach((item, index) => {
    const listItem = new Y.XmlElement("listitem");
    if (type === "number") listItem.setAttribute("value", String(index + 1));
    const paragraph = new Y.XmlElement("paragraph");
    const textNode = new Y.XmlText();
    textNode.insert(0, item);
    paragraph.insert(0, [textNode]);
    listItem.insert(0, [paragraph]);
    list.push([listItem]);
  });
  root.push([list]);
}

function writeMarkdownBlocks(root: Y.XmlElement, text: string): void {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const buffer: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        buffer.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      pushCode(root, buffer.join("\n").trimEnd());
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2].trim();
      const tag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
      pushHeading(root, tag, content);
      i += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length) {
        const raw = (lines[i] ?? "").trim();
        if (!raw.startsWith(">")) break;
        quoteLines.push(raw.replace(/^>\s?/, ""));
        i += 1;
      }
      pushQuote(root, quoteLines.join("\n").trim());
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const raw = (lines[i] ?? "").trim();
        const m = raw.match(/^[-*]\s+(.*)$/);
        if (!m) break;
        items.push(m[1].trim());
        i += 1;
      }
      pushList(root, "bullet", items);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const raw = (lines[i] ?? "").trim();
        const m = raw.match(/^\d+\.\s+(.*)$/);
        if (!m) break;
        items.push(m[1].trim());
        i += 1;
      }
      pushList(root, "number", items);
      continue;
    }

    const paragraphLines: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const nextRaw = lines[i] ?? "";
      const nextTrimmed = nextRaw.trim();
      if (!nextTrimmed) break;
      if (
        nextTrimmed.startsWith("```") ||
        /^(#{1,3})\s+/.test(nextTrimmed) ||
        nextTrimmed.startsWith(">") ||
        /^[-*]\s+/.test(nextTrimmed) ||
        /^\d+\.\s+/.test(nextTrimmed)
      ) {
        break;
      }
      paragraphLines.push(nextTrimmed);
      i += 1;
    }
    pushParagraph(root, paragraphLines.join(" ").trim());
  }
}

function writeContentToDoc(doc: Y.Doc, text: string, mode: "append" | "replace"): void {
  const root = doc.getXmlElement("root-v2");

  if (mode === "replace") {
    const count = root.toArray().length;
    if (count > 0) root.delete(0, count);
  }

  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    pushParagraph(root, "");
    return;
  }
  writeMarkdownBlocks(root, normalized);
}

async function openRouterChat(
  apiKey: string,
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  signal?: AbortSignal
): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://moduo.app",
      "X-Title": "Moduo",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      max_tokens: 4096,
    }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message ?? body?.message ?? "OpenRouter request failed");
  }

  const content = body?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
      .join("\n")
      .trim();
  }

  return "";
}

export function NotesAiChatPanel({
  runtime,
  workspaceId,
  userId,
  notes,
  syncEngine,
  onCreateNote,
  onUpdateTitle,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [credentialId, setCredentialId] = useState<string>("");
  const [credentials, setCredentials] = useState<Array<{ id: string; model: string; keyPreview: string }>>([]);
  const [attachments, setAttachments] = useState<NoteAttachment[]>([]);
  const [runController, setRunController] = useState<AbortController | null>(null);

  const activeNotes = useMemo(
    () => notes.filter((note) => !note.deletedAt && !note.isArchived),
    [notes]
  );

  const notesByAlias = useMemo(() => {
    const map = new Map<string, NoteMeta>();
    for (const note of activeNotes) {
      const alias = normalizeAlias(note.title || "untitled");
      if (!map.has(alias)) map.set(alias, note);
    }
    return map;
  }, [activeNotes]);

  const mentionState = useMemo(() => {
    const match = input.match(/(?:^|\s)([@#])([a-zA-Z0-9_\-.]*)$/);
    if (!match) return null;
    const trigger = match[1] as "@" | "#";
    const query = (match[2] ?? "").toLowerCase();
    const options = activeNotes
      .filter((note) => note.kind !== "category")
      .filter((note) => !query || note.title.toLowerCase().includes(query) || normalizeAlias(note.title).includes(query))
      .slice(0, 8);
    return { trigger, options };
  }, [activeNotes, input]);

  const loadCredentials = async () => {
    if (!runtime) return;
    const rows = await runtime.ai.listCredentials();
    setCredentials(rows);
    if (!credentialId && rows[0]) setCredentialId(rows[0].id);
  };

  useEffect(() => {
    void loadCredentials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime]);

  useEffect(() => {
    if (!busy) {
      setThinkingStep(0);
      return;
    }
    const id = setInterval(() => {
      setThinkingStep((current) => (current + 1) % 4);
    }, 380);
    return () => clearInterval(id);
  }, [busy]);

  const resolveNoteContent = async (noteId: string): Promise<string> => {
    if (!runtime || !workspaceId) return "";

    try {
      if (syncEngine) {
        const session = syncEngine.getOrCreateSession(noteId);
        await session.persistence.whenSynced;
        const fromV2 = extractTextFromXmlElement(session.doc.getXmlElement("root-v2"));
        if (fromV2) return fromV2;
      }
    } catch {
      // fallback below
    }

    try {
      const state = await runtime.notes.getDocState(workspaceId, noteId);
      const doc = new Y.Doc();
      if (state?.snapshotB64) {
        Y.applyUpdate(doc, decodeBase64ToUint8(state.snapshotB64));
      }
      for (const update of state?.updates ?? []) {
        if (!update?.updateB64) continue;
        Y.applyUpdate(doc, decodeBase64ToUint8(update.updateB64));
      }
      return extractTextFromXmlElement(doc.getXmlElement("root-v2"));
    } catch {
      return "";
    }
  };

  const resolveMentionAttachments = (prompt: string): NoteAttachment[] => {
    const tokens = [...prompt.matchAll(/[@#]([a-zA-Z0-9_\-.]+)/g)].map((entry) => entry[1]);
    const found: NoteAttachment[] = [];
    const seen = new Set<string>();
    for (const token of tokens) {
      const note = notesByAlias.get(normalizeAlias(token));
      if (!note || seen.has(note.id)) continue;
      seen.add(note.id);
      found.push({ id: note.id, title: note.title || "Untitled" });
    }
    return found;
  };

  const buildNotesIndex = async (limit = 420) => {
    return Promise.all(
      activeNotes.slice(0, limit).map(async (note) => ({
        id: note.id,
        title: note.title,
        alias: normalizeAlias(note.title || "untitled"),
        tags: note.tags,
        kind: note.kind,
        preview: (await resolveNoteContent(note.id)).slice(0, 8000),
      }))
    );
  };

  const persistNoteContent = async (
    noteId: string,
    content: string,
    mode: "append" | "replace"
  ): Promise<{ ok: boolean; reason?: string }> => {
    if (!runtime || !workspaceId) return { ok: false, reason: "Runtime unavailable" };
    const trimmed = content.trim();
    if (!trimmed) return { ok: false, reason: "Empty content" };

    try {
      // Build authoritative document snapshot from backend state.
      const state = await runtime.notes.getDocState(workspaceId, noteId);
      const baseDoc = new Y.Doc();
      if (state?.snapshotB64) {
        Y.applyUpdate(baseDoc, decodeBase64ToUint8(state.snapshotB64));
      }
      for (const update of state?.updates ?? []) {
        if (update?.updateB64) {
          Y.applyUpdate(baseDoc, decodeBase64ToUint8(update.updateB64));
        }
      }

      baseDoc.transact(() => {
        writeContentToDoc(baseDoc, trimmed, mode);
      }, "ai-tool");

      const update = Y.encodeStateAsUpdate(baseDoc);
      await runtime.notes.applyCrdtUpdates(workspaceId, noteId, `ai-tool:${safeId()}`, [
        {
          idempotencyKey: `ai-tool:${workspaceId}:${noteId}:${safeId()}`,
          clientSeq: 1,
          updateB64: encodeUint8ToBase64(update),
        },
      ]);

      // Keep active editor session consistent when open.
      if (syncEngine) {
        try {
          const session = syncEngine.getOrCreateSession(noteId);
          Y.applyUpdate(session.doc, update, "remote");
        } catch {
          // best effort
        }
      }

      // Read-after-write verification.
      const verified = await resolveNoteContent(noteId);
      const probe = trimmed.slice(0, Math.min(80, trimmed.length));
      if (!verified || !verified.includes(probe)) {
        return { ok: false, reason: "Verification failed after note write" };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  };

  const executeTools = async (
    toolCalls: Array<{ name: string; arguments?: Record<string, any> }>,
    userPrompt: string,
    runState: RunState
  ): Promise<Array<{ name: string; result: any }>> => {
    if (!runtime || !workspaceId || !userId) {
      return toolCalls.map((tool) => ({ name: tool.name, result: { error: "Runtime unavailable" } }));
    }

    const normalizeSnapshot = (row: any): NoteSnapshot => ({
      id: String(row?.id ?? ""),
      title: String(row?.title ?? "Untitled"),
      tags: Array.isArray(row?.tags) ? row.tags.map((entry: unknown) => String(entry)) : [],
      kind: String(row?.kind ?? "note"),
      deletedAt: (row?.deletedAt ?? row?.deleted_at ?? null) as string | null,
      isArchived: !!(row?.isArchived ?? row?.is_archived),
    });

    let liveNotes = ((await runtime.notes.list(workspaceId)) ?? []).map(normalizeSnapshot);

    const findNote = (noteId?: string | null, noteTitle?: string | null): NoteSnapshot | null => {
      if (noteId) {
        const byId = liveNotes.find((entry) => entry.id === noteId && !entry.deletedAt && !entry.isArchived);
        if (byId) return byId;
      }
      if (noteTitle) {
        const alias = normalizeAlias(noteTitle);
        const byTitle = liveNotes.find(
          (entry) => !entry.deletedAt && !entry.isArchived && normalizeAlias(entry.title) === alias
        );
        if (byTitle) return byTitle;
      }
      if (runState.lastCreatedNoteId) {
        return (
          liveNotes.find((entry) => entry.id === runState.lastCreatedNoteId && !entry.deletedAt && !entry.isArchived) ??
          null
        );
      }
      return null;
    };

    let tasksBundle = await runtime.tasks.list(workspaceId);
    let activeTasks = (tasksBundle?.tasks ?? []).filter((task: any) => !task?.deletedAt && !task?.deleted_at);
    let activeStates = (tasksBundle?.states ?? []).filter((state: any) => !state?.deletedAt && !state?.deleted_at);
    let activeProjects = (tasksBundle?.projects ?? []).filter((project: any) => !project?.deletedAt && !project?.deleted_at);

    const ensureTaskProjectAndStates = async () => {
      if (activeProjects.length > 0 && activeStates.length > 0) return;
      const createdAt = nowIso();
      const defaultProjectId = safeId();
      if (activeProjects.length === 0) {
        await runtime.tasks.upsertProject({
          id: defaultProjectId,
          workspaceId,
          ownerId: userId,
          name: "General",
          description: "",
          position: initialPosition(),
          createdAt,
          updatedAt: createdAt,
          deletedAt: null,
        });
      }
      const projectId = activeProjects[0]?.id ?? defaultProjectId;
      if (activeStates.length === 0) {
        await Promise.all([
          runtime.tasks.upsertState({
            id: safeId(),
            workspaceId,
            ownerId: userId,
            projectId,
            name: "ToDo",
            kind: "todo",
            icon: "◯",
            color: "#C9CED6",
            position: "todo-01",
            createdAt,
            updatedAt: createdAt,
            deletedAt: null,
          }),
          runtime.tasks.upsertState({
            id: safeId(),
            workspaceId,
            ownerId: userId,
            projectId,
            name: "In Progress",
            kind: "in_progress",
            icon: "◔",
            color: "#F5A524",
            position: "in_progress-02",
            createdAt,
            updatedAt: createdAt,
            deletedAt: null,
          }),
          runtime.tasks.upsertState({
            id: safeId(),
            workspaceId,
            ownerId: userId,
            projectId,
            name: "Done",
            kind: "done",
            icon: "◉",
            color: "#2DD4BF",
            position: "done-03",
            createdAt,
            updatedAt: createdAt,
            deletedAt: null,
          }),
        ]);
      }
      tasksBundle = await runtime.tasks.list(workspaceId);
      activeTasks = (tasksBundle?.tasks ?? []).filter((task: any) => !task?.deletedAt && !task?.deleted_at);
      activeStates = (tasksBundle?.states ?? []).filter((state: any) => !state?.deletedAt && !state?.deleted_at);
      activeProjects = (tasksBundle?.projects ?? []).filter((project: any) => !project?.deletedAt && !project?.deleted_at);
    };

    const results: Array<{ name: string; result: any }> = [];

    for (const call of toolCalls) {
      const args = call.arguments ?? {};
      try {
        if (call.name === "search_notes") {
          const query = String(args.query ?? "").toLowerCase().trim();
          const limit = Math.max(1, Math.min(30, Number(args.limit ?? 10)));
          const filtered = liveNotes
            .filter((note) => note.kind !== "category" && !note.deletedAt && !note.isArchived)
            .filter((note) => !query || note.title.toLowerCase().includes(query) || note.tags.some((tag) => tag.toLowerCase().includes(query)))
            .slice(0, limit)
            .map((note) => ({ id: note.id, title: note.title, tags: note.tags, kind: note.kind }));
          results.push({ name: call.name, result: filtered });
          continue;
        }

        if (call.name === "read_note") {
          const target = findNote(typeof args.noteId === "string" ? args.noteId : null, typeof args.noteTitle === "string" ? args.noteTitle : null);
          if (!target) {
            results.push({ name: call.name, result: { error: "Note not found" } });
            continue;
          }
          const content = await resolveNoteContent(target.id);
          results.push({ name: call.name, result: { id: target.id, title: target.title, tags: target.tags, content } });
          continue;
        }

        if (call.name === "create_note" || call.name === "create_note_with_content") {
          const title = String(args.title ?? "").trim();
          const normalizedTitle = title.toLowerCase().trim();
          const explicitMulti = /multiple notes|few notes|several notes|many notes|create \d+ notes/i.test(userPrompt);

          if (!normalizedTitle || normalizedTitle === "new note" || normalizedTitle.length < 3) {
            results.push({ name: call.name, result: { error: "Rejected create_note due to empty/generic title" } });
            continue;
          }

          const signature = JSON.stringify({ title: normalizedTitle, kind: args.kind ?? "note", parentId: args.parentId ?? null });
          if (runState.createSignatures.has(signature)) {
            results.push({ name: call.name, result: { error: "Rejected duplicate create_note in same run" } });
            continue;
          }
          if (!explicitMulti && runState.createdNotesInRun >= 1) {
            results.push({ name: call.name, result: { error: "Rejected extra create_note; only one note allowed for this request" } });
            continue;
          }

          const kind = args.kind === "folder" || args.kind === "note" || args.kind === "category" ? args.kind : "note";
          const parentId = typeof args.parentId === "string" ? args.parentId : null;
          const createdId = await onCreateNote(parentId, kind);
          if (!createdId) {
            results.push({ name: call.name, result: { error: "Failed to create note" } });
            continue;
          }

          runState.createdNotesInRun += 1;
          runState.createSignatures.add(signature);
          runState.lastCreatedNoteId = createdId;
          liveNotes = ((await runtime.notes.list(workspaceId)) ?? []).map(normalizeSnapshot);
          let renameWarning: string | null = null;
          try {
            await onUpdateTitle(createdId, title);
          } catch (error) {
            renameWarning = error instanceof Error ? error.message : String(error);
          }
          liveNotes = ((await runtime.notes.list(workspaceId)) ?? []).map(normalizeSnapshot);
          const renamedRow = liveNotes.find((entry) => entry.id === createdId);
          if (!renamedRow || renamedRow.title !== title) {
            renameWarning = renameWarning ?? "Title update did not persist";
          }

          if (call.name === "create_note_with_content") {
            const content = String(args.content ?? "").trim();
            if (!content) {
              results.push({ name: call.name, result: { error: "create_note_with_content requires non-empty content", id: createdId } });
              continue;
            }
            const write = await persistNoteContent(createdId, content, "replace");
            if (!write.ok) {
              runState.noteWriteFailures.push(`create_note_with_content(${createdId}): ${write.reason ?? "Failed to write note content"}`);
              results.push({ name: call.name, result: { error: write.reason ?? "Failed to write note content", id: createdId } });
              continue;
            }
            runState.noteWritesInRun += 1;
            results.push({
              name: call.name,
              result: {
                id: createdId,
                title,
                kind,
                contentWritten: content.length,
                verified: true,
                partialFailure: renameWarning ? { renameWarning } : null,
              },
            });
            continue;
          }

          results.push({
            name: call.name,
            result: {
              id: createdId,
              title,
              kind,
              partialFailure: renameWarning ? { renameWarning } : null,
            },
          });
          continue;
        }

        if (call.name === "update_note_content" || call.name === "append_note") {
          const target = findNote(typeof args.noteId === "string" ? args.noteId : null, typeof args.noteTitle === "string" ? args.noteTitle : null);
          const content = String(args.content ?? "").trim();
          if (!target || !content) {
            results.push({ name: call.name, result: { error: "Missing note or content" } });
            continue;
          }

          const mode = call.name === "append_note" ? "append" : args.mode === "append" ? "append" : "replace";
          const write = await persistNoteContent(target.id, content, mode);
          if (!write.ok) {
            runState.noteWriteFailures.push(`${call.name}(${target.id}): ${write.reason ?? "Failed to write note content"}`);
            results.push({ name: call.name, result: { error: write.reason ?? "Failed to write note content", id: target.id } });
            continue;
          }
          runState.noteWritesInRun += 1;
          results.push({ name: call.name, result: { id: target.id, mode, writtenChars: content.length, verified: true } });
          continue;
        }

        if (call.name === "list_tasks") {
          const query = String(args.query ?? "").toLowerCase().trim();
          const stateKind = String(args.stateKind ?? "").toLowerCase().trim();
          const tag = String(args.tag ?? "").toLowerCase().trim();
          const limit = Math.max(1, Math.min(80, Number(args.limit ?? 40)));
          const filtered = activeTasks
            .filter((task: any) => {
              const title = String(task.title ?? "").toLowerCase();
              const description = String(task.description ?? "").toLowerCase();
              const tags = Array.isArray(task.tags) ? task.tags.map((entry: any) => String(entry).toLowerCase()) : [];
              const state = activeStates.find((entry: any) => entry.id === (task.stateId ?? task.state_id));
              if (query && !title.includes(query) && !description.includes(query) && !tags.some((entry: string) => entry.includes(query))) return false;
              if (tag && !tags.includes(tag)) return false;
              if (stateKind && String(state?.kind ?? "").toLowerCase() !== stateKind) return false;
              return true;
            })
            .slice(0, limit)
            .map((task: any) => {
              const state = activeStates.find((entry: any) => entry.id === (task.stateId ?? task.state_id));
              return {
                id: task.id,
                title: task.title,
                description: task.description,
                tags: task.tags ?? [],
                priority: task.priority,
                dueDate: task.dueDate ?? task.due_date ?? null,
                stateKind: state?.kind ?? null,
              };
            });
          results.push({ name: call.name, result: filtered });
          continue;
        }

        if (call.name === "create_task" || call.name === "create_tasks") {
          await ensureTaskProjectAndStates();

          const entries = call.name === "create_tasks"
            ? Array.isArray(args.tasks) ? args.tasks : []
            : [args];

          if (entries.length === 0) {
            results.push({ name: call.name, result: { error: "No tasks provided" } });
            continue;
          }

          const created: Array<{ id: string; title: string; projectId: string; stateId: string; priority: number }> = [];
          const failures: Array<{ index: number; reason: string }> = [];

          for (let index = 0; index < entries.length; index += 1) {
            const entry = entries[index] ?? {};
            const title = String(entry.title ?? "").trim();
            if (!title) {
              failures.push({ index, reason: "Task title is required" });
              continue;
            }

            const selectedProjectId =
              (typeof entry.projectId === "string" && activeProjects.some((item: any) => item.id === entry.projectId)
                ? entry.projectId
                : activeProjects[0]?.id) ?? null;
            if (!selectedProjectId) {
              failures.push({ index, reason: "No project available" });
              continue;
            }

            const stateKind = normalizeStateKind(entry.stateKind ?? "todo");
            const stateId =
              activeStates.find((item: any) => item.projectId === selectedProjectId && normalizeStateKind(item.kind) === stateKind)?.id ??
              activeStates.find((item: any) => item.projectId === selectedProjectId && normalizeStateKind(item.kind) === "todo")?.id ??
              activeStates.find((item: any) => item.projectId === selectedProjectId)?.id;

            if (!stateId) {
              failures.push({ index, reason: "No workflow state available" });
              continue;
            }

            const siblings = activeTasks
              .filter((task: any) => (task.projectId ?? task.project_id) === selectedProjectId)
              .sort((a: any, b: any) => String(a.position ?? "").localeCompare(String(b.position ?? "")));
            const position = siblings.length
              ? generatePosition(String(siblings[siblings.length - 1]?.position ?? ""), null)
              : initialPosition();

            const createdAt = nowIso();
            const tags = Array.isArray(entry.tags)
              ? entry.tags.map((value: unknown) => String(value).trim()).filter(Boolean)
              : [];
            const dueDate = entry.dueDate ? String(entry.dueDate) : null;
            const priority = normalizePriority(entry.priority);

            const task = await runtime.tasks.upsertItem({
              id: safeId(),
              workspaceId,
              ownerId: userId,
              projectId: selectedProjectId,
              parentTaskId: null,
              stateId,
              assigneeId: null,
              title,
              description: String(entry.description ?? ""),
              tags,
              priority,
              dueDate,
              position,
              createdAt,
              updatedAt: createdAt,
              deletedAt: null,
            });

            const createdId = String(task?.id ?? "");
            if (!createdId) {
              failures.push({ index, reason: "Task write returned empty id" });
              continue;
            }
            created.push({ id: createdId, title, projectId: selectedProjectId, stateId, priority });
            activeTasks = [...activeTasks, task];
          }

          // Read-after-write verification from source of truth.
          const verifyBundle = await runtime.tasks.list(workspaceId);
          const verifyTasks = (verifyBundle?.tasks ?? []).filter((task: any) => !task?.deletedAt && !task?.deleted_at);
          const verified: typeof created = [];
          for (const item of created) {
            const present = verifyTasks.some((task: any) => String(task?.id ?? "") === item.id);
            if (present) {
              verified.push(item);
              runState.taskWritesInRun += 1;
            } else {
              const reason = `Task ${item.title} (${item.id}) missing after verification`;
              failures.push({ index: -1, reason });
              runState.taskWriteFailures.push(reason);
            }
          }

          if (call.name === "create_task") {
            if (verified[0]) {
              results.push({ name: call.name, result: { ...verified[0], failures } });
            } else {
              const reason = failures[0]?.reason ?? "Failed to create task";
              runState.taskWriteFailures.push(reason);
              results.push({ name: call.name, result: { error: reason } });
            }
          } else {
            if (verified.length === 0 && failures.length > 0) {
              runState.taskWriteFailures.push(`create_tasks failed: ${failures.map((entry) => entry.reason).join("; ")}`);
            }
            results.push({ name: call.name, result: { created: verified, failures } });
          }
          continue;
        }

        results.push({ name: call.name, result: { error: `Unknown tool: ${call.name}` } });
      } catch (toolError) {
        results.push({
          name: call.name,
          result: { error: toolError instanceof Error ? toolError.message : String(toolError) },
        });
      }
    }

    return results;
  };

  const runAgent = async (prompt: string, attached: NoteAttachment[], signal: AbortSignal) => {
    if (!runtime || !workspaceId || !userId) {
      throw new Error("Runtime unavailable");
    }
    if (!credentialId) {
      throw new Error("No AI credential selected. Save one in Settings > AI first.");
    }

    const selectedCredential = await runtime.ai.getCredential(credentialId);
    const notesIndex = await buildNotesIndex(420);
    const attachedNotes = await Promise.all(
      attached.map(async (item) => {
        const note = activeNotes.find((entry) => entry.id === item.id);
        return {
          id: item.id,
          title: item.title,
          tags: note?.tags ?? [],
          content: await resolveNoteContent(item.id),
        };
      })
    );

    const systemPrompt = `You are Moduo Agent. You can plan and execute work using tools.
Return strict JSON only.
Shape:
{ "type": "tool_calls", "tool_calls": [{ "name": string, "arguments": object }] }
or
{ "type": "final", "content": string }

Rules:
- Never create more than one note unless user explicitly asks for multiple.
- Never create a note with generic title like "New Note".
- If user asks to create a note and put content inside, call create_note_with_content in one step.
- If user asks to modify existing note content, call update_note_content.
- If user request implies writing note content, do not return final answer before successful write tool result.
- For note content tool args, use Markdown formatting (headings, lists, code blocks, quotes) when helpful.

Tools:
- search_notes({ query?: string, limit?: number })
- read_note({ noteId?: string, noteTitle?: string })
- create_note({ title: string, kind?: "note"|"folder"|"category", parentId?: string })
- create_note_with_content({ title: string, content: string, kind?: "note"|"folder"|"category", parentId?: string })
- update_note_content({ noteId?: string, noteTitle?: string, content: string, mode?: "replace"|"append" })
- append_note({ noteId?: string, noteTitle?: string, content: string })
- list_tasks({ query?: string, stateKind?: string, tag?: string, limit?: number })
- create_task({ title: string, description?: string, priority?: number, tags?: string[], stateKind?: string, projectId?: string, dueDate?: string })
- create_tasks({ tasks: Array<{ title: string, description?: string, priority?: number|string, tags?: string[], stateKind?: string, projectId?: string, dueDate?: string }> })

If user asks for Mermaid roadmap/graph, final content should be only a mermaid code block.`;

    const conversation: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify({ userPrompt: prompt, attachedNotes, notesIndex }, null, 2),
      },
    ];

    const runState: RunState = {
      lastCreatedNoteId: null,
      createdNotesInRun: 0,
      createSignatures: new Set<string>(),
      noteWritesInRun: 0,
      noteWriteFailures: [],
      taskWritesInRun: 0,
      taskWriteFailures: [],
    };

    const requiresNoteWrite = /\bcreate\s+new\s+note\b|\bcreate\s+note\b|\binsert\b.*\bnote\b|\bput\b.*\bnote\b|\bupdate\b.*\bnote\b|\bappend\b.*\bnote\b/i.test(prompt);
    const requiresTaskWrite = /\bcreate\s+task\b|\bcreate\s+tasks\b|\badd\s+tasks?\b|\bgenerate\s+tasks?\b|\bassign\s+priorit/i.test(prompt);

    for (let i = 0; i < 8; i += 1) {
      if (signal.aborted) {
        throw new Error("Cancelled");
      }

      const raw = await openRouterChat(selectedCredential.apiKey, selectedCredential.model, conversation, signal);
      const parsed = parseJsonResponse(raw);

      if (!parsed || typeof parsed !== "object" || !parsed.type) {
        return raw;
      }

      if (parsed.type === "final" && typeof parsed.content === "string") {
        if (requiresNoteWrite) {
          if (runState.noteWriteFailures.length > 0 || runState.noteWritesInRun === 0) {
            const details = runState.noteWriteFailures.length
              ? runState.noteWriteFailures.map((entry) => `- ${entry}`).join("\n")
              : "- No successful note write was confirmed.";
            return `Failed to persist note content.\n\nDetails:\n${details}\n\nModel summary (uncommitted):\n${parsed.content}`;
          }
        }
        if (requiresTaskWrite) {
          if (runState.taskWriteFailures.length > 0 || runState.taskWritesInRun === 0) {
            const details = runState.taskWriteFailures.length
              ? runState.taskWriteFailures.map((entry) => `- ${entry}`).join("\n")
              : "- No successful task creation was confirmed.";
            return `Failed to persist task updates.\n\nDetails:\n${details}\n\nModel summary (uncommitted):\n${parsed.content}`;
          }
        }
        return parsed.content;
      }

      if (parsed.type === "tool_calls" && Array.isArray(parsed.tool_calls)) {
        const toolResults = await executeTools(parsed.tool_calls, prompt, runState);
        const failed = toolResults.some((entry) => entry?.result?.error);
        conversation.push({ role: "assistant", content: JSON.stringify(parsed) });
        conversation.push({ role: "user", content: JSON.stringify({ toolResults }) });
        if (failed) {
          conversation.push({
            role: "user",
            content: "Some tool calls failed. Produce final answer now and do not retry the same failing tool call repeatedly.",
          });
        }
        continue;
      }

      return raw;
    }

    if (requiresNoteWrite && (runState.noteWriteFailures.length > 0 || runState.noteWritesInRun === 0)) {
      const details = runState.noteWriteFailures.length
        ? runState.noteWriteFailures.map((entry) => `- ${entry}`).join("\n")
        : "- No successful note write was confirmed.";
      return `Failed to persist note content before timeout.\n\nDetails:\n${details}`;
    }
    if (requiresTaskWrite && (runState.taskWriteFailures.length > 0 || runState.taskWritesInRun === 0)) {
      const details = runState.taskWriteFailures.length
        ? runState.taskWriteFailures.map((entry) => `- ${entry}`).join("\n")
        : "- No successful task creation was confirmed.";
      return `Failed to persist task updates before timeout.\n\nDetails:\n${details}`;
    }
    return "I could not finish the tool run in time.";
  };

  const onAttachNote = (note: NoteMeta) => {
    setAttachments((current) => {
      if (current.some((entry) => entry.id === note.id)) return current;
      return [...current, { id: note.id, title: note.title || "Untitled" }];
    });

    setInput((current) => current.replace(/(?:^|\s)[@#][a-zA-Z0-9_\-.]*$/, " ").replace(/\s{2,}/g, " "));
  };

  const submit = async () => {
    const prompt = input.trim();
    if (!prompt || busy) return;

    const implicitAttachments = resolveMentionAttachments(prompt);
    const mergedAttachments = [...attachments];
    for (const candidate of implicitAttachments) {
      if (!mergedAttachments.some((entry) => entry.id === candidate.id)) {
        mergedAttachments.push(candidate);
      }
    }

    setMessages((current) => [...current, { id: safeId(), role: "user", content: prompt }]);
    setInput("");
    setError(null);
    setBusy(true);
    const controller = new AbortController();
    setRunController(controller);

    try {
      const content = await runAgent(prompt, mergedAttachments, controller.signal);
      setMessages((current) => [...current, { id: safeId(), role: "assistant", content }]);
      setAttachments([]);
      window.dispatchEvent(new Event("moduo:data-refresh"));
    } catch (submitError) {
      const abortLike =
        (submitError instanceof DOMException && submitError.name === "AbortError") ||
        (submitError instanceof Error && submitError.message === "Cancelled");
      const message = submitError instanceof Error ? submitError.message : String(submitError);
      if (abortLike) {
        setMessages((current) => [...current, { id: safeId(), role: "assistant", content: "Stopped." }]);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
      setRunController(null);
    }
  };

  const stopRun = () => {
    runController?.abort();
  };

  return (
    <aside className="grid min-h-0 grid-rows-[auto_1fr_auto] rounded-[14px] bg-[#111111] p-3">
      <div className="mb-2 grid gap-2">
        <div className="flex items-center justify-between">
          <div className="text-[12px] uppercase tracking-[0.06em] text-[#8a8a8a]">AI Chat</div>
          <button
            type="button"
            className="rounded-md border border-[#2a2a2a] bg-[#171717] px-2 py-1 text-[11px] text-[#d2d2d2] hover:bg-[#1d1d1d]"
            onClick={() => void loadCredentials()}
          >
            Refresh creds
          </button>
        </div>
        <select
          value={credentialId}
          onChange={(event) => setCredentialId(event.target.value)}
          onFocus={() => void loadCredentials()}
          className="h-9 rounded-lg border border-[#2b2b2b] bg-[#0f0f0f] px-2 text-[12px] text-[#e7e7e7] outline-none"
        >
          <option value="">Select model credentials...</option>
          {credentials.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.model} ({entry.keyPreview})
            </option>
          ))}
        </select>
      </div>

      <div className="min-h-0 overflow-y-auto rounded-lg border border-[#1f1f1f] bg-[#0f0f0f] p-2">
        {messages.length === 0 ? (
          <div className="text-[12px] text-[#7f7f7f]">
            Use @ or # to attach notes. Example: based on @architecture_plan create a step-by-step note, then add tasks.
          </div>
        ) : (
          <div className="grid gap-2">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`rounded-lg px-3 py-2 text-[12px] leading-relaxed ${message.role === "user" ? "bg-[#1a1a1a] text-[#ebebeb]" : "bg-[#141414] text-[#cbcbcb]"}`}
              >
                <div className="mb-1 text-[10px] uppercase tracking-[0.05em] text-[#7f7f7f]">
                  {message.role === "user" ? "You" : "Agent"}
                </div>
                <div className="whitespace-pre-wrap">{message.content}</div>
              </div>
            ))}
          </div>
        )}
        {busy ? (
          <div className="mt-2 rounded-lg bg-[#141414] px-3 py-2 text-[12px] text-[#bdbdbd]">
            <div className="mb-1 text-[10px] uppercase tracking-[0.05em] text-[#7f7f7f]">Agent</div>
            <div className="whitespace-pre-wrap">Thinking{".".repeat(thinkingStep)}</div>
          </div>
        ) : null}
      </div>

      <div className="mt-2 grid gap-2">
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {attachments.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="rounded-full border border-[#2a2a2a] bg-[#181818] px-2 py-0.5 text-[11px] text-[#b9b9b9]"
                onClick={() => setAttachments((current) => current.filter((item) => item.id !== entry.id))}
              >
                @{normalizeAlias(entry.title)} ×
              </button>
            ))}
          </div>
        ) : null}

        {mentionState && mentionState.options.length > 0 ? (
          <div className="max-h-28 overflow-y-auto rounded-lg border border-[#2a2a2a] bg-[#121212] p-1">
            {mentionState.options.map((note) => (
              <button
                key={note.id}
                type="button"
                className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[11px] text-[#d6d6d6] hover:bg-[#1b1b1b]"
                onClick={() => onAttachNote(note)}
              >
                <span className="truncate">{note.title || "Untitled"}</span>
                <span className="text-[#7f7f7f]">{mentionState.trigger}{normalizeAlias(note.title || "untitled")}</span>
              </button>
            ))}
          </div>
        ) : null}

        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="Ask OR Call anything.."
          className="min-h-20 w-full resize-y rounded-lg border border-[#2b2b2b] bg-[#0f0f0f] px-3 py-2 text-[12px] text-[#ececec] outline-none"
        />

        <div className="flex items-center justify-between">
          <div className="text-[11px] text-[#7f7f7f]">{busy ? "Running - press Stop to cancel" : "Enter to send"}</div>
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${busy ? "bg-[#8c2b2b] text-[#f7e8e8] hover:bg-[#a53131]" : "bg-[#f0f0f0] text-[#111111] hover:bg-[#ffffff]"}`}
            onClick={() => {
              if (busy) {
                stopRun();
                return;
              }
              void submit();
            }}
          >
            {busy ? "Stop" : "Send"}
          </button>
        </div>

        {error ? <div className="text-[11px] text-[#ff9d9d]">{error}</div> : null}
      </div>
    </aside>
  );
}
