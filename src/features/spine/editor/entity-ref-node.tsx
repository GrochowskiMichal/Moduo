// Connective-tissue spine — the EntityRefNode as browser editors use it: the
// schema from `entity-ref-schema.ts` plus its chip view (NR-3 schema/view
// split). Importing this module installs the view, so every editor that
// renders chips (Notes, entity text, email compose) imports from here;
// headless code imports the schema file and never loads React.

import { EntityRefChip } from "../ui/entity-ref-chip";
import { EntityRefNode } from "./entity-ref-schema";
import { registerNodeView } from "./node-views";

export {
  $createEntityRefNode,
  $isEntityRefNode,
  EntityRefNode,
  type SerializedEntityRefNode,
} from "./entity-ref-schema";

/** Draw the chip and deep-link on click (`moduo:entity:open`, routed by the
 * host page). */
export function installEntityRefView(): void {
  registerNodeView(EntityRefNode.getType(), (node) => {
    const {
      __entityType: type,
      __entityId: id,
      __label: label,
      __icon: icon,
    } = node as EntityRefNode;
    return (
      <EntityRefChip
        type={type}
        label={label}
        icon={icon}
        onClick={() => {
          if (typeof window === "undefined") return;
          window.dispatchEvent(new CustomEvent("moduo:entity:open", { detail: { type, id } }));
        }}
      />
    );
  });
}

installEntityRefView();
