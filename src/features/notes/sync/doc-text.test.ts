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

  // The shape the LIVE editor actually writes (NOTE-FIX-1). The v2 collab
  // binding stores element props `__`-prefixed; reading only the bare names
  // silently flattened every heading to `###`, every checklist to plain
  // bullets, and every ordered list to bullets — in `body_md`, which is what
  // export, publish and the MCP connector all read.
  describe("v2 binding shape (__-prefixed element props)", () => {
    it("keeps heading levels", () => {
      const doc = new Y.Doc();
      const root = doc.get("root-v2", Y.XmlElement);
      root.insert(0, [
        el("heading", { __tag: "h1" }, "One"),
        el("heading", { __tag: "h2" }, "Two"),
        el("heading", { __tag: "h3" }, "Three"),
      ]);
      expect(deriveBody(doc).md).toBe("# One\n## Two\n### Three");
    });

    it("keeps checkbox state", () => {
      const doc = new Y.Doc();
      const root = doc.get("root-v2", Y.XmlElement);
      const list = new Y.XmlElement("list");
      list.setAttribute("__listType", "check" as any);
      list.insert(0, [
        el("listitem", { __checked: true }, "done"),
        el("listitem", { __checked: false }, "todo"),
      ]);
      root.insert(0, [list]);
      expect(deriveBody(doc).md).toBe("- [x] done\n- [ ] todo");
    });

    it("keeps ordered-list numbering (absent __listType means number)", () => {
      const doc = new Y.Doc();
      const root = doc.get("root-v2", Y.XmlElement);
      const list = new Y.XmlElement("list");
      // EXACTLY what the binding emits for `1. one\n2. two`: it only writes
      // properties that differ from a default-constructed node, and both
      // ListNode.listType ("number") and the first item's value (1) ARE the
      // defaults — so the list carries no attributes and item one carries
      // none either. Adding a __value to item one here would make the test
      // pass against a doc the app never produces.
      list.insert(0, [el("listitem", {}, "one"), el("listitem", { __value: 2 }, "two")]);
      root.insert(0, [list]);
      expect(deriveBody(doc).md).toBe("1. one\n2. two");
    });

    it("still reads bullets when the binding says so", () => {
      const doc = new Y.Doc();
      const root = doc.get("root-v2", Y.XmlElement);
      const list = new Y.XmlElement("list");
      list.setAttribute("__listType", "bullet" as any);
      list.insert(0, [el("listitem", {}, "a"), el("listitem", { __value: 2 }, "b")]);
      root.insert(0, [list]);
      expect(deriveBody(doc).md).toBe("- a\n- b");
    });

    it("reads a single-item ordered list with NO attributes at all", () => {
      // The degenerate case: `1. only` emits <list><listitem>only</listitem>.
      // A content-dependent shape probe got this wrong; the fixed default is
      // unconditional, so it can't depend on what else is in the doc.
      const doc = new Y.Doc();
      const root = doc.get("root-v2", Y.XmlElement);
      const list = new Y.XmlElement("list");
      list.insert(0, [el("listitem", {}, "only")]);
      root.insert(0, [list]);
      expect(deriveBody(doc).md).toBe("1. only");
    });
  });
});
