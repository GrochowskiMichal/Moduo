// Connective-tissue spine — the Lexical entity-ref node (block CT-4), now the
// Reference node (RF-1). It grew in place: same node type ("entity-ref"), so
// Notes' documents, its markdown transformer, email compose and every stored
// task/event description keep working; a version-1 node reads as a chip. The
// implementation lives with the primitive in ../references/reference-node.tsx.

export {
  $createReferenceNode as $createEntityRefNode,
  $isReferenceNode as $isEntityRefNode,
  ReferenceNode as EntityRefNode,
  type SerializedReferenceNode as SerializedEntityRefNode,
} from "../references/reference-node";
