/**
 * NR-6 AC11: an agent edit lands in an open note as a real doc change, the
 * next human keystroke keeps it, and Undo removes only the agent's change.
 *
 * "Client" docs here are what a session's engine holds; the agent's update is
 * produced by the connector's own entry point (`agentWriteFromLog`) from the
 * server's view of the doc, then applied the way the engine and the realtime
 * relay apply it: with an `AgentOrigin`.
 */

import { describe, expect, it } from "@rstest/core";
import * as Y from "yjs";
import { agentWriteFromLog, applyAgentEdit } from "../editor/agent-write";
import { deriveNoteBody, NOTES_DOC_ROOT } from "../editor/doc-markdown";
import { buildDocStateFromMarkdown } from "../editor/materialize";
import { decodeBase64ToUint8, encodeUint8ToBase64 } from "../utils/base64";
import { AgentOrigin, createAgentUndo, isForeignOrigin } from "./agent-origin";

const NOTE_ID = "6b1f0c5e-2d3a-4e8f-9a01-7c2b4d6e8f10";

function clientDoc(markdown: string): Y.Doc {
  const doc = new Y.Doc();
  doc.get(NOTES_DOC_ROOT, Y.XmlElement);
  const built = buildDocStateFromMarkdown(NOTE_ID, markdown);
  if (built) Y.applyUpdate(doc, decodeBase64ToUint8(built.docStateB64), "remote");
  return doc;
}

/** What the server would hand the connector: the doc as one snapshot. */
function serverView(doc: Y.Doc) {
  return { snapshotB64: encodeUint8ToBase64(Y.encodeStateAsUpdate(doc)), updatesB64: [] };
}

function agentAppend(doc: Y.Doc, markdown: string): Uint8Array {
  const res = agentWriteFromLog({
    noteId: NOTE_ID,
    ...serverView(doc),
    bodyMd: "",
    edit: { kind: "append", markdown },
  });
  expect(res.updateB64).not.toBeNull();
  return decodeBase64ToUint8(res.updateB64!);
}

/** A local human edit: same headless path, local (null) origin. */
function humanAppend(doc: Y.Doc, markdown: string) {
  applyAgentEdit(doc, { kind: "append", markdown });
}

describe("undo agent only", () => {
  it("lands live, survives the next human edit, and undoes only the agent's text", () => {
    const doc = clientDoc("# Plan\n\nHello there");
    const undo = createAgentUndo(doc);
    expect(undo.canUndo()).toBe(false);

    const update = agentAppend(doc, "Agent wrote **this**");
    Y.applyUpdate(doc, update, new AgentOrigin("key-1", "Research bot"));
    expect(deriveNoteBody(doc).md).toBe("# Plan\n\nHello there\n\nAgent wrote **this**");
    expect(undo.canUndo()).toBe(true);
    expect(undo.last()?.label).toBe("Research bot");

    // The next human keystroke never discards it.
    humanAppend(doc, "Human line");
    expect(deriveNoteBody(doc).md).toBe(
      "# Plan\n\nHello there\n\nAgent wrote **this**\n\nHuman line",
    );
    // Human edits are not on the agent stack.
    undo.undo();
    expect(undo.canUndo()).toBe(false);
    expect(deriveNoteBody(doc).md).toBe("# Plan\n\nHello there\n\nHuman line");
    undo.destroy();
  });

  it("undoes a wholesale replace back to the human text", () => {
    const doc = clientDoc("# Plan\n\nOriginal body");
    const undo = createAgentUndo(doc);
    const res = agentWriteFromLog({
      noteId: NOTE_ID,
      ...serverView(doc),
      bodyMd: "",
      edit: { kind: "replace", markdown: "# Plan\n\nRewritten by the agent" },
    });
    expect(res.bodyMd).toBe("# Plan\n\nRewritten by the agent");
    Y.applyUpdate(doc, decodeBase64ToUint8(res.updateB64!), new AgentOrigin(null, null));
    expect(deriveNoteBody(doc).md).toBe("# Plan\n\nRewritten by the agent");
    undo.undo();
    expect(deriveNoteBody(doc).md).toBe("# Plan\n\nOriginal body");
    undo.destroy();
  });

  it("keeps a peer's concurrent edit when the agent edit is undone", () => {
    const doc = clientDoc("# Plan\n\nHello");
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const undo = createAgentUndo(doc);

    // The agent and a peer write at the same time, from the same base.
    const agentUpdate = agentAppend(doc, "From the agent");
    const before = Y.encodeStateVector(peer);
    humanAppend(peer, "From the peer");
    const peerUpdate = Y.encodeStateAsUpdate(peer, before);

    Y.applyUpdate(doc, agentUpdate, new AgentOrigin("key-1", null));
    Y.applyUpdate(doc, peerUpdate, "remote");
    const merged = deriveNoteBody(doc).md;
    expect(merged).toContain("From the agent");
    expect(merged).toContain("From the peer");

    undo.undo();
    const after = deriveNoteBody(doc).md;
    expect(after).not.toContain("From the agent");
    expect(after).toContain("From the peer");
    expect(after).toContain("Hello");
    undo.destroy();
  });

  it("treats agent-origin updates as foreign, so they are never pushed back", () => {
    const persistence = {};
    expect(isForeignOrigin(new AgentOrigin("k", null), persistence)).toBe(true);
    expect(isForeignOrigin("remote", persistence)).toBe(true);
    expect(isForeignOrigin(persistence, persistence)).toBe(true);
    expect(isForeignOrigin(null, persistence)).toBe(false);
  });
});

describe("agent write from the log", () => {
  it("materializes a body-only note from its markdown before appending", () => {
    const res = agentWriteFromLog({
      noteId: NOTE_ID,
      snapshotB64: null,
      updatesB64: [],
      bodyMd: "# Imported\n\nBody from import",
      edit: { kind: "append", markdown: "- one\n- two" },
    });
    expect(res.bodyMd).toBe("# Imported\n\nBody from import\n\n- one\n- two");
    // A concurrent blank-note sweep seeds the same deterministic bytes, so
    // applying both never duplicates the imported text.
    const doc = new Y.Doc();
    doc.get(NOTES_DOC_ROOT, Y.XmlElement);
    const seed = buildDocStateFromMarkdown(NOTE_ID, "# Imported\n\nBody from import")!;
    Y.applyUpdate(doc, decodeBase64ToUint8(seed.docStateB64));
    Y.applyUpdate(doc, decodeBase64ToUint8(res.updateB64!));
    expect(deriveNoteBody(doc).md).toBe("# Imported\n\nBody from import\n\n- one\n- two");
  });

  it("appends into an empty doc without a stray blank first line", () => {
    const res = agentWriteFromLog({
      noteId: NOTE_ID,
      snapshotB64: null,
      updatesB64: [],
      bodyMd: "",
      edit: { kind: "append", markdown: "First words" },
    });
    expect(res.bodyMd).toBe("First words");
  });
});
