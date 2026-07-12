// Connective-tissue spine — the built-in module snippet projectors (DF-7).
//
// Registers how a task / note / event / email row reads when it surfaces in
// another entity's hub. Each projector reads the registry label for the title
// and its module's live `meta` (when the hub hook supplied one) for the snippet;
// with NO meta it degrades to a bare title, exactly the pre-DF-7 behavior. The
// spine owns these baselines (as it owns the icon map + section map for every
// well-known type); a module can still override its own via
// registerSnippetProjector. Import this module for its registration side effect.

import { registerSnippetProjector, type HubSnippetMeta } from "./snippet-projectors";
import {
  formatEmailSnippet,
  formatEventSnippet,
  formatNoteSnippet,
  formatTaskSnippet,
} from "./snippet-format";

/** Narrow the polymorphic meta bag to the projector's own kind (defensive). */
function metaOf<K extends HubSnippetMeta["kind"]>(
  meta: HubSnippetMeta | undefined,
  kind: K,
): Extract<HubSnippetMeta, { kind: K }> | null {
  return meta?.kind === kind ? (meta as Extract<HubSnippetMeta, { kind: K }>) : null;
}

registerSnippetProjector("task", (record, _other, ctx) => {
  const meta = metaOf(ctx?.meta, "task");
  return {
    title: record?.label?.trim() || "Untitled task",
    snippet: meta ? formatTaskSnippet(meta, ctx?.now ?? new Date()) : null,
    icon: record?.icon ?? "task",
  };
});

registerSnippetProjector("note", (record, _other, ctx) => {
  const meta = metaOf(ctx?.meta, "note");
  return {
    title: record?.label?.trim() || "Untitled note",
    snippet: meta ? formatNoteSnippet(meta, ctx?.now ?? new Date()) : null,
    icon: record?.icon ?? "note",
  };
});

registerSnippetProjector("event", (record, _other, ctx) => {
  const meta = metaOf(ctx?.meta, "event");
  return {
    title: record?.label?.trim() || "Untitled event",
    snippet: meta ? formatEventSnippet(meta, ctx?.now ?? new Date()) : null,
    icon: record?.icon ?? "event",
  };
});

registerSnippetProjector("email", (record, _other, ctx) => {
  const meta = metaOf(ctx?.meta, "email");
  return {
    title: record?.label?.trim() || "(no subject)",
    snippet: meta ? formatEmailSnippet(meta, ctx?.now ?? new Date()) : null,
    icon: record?.icon ?? "email",
  };
});

/** Touch to force the registration side effect from a component import. */
export const spineSnippetProjectorsReady = true;
