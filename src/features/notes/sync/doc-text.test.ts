import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { deriveBody } from "./doc-text";

function el(name: string, attrs: Record<string, unknown>, text: string): Y.XmlElement {
  const node = new Y.XmlElement(name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v as any);
  const t = new Y.XmlText();
  t.insert(0, text);
  node.insert(0, [t]);
  return node;
}

describe("deriveBody (derived body_text / body_md, NO-2)", () => {
  it("serializes headings, paragraphs, lists and checkboxes", () => {
    const doc = new Y.Doc();
    const root = doc.get("root-v2", Y.XmlElement);
    const list = new Y.XmlElement("list");
    list.setAttribute("listType", "check" as any);
    const item = el("listitem", { checked: true }, "buy milk");
    list.insert(0, [item]);
    root.insert(0, [
      el("heading", { tag: "h1" }, "Plan"),
      el("paragraph", {}, "Some intro."),
      list,
    ]);

    const { text, md } = deriveBody(doc);
    expect(md).toBe("# Plan\nSome intro.\n- [x] buy milk");
    expect(text).toBe("Plan\nSome intro.\nbuy milk");
  });

  it("empty doc → empty bodies", () => {
    const doc = new Y.Doc();
    doc.get("root-v2", Y.XmlElement);
    expect(deriveBody(doc)).toEqual({ text: "", md: "" });
  });
});
