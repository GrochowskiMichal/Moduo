// A reference opened in a page's right panel (tasks-v3 §11, 72a): the panel's
// title row reads "← item" (SH-1's stack) and its body is the item's card, at
// panel width, with an "Open in …" action in the title row for the full item.
// A page that can show the item itself (Tasks, for a task) renders its own
// detail instead; this is everything else. "Private item" and "Deleted task"
// hold here too: no title, no preview.

import { useReference } from "../context";
import { deletedLabel, openInLabel, PRIVATE_ITEM_LABEL, referenceKind } from "../kinds";
import { openReferenceFull } from "../open";
import { plainReferenceName } from "../text";
import type { ReferenceRef, ReferenceState } from "../types";
import { ReferenceCardBody } from "./reference-card";

/** The panel item's title: the item's name for this reader, never more. */
export function referencePanelTitle(ref: ReferenceRef, state: ReferenceState | null): string {
  return plainReferenceName(ref, state);
}

/** The "Open in Notes" action for a panel item, once the reader can open it. */
export function referencePanelOpen(
  ref: ReferenceRef,
  state: ReferenceState | null,
): { label: string; onOpen: () => void } | undefined {
  if (state?.status !== "ready") return undefined;
  const label = openInLabel(referenceKind(ref.type));
  return label ? { label, onOpen: () => openReferenceFull(ref) } : undefined;
}

export function ReferencePanelBody({ reference }: { reference: ReferenceRef }) {
  const state = useReference(reference, "card");
  if (!state || state.status === "loading") {
    return <p className="px-1 text-sm text-subtle-foreground">Loading…</p>;
  }
  if (state.status === "private") {
    return (
      <div className="flex flex-col gap-1 px-1">
        <p className="text-base text-foreground">{PRIVATE_ITEM_LABEL}</p>
        <p className="text-sm text-muted-foreground">
          You can’t open this. Ask whoever shared it with you for access.
        </p>
      </div>
    );
  }
  if (state.status === "deleted") {
    return <p className="px-1 text-base text-subtle-foreground">{deletedLabel(state.kind)}</p>;
  }
  if (state.status === "error") {
    return (
      <p className="px-1 text-sm text-subtle-foreground">This didn’t load. Try again later.</p>
    );
  }
  return (
    <div className="px-1">
      <ReferenceCardBody facts={state.facts} pending={!state.facts.card} />
    </div>
  );
}
