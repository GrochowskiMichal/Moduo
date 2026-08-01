/**
 * Pure Y.Doc → derived-body serialization (Wave-3 NO-2).
 *
 * The server never parses the CRDT — the client writes `body_text` (FTS
 * source, plain) and `body_md` (MCP/read/publish source, markdown-ish) on
 * every push (spec assumption 3). This walker is editor-independent so the
 * sync engine can derive both without a live Lexical instance; NO-4 upgrades
 * `body_md` to the real @lexical/markdown transformer output.
 *
 * Ported from the legacy expose.ts walker (which only emitted the markdown
 * flavor); mode "text" strips the block prefixes.
 */

import * as Y from "yjs";

type Mode = "text" | "md";

/**
 * Element properties come in TWO shapes and the walker must read both.
 *
 * The live editor's v2 collab binding stores every Lexical element property
 * `__`-prefixed (`__tag`, `__listType`, `__checked`, `__value`) — the same
 * convention this file already handled for task-lines. Plain XmlElements
 * (unit tests, the legacy redb walker) use the bare names.
 *
 * Reading only the bare names is how heading levels, checkbox state and
 * ordered-list numbering were silently flattened out of `body_md` — every
 * heading exported as `###`, every checklist as plain bullets (NOTE-FIX-1).
 */
function prop(node: Y.XmlElement | Y.XmlText, name: string): unknown {
  const prefixed = node.getAttribute(`__${name}`);
  return prefixed !== undefined ? prefixed : node.getAttribute(name);
}

/**
 * A list with NO recorded type is an ORDERED list.
 *
 * The binding only serializes properties that differ from a default-constructed
 * node, and `ListNode`'s own default is `listType: "number"` — so `__listType`
 * is written for `bullet` and `check` and OMITTED for ordered. Verified against
 * the real binding:
 *
 *   - a - b        → <list __listType="bullet" __tag="ul">…
 *   - [x] a        → <list __listType="check"  __tag="ul">…
 *   1. a  2. b     → <list>…                  (no attributes at all)
 *
 * The bare default used to be "bullet", which is why every ordered list
 * exported as bullets. Nothing in the app builds a list without this attribute
 * except an ordered one (no production code hand-writes Yjs docs — every doc
 * comes from the binding, and Lexical's own fields are `__`-prefixed).
 */
const DEFAULT_LIST_TYPE = "number";

/** Task-line serialization shared by both shapes (lexical-yjs stores element
 * nodes as XmlText embeds with `__`-prefixed attributes; tests/legacy walkers
 * use plain XmlElements). */
function taskLineToString(taskId: unknown, done: unknown, title: string, mode: Mode): string {
  if (mode === "text") return title.trim();
  const box = done ? "x" : " ";
  const id = typeof taskId === "string" && taskId !== "" ? taskId : null;
  return id ? `- [${box}] ${title.trim()} <!-- moduo:task:${id} -->` : `- [${box}] ${title.trim()}`;
}

function walkXmlText(node: Y.XmlText, mode: Mode): string {
  const parts: string[] = [];
  for (const op of node.toDelta()) {
    const v = op.insert as unknown;
    if (typeof v === "string") parts.push(v);
    else if (v instanceof Y.XmlElement) parts.push(walkXmlElement(v, mode));
    else if (v instanceof Y.XmlText) {
      const inner = walkXmlText(v, mode);
      if (v.getAttribute("__type") === "task-line") {
        parts.push(
          taskLineToString(v.getAttribute("__taskId"), v.getAttribute("__done"), inner, mode) +
            "\n",
        );
      } else {
        parts.push(inner);
      }
    }
  }
  return parts.join("");
}

function walkXmlElement(node: Y.XmlElement, mode: Mode): string {
  const parts: string[] = [];
  const nodeName = node.nodeName;

  for (const child of node.toArray()) {
    if (child instanceof Y.XmlElement) {
      const childName = child.nodeName;
      const childText = walkXmlElement(child, mode);

      if (childName === "heading") {
        const tag = prop(child, "tag") as string | undefined;
        const prefix = tag === "h1" ? "# " : tag === "h2" ? "## " : "### ";
        parts.push(mode === "md" ? `${prefix}${childText.trim()}` : childText.trim());
      } else if (childName === "quote") {
        const lines = childText.trim().split("\n");
        parts.push(mode === "md" ? lines.map((l) => `> ${l}`).join("\n") : childText.trim());
      } else if (childName === "code") {
        if (mode === "md") {
          parts.push("```\n" + childText.trim() + "\n```");
        } else {
          parts.push(childText.trim());
        }
      } else if (childName === "listitem") {
        const listType = (prop(node, "listType") as string | undefined) ?? DEFAULT_LIST_TYPE;
        const value = prop(child, "value") as number | undefined;
        const checked = prop(child, "checked");
        if (mode === "md") {
          if (checked !== undefined) {
            parts.push(`- [${checked ? "x" : " "}] ${childText.trim()}`);
          } else if (listType === "number") {
            parts.push(`${value ?? 1}. ${childText.trim()}`);
          } else {
            parts.push(`- ${childText.trim()}`);
          }
        } else {
          parts.push(childText.trim());
        }
      } else if (childName === "horizontalrule") {
        if (mode === "md") parts.push("---");
      } else if (childName === "task-line") {
        parts.push(
          taskLineToString(prop(child, "taskId"), prop(child, "done"), childText, mode),
        );
      } else {
        if (childText) parts.push(childText);
      }

      if (
        childName === "paragraph" ||
        childName === "heading" ||
        childName === "quote" ||
        childName === "code" ||
        childName === "listitem" ||
        childName === "horizontalrule"
      ) {
        parts.push("\n");
      }
    } else if (child instanceof Y.XmlText) {
      const chunk = walkXmlText(child, mode);
      if (chunk) parts.push(chunk);
    }
  }

  const joined = parts.join("").replace(/\n{3,}/g, "\n\n");
  if (nodeName === "list") return joined.replace(/^\n+|\n+$/g, "") + "\n";
  return joined.replace(/^\n+|\n+$/g, "");
}

function serialize(doc: Y.Doc, mode: Mode): string {
  const root = doc.getXmlElement("root-v2");
  if (root.toArray().length === 0) return "";
  return walkXmlElement(root, mode)
    .replace(/￼/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Both derived bodies in one walk pair. Cheap enough per flush. */
export function deriveBody(doc: Y.Doc): { text: string; md: string } {
  return { text: serialize(doc, "text"), md: serialize(doc, "md") };
}

/** Task ids referenced by task lines in a doc — the trash flow detaches them
 * (NO-5 AC4) without needing a live editor. Covers both shared shapes. */
export function extractTaskLineIds(doc: Y.Doc): string[] {
  const ids = new Set<string>();
  const visitText = (node: Y.XmlText) => {
    if (node.getAttribute("__type") === "task-line") {
      const id = node.getAttribute("__taskId") as unknown;
      if (typeof id === "string" && id !== "") ids.add(id);
    }
    for (const op of node.toDelta()) {
      const v = op.insert as unknown;
      if (v instanceof Y.XmlText) visitText(v);
      else if (v instanceof Y.XmlElement) visitElement(v);
    }
  };
  const visitElement = (node: Y.XmlElement) => {
    if (node.nodeName === "task-line") {
      const id = (node.getAttribute("__taskId") ?? node.getAttribute("taskId")) as unknown;
      if (typeof id === "string" && id !== "") ids.add(id);
    }
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) visitText(child);
      else if (child instanceof Y.XmlElement) visitElement(child);
    }
  };
  visitElement(doc.getXmlElement("root-v2"));
  return [...ids];
}
