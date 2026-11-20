import { describe, expect, it } from "@rstest/core";

import { escapeMermaidText, parseMermaidToMindmap } from "./mermaid-import";

describe("Mermaid labels", () => {
  it("escape quotes, pipes and hashes as entity codes, never backslashes", () => {
    expect(escapeMermaidText('say "hi" | #1 \\')).toBe("say #quot;hi#quot; #124; #35;1 \\");
  });

  it("round-trip a node label and an edge label through the importer", () => {
    const title = 'The "plan" | step #2 \\';
    const edge = 'yes | "no"';
    const source = [
      "graph TD",
      `  A["${escapeMermaidText(title)}"]`,
      `  B["Next"]`,
      `  A -->|${escapeMermaidText(edge)}| B`,
    ].join("\n");
    const { nodes, edges } = parseMermaidToMindmap(source);
    expect(nodes.find((n) => n.id === "A")?.data.label).toBe(title);
    expect(edges[0]?.label).toBe(edge);
  });

  it("keep a label that already reads like an entity", () => {
    const { nodes } = parseMermaidToMindmap(`graph TD\n  A["${escapeMermaidText("#quot;")}"]`);
    expect(nodes[0]?.data.label).toBe("#quot;");
  });
});
