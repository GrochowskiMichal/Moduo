/**
 * NOTE-FIX-1 — the headless materializer is the load-bearing piece: if the doc
 * it builds isn't the doc the live editor would have built, imported notes
 * render wrong instead of blank, which is worse. These tests pin (a) that a
 * built doc actually carries the content, (b) that it round-trips back through
 * the SAME v2 binding the live editor reads it with, and (c) determinism —
 * two devices materializing one note must not fork it.
 */

import { createHeadlessEditor } from "@lexical/headless";
import { $convertToMarkdownString } from "@lexical/markdown";
import { createBindingV2__EXPERIMENTAL, syncYjsStateToLexicalV2__EXPERIMENTAL } from "@lexical/yjs";
import { describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { deriveBody } from "../sync/doc-text";
import { decodeBase64ToUint8 } from "../utils/base64";
import { NOTES_TRANSFORMERS } from "./markdown";
import { buildDocStateFromMarkdown, NOTES_DOC_ROOT, seedClientId } from "./materialize";
import { NOTE_EDITOR_NODES } from "./note-nodes";

const NOTE_ID = "3f7c1b2e-6a4d-4b9e-8c11-0d2e5a7b9c44";

const SAMPLE = [
  "# Quarterly plan",
  "",
  "Some **bold** and *italic* prose.",
  "",
  "## Checklist",
  "",
  "- [x] Ship the importer",
  "- [ ] Fix the blank-note bug",
  "",
  "1. First",
  "2. Second",
  "",
  "> A quote line",
  "",
  "```",
  "const x = 1;",
  "```",
].join("\n");

/** Apply a built snapshot into a fresh doc the way `engine-v2.pull` does. */
function applySnapshot(docStateB64: string): Y.Doc {
  const doc = new Y.Doc();
  doc.get(NOTES_DOC_ROOT, Y.XmlElement);
  Y.applyUpdate(doc, decodeBase64ToUint8(docStateB64), "remote");
  return doc;
}

/**
 * Read a stored snapshot back the way the LIVE editor does — through the same
 * v2 binding, into a real Lexical editor — rather than through `deriveBody`.
 * Verifying with `deriveBody` alone would only prove the walker agrees with
 * itself; this proves the doc is one Lexical can actually mount.
 */
function readBackThroughEditor(docStateB64: string, noteId = NOTE_ID): string {
  const doc = new Y.Doc();
  doc.get(NOTES_DOC_ROOT, Y.XmlElement);
  Y.applyUpdate(doc, decodeBase64ToUint8(docStateB64), "remote");

  const editor = createHeadlessEditor({
    namespace: `moduo-note-${noteId}`,
    nodes: [...NOTE_EDITOR_NODES],
    onError: (e: Error) => {
      throw e;
    },
  });
  const binding = createBindingV2__EXPERIMENTAL(editor, noteId, doc, new Map([[noteId, doc]]));
  // A real Awareness: the binding publishes remote cursor positions through it
  // on every sync, and a null one throws inside `syncCursorPositions`.
  const provider = {
    awareness: new Awareness(doc),
    connect() {},
    disconnect() {},
    on() {},
    off() {},
  } as any;
  syncYjsStateToLexicalV2__EXPERIMENTAL(binding, provider);

  let md = "";
  editor.getEditorState().read(() => {
    md = $convertToMarkdownString(NOTES_TRANSFORMERS);
  });
  return md;
}

describe("buildDocStateFromMarkdown", () => {
  it("produces a doc a REAL Lexical editor mounts and renders", () => {
    const built = buildDocStateFromMarkdown(NOTE_ID, SAMPLE)!;
    const md = readBackThroughEditor(built.docStateB64);

    expect(md).toContain("# Quarterly plan");
    expect(md).toContain("## Checklist");
    expect(md).toContain("- [x] Ship the importer");
    expect(md).toContain("- [ ] Fix the blank-note bug");
    expect(md).toContain("1. First");
    expect(md).toContain("> A quote line");
    expect(md).toContain("**bold**");
    expect(md).toContain("*italic*");
  });

  it("keeps link URLs and inline marks in the DOC even though deriveBody drops them", () => {
    // This asymmetry is why the import and the repair store the raw markdown
    // and never a `deriveBody` result: the doc is the rich copy, `body_md` is
    // the faithful copy, and neither may be overwritten by the other.
    const md = "See [pricing](https://x.test/p) and **bold**.\n";
    const built = buildDocStateFromMarkdown(NOTE_ID, md)!;

    expect(readBackThroughEditor(built.docStateB64)).toContain("https://x.test/p");
    expect(built.bodyMd).not.toContain("https://x.test/p");
  });

  it("returns null for blank markdown so callers skip the write", () => {
    expect(buildDocStateFromMarkdown(NOTE_ID, "")).toBeNull();
    expect(buildDocStateFromMarkdown(NOTE_ID, "   \n\n  ")).toBeNull();
  });

  it("builds a non-empty root-v2 doc a fresh client can apply", () => {
    const built = buildDocStateFromMarkdown(NOTE_ID, SAMPLE);
    expect(built).not.toBeNull();

    const doc = applySnapshot(built!.docStateB64);
    const root = doc.getXmlElement(NOTES_DOC_ROOT);
    expect(root.toArray().length).toBeGreaterThan(0);
  });

  it("round-trips the content back out of the CRDT, not just into it", () => {
    const built = buildDocStateFromMarkdown(NOTE_ID, SAMPLE)!;
    const doc = applySnapshot(built.docStateB64);
    const body = deriveBody(doc);

    // Prose + every block type survives the markdown → Lexical → Yjs trip.
    expect(body.text).toContain("Quarterly plan");
    expect(body.text).toContain("Some bold and italic prose.");
    expect(body.md).toContain("# Quarterly plan");
    expect(body.md).toContain("## Checklist");
    expect(body.md).toContain("> A quote line");
    expect(body.md).toContain("const x = 1;");

    // Structural, not byte-equality: checklists must come back as real
    // checkbox items, never the literal "[x]" text the CHECK_LIST gotcha
    // describes (a bytes-only assertion passes on that broken shape).
    expect(body.md).toContain("- [x] Ship the importer");
    expect(body.md).toContain("- [ ] Fix the blank-note bug");
    expect(body.md).not.toMatch(/-\s+\\\[x\\\]/);

    expect(body.md).toContain("1. First");
    expect(body.md).toContain("2. Second");
  });

  it("derives the bodies from the built doc, so they cannot drift from it", () => {
    const built = buildDocStateFromMarkdown(NOTE_ID, SAMPLE)!;
    const doc = applySnapshot(built.docStateB64);
    const body = deriveBody(doc);

    expect(built.bodyMd).toBe(body.md);
    expect(built.bodyText).toBe(body.text);
  });

  // ── the fork guard ────────────────────────────────────────────────────────

  it("is byte-identical across independent builds of the same note", () => {
    const a = buildDocStateFromMarkdown(NOTE_ID, SAMPLE)!;
    const b = buildDocStateFromMarkdown(NOTE_ID, SAMPLE)!;
    expect(a.docStateB64).toBe(b.docStateB64);
  });

  it("does NOT duplicate content when two devices seed the same note", () => {
    // The realistic race: two clients each materialize the same empty note
    // before either's write lands, then both snapshots reach one doc.
    const deviceA = buildDocStateFromMarkdown(NOTE_ID, SAMPLE)!;
    const deviceB = buildDocStateFromMarkdown(NOTE_ID, SAMPLE)!;

    const merged = new Y.Doc();
    merged.get(NOTES_DOC_ROOT, Y.XmlElement);
    Y.applyUpdate(merged, decodeBase64ToUint8(deviceA.docStateB64), "remote");
    Y.applyUpdate(merged, decodeBase64ToUint8(deviceB.docStateB64), "remote");

    const once = applySnapshot(deviceA.docStateB64);
    // Merging both is indistinguishable from applying one — the whole point of
    // the deterministic clientID. A random clientID makes this assertion fail
    // with the heading (and every other block) appearing twice.
    expect(deriveBody(merged).md).toBe(deriveBody(once).md);

    const headings = deriveBody(merged).md.match(/# Quarterly plan/g) ?? [];
    expect(headings).toHaveLength(1);
  });

  it("gives different notes different identities", () => {
    const other = "aa11bb22-cc33-4d44-8e55-ff6677889900";
    expect(seedClientId(NOTE_ID)).not.toBe(seedClientId(other));
    expect(seedClientId(NOTE_ID)).toBe(seedClientId(NOTE_ID));
    expect(Number.isInteger(seedClientId(NOTE_ID))).toBe(true);
    expect(seedClientId(NOTE_ID)).toBeGreaterThan(0);
    expect(seedClientId(NOTE_ID)).toBeLessThanOrEqual(0xffffffff);

    // Different notes must not produce the same bytes either.
    const a = buildDocStateFromMarkdown(NOTE_ID, SAMPLE)!;
    const b = buildDocStateFromMarkdown(other, SAMPLE)!;
    expect(a.docStateB64).not.toBe(b.docStateB64);
  });
});
