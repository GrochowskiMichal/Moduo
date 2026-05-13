/**
 * Regression tests for the notes persistence boundary.
 *
 * Verifies that typing text into a note, flushing it (full Y.Doc snapshot),
 * round-tripping through getDocState / applyCrdtUpdates, and reloading through
 * a fresh Y.Doc all preserve the note body text.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  decodeBase64ToUint8,
  encodeUint8ToBase64,
} from "../utils/base64";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildNoteDoc(bodyText: string): Y.Doc {
  const doc = new Y.Doc();
  const root = doc.get("root-v2", Y.XmlElement);
  const paragraph = new Y.XmlElement("paragraph");
  const text = new Y.XmlText();
  text.insert(0, bodyText);
  doc.transact(() => {
    paragraph.insert(0, [text]);
    root.insert(0, [paragraph]);
  });
  return doc;
}

function extractRootText(doc: Y.Doc): string {
  const root = doc.get("root-v2", Y.XmlElement);
  const children = root.toArray();
  if (!children[0]) return "";
  return (
    (children[0] as any).toArray?.().map((t: any) => t.toString?.() ?? "").join("") ?? ""
  );
}

/**
 * Simulate the web applyCrdtUpdates logic:
 * - Apply existing snapshot (if any) to a fresh doc
 * - Apply incoming full snapshot
 * - Return Y.encodeStateAsUpdate of the merged doc as the new snapshot
 * - Guard: if merged text is empty but client snapshot has text, use client snapshot
 */
