// DF-23 — the chip must survive HTML serialization so it round-trips through
// email compose and the HTML-stored task / event descriptions. Proves
// exportDOM → importDOM preserves the entity address, and that a malformed
// marker degrades to plain text rather than minting a dead chip.

import { createHeadlessEditor } from "@lexical/headless";
import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import { describe, expect, it } from "@rstest/core";
import { $createParagraphNode, $getRoot, $isElementNode, type LexicalNode } from "lexical";
import { $createEntityRefNode, $isEntityRefNode, EntityRefNode } from "./entity-ref-node";

function makeEditor() {
  return createHeadlessEditor({
    namespace: "entity-ref-test",
    nodes: [EntityRefNode],
    onError: (e) => {
      throw e;
    },
  });
}

function exportHtml(build: () => void): string {
  const editor = makeEditor();
  editor.update(build, { discrete: true });
  let html = "";
  editor.read(() => {
    html = $generateHtmlFromNodes(editor, null);
  });
  return html;
}

function importChips(html: string): EntityRefNode[] {
  const editor = makeEditor();
  editor.update(
    () => {
      const dom = new DOMParser().parseFromString(html, "text/html");
      const nodes = $generateNodesFromDOM(editor, dom);
      const root = $getRoot();
      root.clear();
      const para = $createParagraphNode();
      para.append(...nodes.filter((n) => !$isElementNode(n)));
      root.append(para);
      for (const n of nodes) if ($isElementNode(n)) root.append(n);
    },
    { discrete: true },
  );
  const found: EntityRefNode[] = [];
  editor.read(() => {
    const visit = (node: LexicalNode) => {
      if ($isEntityRefNode(node)) found.push(node);
      if ($isElementNode(node)) node.getChildren().forEach(visit);
    };
    $getRoot().getChildren().forEach(visit);
  });
  return found;
}

describe("EntityRefNode HTML round-trip", () => {
  it("exports a chip as a marked <span> carrying the entity address + label", () => {
    const html = exportHtml(() => {
      const p = $createParagraphNode();
      p.append(
        $createEntityRefNode({
          entityType: "contact",
          entityId: "c-1",
          label: "Acme Corp",
          icon: "user",
        }),
      );
      $getRoot().append(p);
    });
    expect(html).toContain("data-lexical-entity-ref");
    expect(html).toContain('data-entity-type="contact"');
    expect(html).toContain('data-entity-id="c-1"');
    expect(html).toContain('data-entity-icon="user"');
    expect(html).toContain("Acme Corp");
  });

  it("re-imports the exported html back into an EntityRefNode", () => {
    const html = exportHtml(() => {
      const p = $createParagraphNode();
      p.append(
        $createEntityRefNode({ entityType: "task", entityId: "t-9", label: "Ship it", icon: null }),
      );
      $getRoot().append(p);
    });
    const chips = importChips(html);
    expect(chips).toHaveLength(1);
    expect(chips[0].exportJSON()).toMatchObject({
      entityType: "task",
      entityId: "t-9",
      label: "Ship it",
    });
  });

  it("degrades a marker missing its address to plain text (no dead chip)", () => {
    const chips = importChips('<p>see <span data-lexical-entity-ref="true">ghost</span></p>');
    expect(chips).toHaveLength(0);
  });
});

describe("the Reference node (RF-1)", () => {
  it("a reference stored without a label writes no title, only the type's word", () => {
    const html = exportHtml(() => {
      const p = $createParagraphNode();
      p.append($createEntityRefNode({ entityType: "task", entityId: "t-1", display: "card" }));
      $getRoot().append(p);
    });
    expect(html).toContain('data-display="card"');
    expect(html).toContain('data-ref-v="2"');
    expect(html).toContain(">task<");
    const [chip] = importChips(html);
    // The type's word is never read back as a title.
    expect(chip?.exportJSON()).toMatchObject({ entityId: "t-1", label: "", display: "card" });
    expect(chip?.getTextContent()).toBe("");
  });

  it("an older (version 1) node reads as a chip and keeps its address", () => {
    let json: unknown = null;
    makeEditor().update(
      () => {
        const node = EntityRefNode.importJSON({
          type: "entity-ref",
          version: 1,
          entityType: "note",
          entityId: "n-1",
          label: "Brand voice",
          icon: null,
        });
        json = node.exportJSON();
      },
      { discrete: true },
    );
    expect(json).toMatchObject({ version: 2, display: "chip", entityId: "n-1" });
  });
});
