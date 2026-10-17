// Connective-tissue spine — the Lexical entity-ref node (block CT-4), now the
// Reference node (RF-1), as browser editors use it: the React-free schema from
// `entity-ref-schema.ts` (NR-3 schema/view split) plus its view, the Reference
// primitive from ../references/reference-node.tsx. Same node type
// ("entity-ref"), so Notes' documents, its markdown transformer, email compose
// and every stored task/event description keep working; a version-1 node reads
// as a chip. Importing this module installs the view, so every editor that
// renders references (Notes, entity text, email compose) imports from here;
// headless code imports the schema file and never loads React.

import { installReferenceView } from "../references/reference-node";

export {
  $createEntityRefNode,
  $isEntityRefNode,
  EntityRefNode,
  type SerializedEntityRefNode,
} from "./entity-ref-schema";

/** Draw entity-ref nodes as the Reference primitive (link · chip · card). The
 * Notes editor calls it with its other views; importing this module already
 * has. Idempotent. */
export function installEntityRefView(): void {
  installReferenceView();
}

installEntityRefView();
