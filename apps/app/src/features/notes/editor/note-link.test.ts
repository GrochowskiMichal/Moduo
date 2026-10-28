import { describe, expect, it } from "@rstest/core";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  type ParagraphNode,
} from "lexical";
import * as Y from "yjs";

import { $isEntityRefNode } from "../../spine/editor/entity-ref-schema";
import { resolveMention } from "../../spine/mention";
import type { Note } from "../model";
import { decodeBase64ToUint8 } from "../utils/base64";
import { createNotesHeadlessEditor, deriveNoteBody, NOTES_DOC_ROOT } from "./doc-markdown";
import { buildDocStateFromMarkdown } from "./materialize";
import {
  $insertNoteLink,
  noteLinkCandidate,
  noteLinkQueryAt,
  noteLinkRows,
  titleAsMarkdown,
} from "./note-link";

function note(id: string, title: string, extra: Partial<Note> = {}): Note {
  return {
    id,
    workspaceId: "w",
    createdBy: null,
    parentId: null,
    title,
    icon: null,
    position: "a",
    isArchived: false,
    publishedAt: null,
    publishToken: null,
    docVersion: 0,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    deletedAt: null,
    shareMode: "custom",
    workspaceShared: false,
    inInbox: true,
    fullWidth: false,
    ...extra,
  };
}

const NOTES = [
  note("1", "Roadmap", { updatedAt: "2026-10-02T00:00:00Z" }),
  note("2", "Q4 roadmap review", { updatedAt: "2026-10-05T00:00:00Z" }),
  note("3", "Groceries"),
  note("4", "Roadmap (old)", { deletedAt: "2026-10-03T00:00:00Z" }),
  note("5", "Roadmap archive", { isArchived: true }),
  note("me", "Roadmap draft"),
];

describe("[[ picker", () => {
  it("opens on [[ and follows the query, never across ] or a line break", () => {
    expect(noteLinkQueryAt("see [[")).toEqual({ start: 4, query: "" });
    expect(noteLinkQueryAt("see [[road")).toEqual({ start: 4, query: "road" });
    expect(noteLinkQueryAt("see [[road map")).toEqual({ start: 4, query: "road map" });
    expect(noteLinkQueryAt("see [[road]] and")).toBeNull();
    expect(noteLinkQueryAt("see [x")).toBeNull();
    expect(noteLinkQueryAt(`[[${"x".repeat(81)}`)).toBeNull();
  });

  it("matches live notes, prefix first, never trashed, archived or the open note", () => {
    const rows = noteLinkRows(NOTES, "road", "me");
    expect(rows.map((r) => (r.kind === "note" ? r.id : "create"))).toEqual(["1", "2", "create"]);
  });

  it("an exact title match offers no create; an empty query lists recent notes", () => {
    expect(noteLinkRows(NOTES, "roadmap", "me").some((r) => r.kind === "create")).toBe(false);
    expect(noteLinkRows(NOTES, "", "me").map((r) => (r.kind === "note" ? r.id : "-"))).toEqual([
      "2",
      "1",
      "3",
    ]);
  });

  it("falls back to create as the top row when nothing matches", () => {
    expect(noteLinkRows(NOTES, " Launch plan ", "me")).toEqual([
      { kind: "create", title: "Launch plan" },
    ]);
  });

  it("a pick resolves to a references link to the note", () => {
    const resolution = resolveMention({
      trigger: "ref",
      candidate: noteLinkCandidate("1", "Roadmap"),
    });
    expect(resolution).toMatchObject({
      action: "link",
      target: { type: "note", id: "1" },
      relationKind: "references",
      origin: "ref",
    });
  });

  it("inserts a chip in place of [[query (and an auto-closed ]]), caret after it", () => {
    for (const typed of ["See [[road", "See [[road]]", "[[road"]) {
      const { editor } = createNotesHeadlessEditor("note-link");
      editor.update(
        () => {
          const text = $createTextNode(typed);
          $getRoot().clear().append($createParagraphNode().append(text));
          const start = typed.indexOf("[[");
          const end = typed.includes("]]") ? typed.indexOf("]]") : typed.length;
          const token = { nodeKey: text.getKey(), start, end };
          expect($insertNoteLink(token, { id: "1", title: "Roadmap" })).toBe(true);
          // The caret sits after the chip's space: typing lands there.
          $getSelection()?.insertText("next");
        },
        { discrete: true },
      );
      const lead = typed.startsWith("See") ? "See " : "";
      const shape = editor
        .getEditorState()
        .read(() =>
          ($getRoot().getFirstChildOrThrow() as ParagraphNode)
            .getChildren()
            .map((n) =>
              $isEntityRefNode(n) ? `chip:${n.__entityType}:${n.__entityId}` : n.getTextContent(),
            ),
        );
      expect(shape).toEqual([...(lead ? [lead] : []), "chip:note:1", " next"]);
    }
  });

  it("a created note's doc reads back with its title as the first line", () => {
    const title = "Plan *B* #2 [draft] - v1";
    const built = buildDocStateFromMarkdown("n-new", titleAsMarkdown(title))!;
    const doc = new Y.Doc();
    doc.get(NOTES_DOC_ROOT, Y.XmlElement);
    Y.applyUpdate(doc, decodeBase64ToUint8(built.docStateB64));
    expect(deriveNoteBody(doc).text).toBe(title);
  });
});
