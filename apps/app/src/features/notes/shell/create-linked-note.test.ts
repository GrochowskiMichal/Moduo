import { describe, expect, it } from "@rstest/core";
import * as Y from "yjs";

import type { Draft } from "../draft-note";
import { deriveNoteBody, NOTES_DOC_ROOT } from "../editor/doc-markdown";
import { createLinkedNote } from "./create-linked-note";

describe("[[ create", () => {
  it("creates an Inbox note through the draft path, its doc's first line the title", async () => {
    const docs = new Map<string, Y.Doc>();
    const engine = {
      openDraft: (id: string) => {
        const doc = new Y.Doc();
        doc.get(NOTES_DOC_ROOT, Y.XmlElement);
        docs.set(id, doc);
        return { doc } as never;
      },
    };
    const drafts: Draft[] = [];
    const made = createLinkedNote({
      engine,
      materializeDraft: (d) => {
        drafts.push(d);
        return Promise.resolve(true);
      },
      title: "  Launch plan  ",
    });
    expect(made).not.toBeNull();
    expect(drafts).toEqual([{ id: made!.id, parentId: null, title: "Launch plan" }]);
    expect(deriveNoteBody(docs.get(made!.id)!).text).toBe("Launch plan");
    await expect(made!.created).resolves.toBe(true);
  });

  it("refuses a blank title", () => {
    const made = createLinkedNote({
      engine: { openDraft: () => ({ doc: new Y.Doc() }) as never },
      materializeDraft: () => Promise.resolve(true),
      title: "   ",
    });
    expect(made).toBeNull();
  });
});
