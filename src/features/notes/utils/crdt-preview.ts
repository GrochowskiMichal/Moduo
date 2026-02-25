import * as Y from "yjs";
import { decodeBase64ToUint8 } from "./base64";

type NoteCrdtUpdateLike = {
  updateB64?: string;
  update_b64?: string;
};

type NoteDocStateLike = {
  snapshotB64?: string;
  snapshot_b64?: string;
  updates?: NoteCrdtUpdateLike[];
};

function applyUpdateSafe(doc: Y.Doc, updateB64: string | undefined) {
  if (!updateB64) return;
  try {
    Y.applyUpdate(doc, decodeBase64ToUint8(updateB64));
  } catch {
    // Ignore malformed update chunks and continue extracting from valid ones.
  }
}

function normalizePreview(text: string, maxChars: number): string {
  return text.replace(/\uFFFC/g, "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxChars);
}

function extractFromXmlElement(node: Y.XmlElement): string {
  const parts: string[] = [];
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlElement) {
      const chunk = extractFromXmlElement(child);
      if (chunk) parts.push(chunk);
      if (child.nodeName === "paragraph" || child.nodeName === "quote" || child.nodeName === "heading" || child.nodeName === "listitem") {
        parts.push("\n");
      }
      continue;
    }
    if (child instanceof Y.XmlText) {
      const chunk = extractFromXmlText(child);
      if (chunk) parts.push(chunk);
      continue;
    }
  }
  return parts.join("");
}

function extractFromXmlText(node: Y.XmlText): string {
  const parts: string[] = [];
  for (const op of node.toDelta()) {
    const value = op.insert as unknown;
    if (typeof value === "string") {
      parts.push(value);
      continue;
    }
    if (value instanceof Y.XmlElement) {
      const chunk = extractFromXmlElement(value);
      if (chunk) parts.push(chunk);
      continue;
    }
    if (value instanceof Y.XmlText) {
      const chunk = extractFromXmlText(value);
      if (chunk) parts.push(chunk);
      continue;
    }
    if (value instanceof Y.Map) {
      const type = value.get("__type");
      if (type === "linebreak") {
        parts.push("\n");
        continue;
      }
      const text = value.get("__text");
      if (typeof text === "string" && text.length > 0) parts.push(text);
    }
  }
  return parts.join("");
}

export function extractNotePreviewFromDocState(state: NoteDocStateLike, maxChars = 3000): string {
  const doc = new Y.Doc();
  applyUpdateSafe(doc, state.snapshotB64 ?? state.snapshot_b64);
  for (const update of state.updates ?? []) {
    applyUpdateSafe(doc, update.updateB64 ?? update.update_b64);
  }

  const rootV2 = doc.share.get("root-v2");
  if (rootV2 instanceof Y.XmlElement) {
    const fromV2 = normalizePreview(extractFromXmlElement(rootV2), maxChars);
    if (fromV2) return fromV2;
    const fallbackV2 = normalizePreview(rootV2.toString().replace(/<[^>]*>/g, " "), maxChars);
    if (fallbackV2) return fallbackV2;
  }

  const root = doc.share.get("root");
  if (root instanceof Y.XmlText) {
    const fromV1 = normalizePreview(extractFromXmlText(root), maxChars);
    if (fromV1) return fromV1;
    const fallbackV1 = normalizePreview(root.toString(), maxChars);
    if (fallbackV1) return fallbackV1;
  }

  return "";
}