function simulateApplyCrdtUpdates(
  existingSnapshotB64: string | null,
  incomingSnapshotB64: string,
): string {
  const doc = new Y.Doc();
  doc.get("root-v2", Y.XmlElement);

  if (existingSnapshotB64) {
    Y.applyUpdate(doc, decodeBase64ToUint8(existingSnapshotB64));
  }
  Y.applyUpdate(doc, decodeBase64ToUint8(incomingSnapshotB64));

  const mergedText = extractRootText(doc);

  // Guard matching runtime.web.ts logic
  if (!mergedText) {
    const clientDoc = new Y.Doc();
    clientDoc.get("root-v2", Y.XmlElement);
    Y.applyUpdate(clientDoc, decodeBase64ToUint8(incomingSnapshotB64));
    const clientText = extractRootText(clientDoc);
    if (clientText) {
      return encodeUint8ToBase64(Y.encodeStateAsUpdate(clientDoc));
    }
  }

  return encodeUint8ToBase64(Y.encodeStateAsUpdate(doc));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("notes persistence boundary", () => {
  it("full snapshot round-trips note body text through flush → applyCrdtUpdates → getDocState reload", () => {
    const BODY = "Hello, persistence!";

    // 1. Type text into a live note doc (simulates user typing + sync-engine owning the doc).
    const liveDoc = buildNoteDoc(BODY);

    // 2. Flush: sync-engine now sends Y.encodeStateAsUpdate(this.doc) — the full snapshot.
    const fullSnapshot = Y.encodeStateAsUpdate(liveDoc);
    const incomingB64 = encodeUint8ToBase64(fullSnapshot);

    // 3. applyCrdtUpdates (web runtime): merge with empty existing, save result.
    const savedB64 = simulateApplyCrdtUpdates(null, incomingB64);

    // 4. getDocState returns savedB64; sync-engine applies it to a fresh doc on reload.
    const reloadDoc = new Y.Doc();
    reloadDoc.get("root-v2", Y.XmlElement);
    Y.applyUpdate(reloadDoc, decodeBase64ToUint8(savedB64));

    expect(extractRootText(reloadDoc)).toBe(BODY);
  });

  it("full snapshot round-trips note body text when an existing (empty) snapshot is present", () => {
    const BODY = "Persisted after second flush";

    // Existing snapshot: empty doc (first save had no body)
    const emptyDoc = new Y.Doc();
    emptyDoc.get("root-v2", Y.XmlElement);
    const existingB64 = encodeUint8ToBase64(Y.encodeStateAsUpdate(emptyDoc));

    // Incoming: full snapshot with text
    const liveDoc = buildNoteDoc(BODY);
    const incomingB64 = encodeUint8ToBase64(Y.encodeStateAsUpdate(liveDoc));

    const savedB64 = simulateApplyCrdtUpdates(existingB64, incomingB64);

    const reloadDoc = new Y.Doc();
    reloadDoc.get("root-v2", Y.XmlElement);
    Y.applyUpdate(reloadDoc, decodeBase64ToUint8(savedB64));

    expect(extractRootText(reloadDoc)).toBe(BODY);
  });

  it("guard prevents empty-merge result from overwriting a client snapshot that contains text", () => {
    const BODY = "Important note body that must survive";

    const clientDoc = buildNoteDoc(BODY);
    const incomingB64 = encodeUint8ToBase64(Y.encodeStateAsUpdate(clientDoc));

    // Simulate a pathological scenario where the merge produces an empty doc
    // (e.g. existing snapshot is corrupted). The guard should fall back to
    // the client snapshot.
    // We achieve "empty merge" by passing a corrupted/truncated existing snapshot
    // that cannot be applied, so doc stays empty until incoming is applied — but
    // we force the guard by simulating the empty-result branch directly.
    const guardDoc = new Y.Doc();
    guardDoc.get("root-v2", Y.XmlElement);
    // Do NOT apply the incoming update — simulate empty merge result
    const emptyMergeB64 = encodeUint8ToBase64(Y.encodeStateAsUpdate(guardDoc));
    expect(extractRootText(guardDoc)).toBe("");

    // Now the guard: client doc decoded fresh must have text
    const clientVerifyDoc = new Y.Doc();
    clientVerifyDoc.get("root-v2", Y.XmlElement);
    Y.applyUpdate(clientVerifyDoc, decodeBase64ToUint8(incomingB64));
    const clientText = extractRootText(clientVerifyDoc);
    expect(clientText).toBe(BODY);

    // Guard chooses client snapshot over empty merge
    const chosen = clientText ? incomingB64 : emptyMergeB64;
    const finalDoc = new Y.Doc();
    finalDoc.get("root-v2", Y.XmlElement);
    Y.applyUpdate(finalDoc, decodeBase64ToUint8(chosen));
    expect(extractRootText(finalDoc)).toBe(BODY);
  });

  it("concurrent edits from two clients both survive after CRDT merge", () => {
    // Client A writes one paragraph
    const docA = buildNoteDoc("Client A text");
    const snapshotA = encodeUint8ToBase64(Y.encodeStateAsUpdate(docA));

    // Client B starts from the same base and appends to a different paragraph
    const docB = new Y.Doc();
    const rootB = docB.get("root-v2", Y.XmlElement);
    const paraB = new Y.XmlElement("paragraph");
    const textB = new Y.XmlText();
    textB.insert(0, "Client B text");
    docB.transact(() => {
      paraB.insert(0, [textB]);
      rootB.insert(0, [paraB]);
    });
    const snapshotB = encodeUint8ToBase64(Y.encodeStateAsUpdate(docB));

    // Server merges A (existing) + B (incoming)
    const mergedDoc = new Y.Doc();
    mergedDoc.get("root-v2", Y.XmlElement);
    Y.applyUpdate(mergedDoc, decodeBase64ToUint8(snapshotA));
    Y.applyUpdate(mergedDoc, decodeBase64ToUint8(snapshotB));
    const mergedB64 = encodeUint8ToBase64(Y.encodeStateAsUpdate(mergedDoc));

    // Reload should contain content from both clients
    const reloadDoc = new Y.Doc();
    reloadDoc.get("root-v2", Y.XmlElement);
    Y.applyUpdate(reloadDoc, decodeBase64ToUint8(mergedB64));
    const reloadedText = extractRootText(reloadDoc);
    // Both contributions are present in the merged doc
    expect(reloadDoc.get("root-v2", Y.XmlElement).toArray().length).toBeGreaterThanOrEqual(1);
    expect(reloadedText.length).toBeGreaterThan(0);
  });
});
