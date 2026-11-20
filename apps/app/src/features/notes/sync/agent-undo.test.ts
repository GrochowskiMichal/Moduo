/**
 * NR-6 AC11: an agent edit lands in an open note as a real doc change, the
 * next human keystroke keeps it, and Undo removes only the agent's change.
 *
 * "Client" docs here are what a session's engine holds; the agent's update is
 * produced by the connector's own entry point (`agentWriteFromLog`) from the
 * server's view of the doc, then applied the way the engine applies a pulled
 * `api_key` row: with an `AgentOrigin`.
 */

import { describe, expect, it } from "@rstest/core";
import * as Y from "yjs";

import { agentWriteFromLog, applyAgentEdit, bodyFromLog } from "../editor/agent-write";
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

/** A second device holding the same state as `doc`. */
function peerOf(doc: Y.Doc): Y.Doc {
  const peer = new Y.Doc();
  peer.get(NOTES_DOC_ROOT, Y.XmlElement);
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc), "remote");
  return peer;
}

/** The connector's write against what `server` holds. */
function agentWrite(server: Y.Doc, edit: { kind: "append" | "replace"; markdown: string }) {
  const res = agentWriteFromLog({
    snapshotB64: encodeUint8ToBase64(Y.encodeStateAsUpdate(server)),
    updatesB64: [],
    edit,
  });
  expect(res.updateB64).not.toBeNull();
  return { ...res, update: decodeBase64ToUint8(res.updateB64!) };
}

/** A local human edit: same headless path, local (null) origin. */
function humanAppend(doc: Y.Doc, markdown: string): Uint8Array {
  return applyAgentEdit(doc, { kind: "append", markdown }).update!;
}

const md = (doc: Y.Doc) => deriveNoteBody(doc).md;

describe("undo agent only", () => {
  it("lands, survives the next human edit, and undoes only the agent's text", () => {
    const doc = clientDoc("# Plan\n\nHello there");
    const undo = createAgentUndo(doc);
    expect(undo.canUndo()).toBe(false);

    const { update } = agentWrite(doc, { kind: "append", markdown: "Agent wrote **this**" });
    Y.applyUpdate(doc, update, new AgentOrigin("key-1"));
    expect(md(doc)).toBe("# Plan\n\nHello there\n\nAgent wrote **this**");
    expect(undo.canUndo()).toBe(true);

    // The next human keystroke never discards it, and isn't on the stack.
    humanAppend(doc, "Human line");
    expect(md(doc)).toBe("# Plan\n\nHello there\n\nAgent wrote **this**\n\nHuman line");
    undo.undo();
    expect(undo.canUndo()).toBe(false);
    expect(md(doc)).toBe("# Plan\n\nHello there\n\nHuman line");
    undo.destroy();
  });

  it("undoes a wholesale replace back to the human text", () => {
    const doc = clientDoc("# Plan\n\nOriginal body");
    const undo = createAgentUndo(doc);
    const res = agentWrite(doc, { kind: "replace", markdown: "# Plan\n\nRewritten by the agent" });
    expect(res.bodyMd).toBe("# Plan\n\nRewritten by the agent");
    Y.applyUpdate(doc, res.update, new AgentOrigin(null));
    expect(md(doc)).toBe("# Plan\n\nRewritten by the agent");
    undo.undo();
    expect(md(doc)).toBe("# Plan\n\nOriginal body");
    undo.destroy();
  });

  it("offers only the newest agent write, so one click never reaches an older one", () => {
    const doc = clientDoc("# Plan\n\nBase");
    const undo = createAgentUndo(doc);
    const one = agentWrite(doc, { kind: "append", markdown: "Agent one" }).update;
    Y.applyUpdate(doc, one, new AgentOrigin("k"));
    const two = agentWrite(doc, { kind: "append", markdown: "Agent two" }).update;
    Y.applyUpdate(doc, two, new AgentOrigin("k"));
    undo.undo();
    expect(md(doc)).toBe("# Plan\n\nBase\n\nAgent one");
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
  });

  it("withdraws Undo when anyone else's change arrives, so a replace is never restored twice", () => {
    const a = clientDoc("# Plan\n\nOriginal body");
    const b = peerOf(a);
    const undoA = createAgentUndo(a);
    const undoB = createAgentUndo(b);
    const { update } = agentWrite(a, { kind: "replace", markdown: "# Plan\n\nRewritten" });
    Y.applyUpdate(a, update, new AgentOrigin("k"));
    Y.applyUpdate(b, update, new AgentOrigin("k"));
    expect(undoA.canUndo() && undoB.canUndo()).toBe(true);

    // A undoes; B receives A's undo like any other device's change.
    const before = Y.encodeStateVector(a);
    undoA.undo();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, before), "remote");
    expect(undoB.canUndo()).toBe(false);
    expect(md(a)).toBe("# Plan\n\nOriginal body");
    expect(md(b)).toBe("# Plan\n\nOriginal body");
    undoA.destroy();
    undoB.destroy();
  });

  it("never files someone else's deletion under the agent's Undo", () => {
    // The server holds a peer's deletion this session hasn't received yet.
    const session = clientDoc("# Plan\n\nKeep this\n\nPeer deletes this");
    const server = peerOf(session);
    server.getXmlElement(NOTES_DOC_ROOT).delete(2, 1);
    expect(md(server)).toBe("# Plan\n\nKeep this");

    const undo = createAgentUndo(session);
    const { update } = agentWrite(server, { kind: "append", markdown: "From the agent" });
    Y.applyUpdate(session, update, new AgentOrigin("k"));
    // The agent's update carries only the agent's change: the peer's
    // deletion hasn't reached this session through it.
    expect(md(session)).toContain("Peer deletes this");
    undo.undo();
    Y.applyUpdate(session, Y.encodeStateAsUpdate(server), "remote");
    // The peer's deletion stands; the agent's text is gone.
    expect(md(session)).toBe("# Plan\n\nKeep this");
    undo.destroy();
  });

  it("treats agent-origin updates as foreign, so they are never pushed back", () => {
    const persistence = {};
    expect(isForeignOrigin(new AgentOrigin("k"), persistence)).toBe(true);
    expect(isForeignOrigin("remote", persistence)).toBe(true);
    expect(isForeignOrigin(persistence, persistence)).toBe(true);
    expect(isForeignOrigin(null, persistence)).toBe(false);
  });
});

