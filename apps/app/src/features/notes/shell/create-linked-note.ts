/**
 * `[[Create "…"]]` (NR-4, AC8): a new Inbox note whose first line, and so its
 * title, is what was typed. It rides the lazy-draft path (NR-2): the title
 * line is written into the draft's doc, then the draft is materialized, so the
 * doc push waits for the create and an offline create queues ahead of it.
 */

import * as Y from "yjs";

import type { Draft } from "../draft-note";
import { buildDocStateFromMarkdown } from "../editor/materialize";
import { titleAsMarkdown } from "../editor/note-link";
import type { NotesSyncEngineV2 } from "../sync/engine-v2";
import { decodeBase64ToUint8 } from "../utils/base64";

export function createLinkedNote(input: {
  engine: Pick<NotesSyncEngineV2, "openDraft">;
  materializeDraft: (draft: Draft) => Promise<boolean>;
  title: string;
  /** Under this note (a subpage, Turn into → Page); a root Inbox note when absent. */
  parentId?: string | null;
}): { id: string; created: Promise<boolean> } | null {
  const title = input.title.trim();
  if (title === "") return null;
  const id = crypto.randomUUID();
  const session = input.engine.openDraft(id);
  const built = buildDocStateFromMarkdown(id, titleAsMarkdown(title));
  if (built)
    Y.applyUpdate(session.doc, decodeBase64ToUint8(built.docStateB64), "notes:link-create");
  return { id, created: input.materializeDraft({ id, parentId: input.parentId ?? null, title }) };
}
