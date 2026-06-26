import { describe, expect, it } from "vitest";
import { createEditor } from "lexical";
import {
  $createEntityRefNode,
  $isEntityRefNode,
  EntityRefNode,
  type SerializedEntityRefNode,
} from "./entity-ref-node";

/**
 * Lexical nodes can only be constructed inside an editor context (the
 * constructor assigns a node key via the active editor). A headless editor with
 * the node registered gives us that context for the serialization round-trip.
 */
function runInEditor(cb: () => void): void {
  const editor = createEditor({
    nodes: [EntityRefNode],
    onError: (err) => {
      throw err;
    },
  });
  editor.update(cb, { discrete: true });
}

describe("EntityRefNode", () => {
  it("is registered as an inline node of type 'entity-ref'", () => {
    expect(EntityRefNode.getType()).toBe("entity-ref");
    runInEditor(() => {
      const node = $createEntityRefNode({ entityType: "task", entityId: "t1", label: "Ship CT-4" });
      expect(node.isInline()).toBe(true);
      expect($isEntityRefNode(node)).toBe(true);
    });
  });

  it("round-trips through exportJSON / importJSON", () => {
    let json: SerializedEntityRefNode | undefined;
    let restoredJson: SerializedEntityRefNode | undefined;
    runInEditor(() => {
      const node = $createEntityRefNode({
        entityType: "contact",
        entityId: "c9",
        label: "Ada Lovelace",
        icon: "contact",
      });
      json = node.exportJSON();
      restoredJson = EntityRefNode.importJSON(json).exportJSON();
    });
    expect(json).toMatchObject<Partial<SerializedEntityRefNode>>({
      type: "entity-ref",
      version: 1,
      entityType: "contact",
      entityId: "c9",
      label: "Ada Lovelace",
      icon: "contact",
    });
    expect(restoredJson).toEqual(json);
  });

  it("exposes the label as text content so copy/paste degrades to plain text", () => {
    runInEditor(() => {
      const node = $createEntityRefNode({ entityType: "note", entityId: "n1", label: "Spec notes" });
      expect(node.getTextContent()).toBe("Spec notes");
    });
  });

  it("defaults a missing icon to null on import", () => {
    let icon: string | null = "unset";
    runInEditor(() => {
      const restored = EntityRefNode.importJSON({
        type: "entity-ref",
        version: 1,
        entityType: "task",
        entityId: "t2",
        label: "No icon",
      } as SerializedEntityRefNode);
      icon = restored.exportJSON().icon;
    });
    expect(icon).toBeNull();
  });
});