describe("agent write from the log", () => {
  it("appends into an empty doc without a stray blank first line", () => {
    const res = agentWriteFromLog({
      snapshotB64: null,
      updatesB64: [],
      edit: { kind: "append", markdown: "First words" },
    });
    expect(res.bodyMd).toBe("First words");
  });

  it("never removes a lone non-text block when appending", () => {
    const base = buildDocStateFromMarkdown(NOTE_ID, "[Mindmap](moduo://mindmap/m1)")!;
    const res = agentWriteFromLog({
      snapshotB64: base.docStateB64,
      updatesB64: [],
      edit: { kind: "append", markdown: "Agent line" },
    });
    expect(res.bodyMd).toBe(`${base.bodyMd}\n\nAgent line`);
  });

  it("skips a row Yjs can't decode instead of failing every later write", () => {
    const base = buildDocStateFromMarkdown(NOTE_ID, "# Plan\n\nHello")!;
    const res = agentWriteFromLog({
      snapshotB64: base.docStateB64,
      updatesB64: ["not base64 at all", encodeUint8ToBase64(new Uint8Array([9, 9, 9]))],
      edit: { kind: "append", markdown: "Still works" },
    });
    expect(res.bodyMd).toBe("# Plan\n\nHello\n\nStill works");
  });

  it("re-derives the body of everything the server holds", () => {
    const doc = clientDoc("# Plan\n\nHello");
    const peer = peerOf(doc);
    const a = agentWrite(doc, { kind: "append", markdown: "From the agent" });
    const human = humanAppend(peer, "From a person");
    const body = bodyFromLog({
      snapshotB64: encodeUint8ToBase64(Y.encodeStateAsUpdate(doc)),
      updatesB64: [a.updateB64!, encodeUint8ToBase64(human)],
    });
    expect(body.bodyMd).toContain("From the agent");
    expect(body.bodyMd).toContain("From a person");
  });
});
