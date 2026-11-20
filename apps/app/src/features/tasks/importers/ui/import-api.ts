import type { ModuoRuntime } from "../../../../lib/runtime.types";
import type { ImportApi } from "../run";

/** The runtime's import writes, or null when this build has none. */
export function importApiOf(runtime: ModuoRuntime | null): ImportApi | null {
  const t = runtime?.tasks;
  if (
    !runtime ||
    !t?.beginImport ||
    !t.createImportProject ||
    !t.createImportSection ||
    !t.createImportTask ||
    !t.finishImport
  ) {
    return null;
  }
  return {
    beginImport: t.beginImport,
    createImportProject: t.createImportProject,
    createImportSection: t.createImportSection,
    createImportTask: t.createImportTask,
    finishImport: t.finishImport,
    listStatuses: (ws) => t.listStatuses(ws),
    createStatus: (input) => t.createStatus(input),
    addComment: (input) => runtime.spine.addComment(input),
  };
}
