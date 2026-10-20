// The entity text editor behind a lazy boundary: Lexical and its plugins are
// their own async chunk, fetched when the first editor mounts (a task panel's
// description, the Focus card, an event's notes), never on first load.
// task-capture imports the real editor directly; it is already async.

import { lazy, Suspense } from "react";
import { cn } from "../../../lib/utils";
import type { EntityTextEditorProps } from "./entity-text-editor";

export type { EntityTextEditorApi, EntityTextEditorProps } from "./entity-text-editor";

const LazyEditor = lazy(() =>
  import("./entity-text-editor").then((m) => ({ default: m.EntityTextEditor })),
);

/** Holds the editor's line while Lexical loads, so nothing below jumps. */
function EditorPlaceholder({ className }: { className?: string }) {
  return <div aria-busy="true" className={cn("min-h-6 w-full", className)} />;
}

export function EntityTextEditor(props: EntityTextEditorProps) {
  return (
    <Suspense fallback={<EditorPlaceholder className={props.className} />}>
      <LazyEditor {...props} />
    </Suspense>
  );
}
