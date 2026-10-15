// The date chip node for Lexical prose (call 33a): what `/today`, `/tomorrow`,
// `/next week` and `/date` insert in a description, a note or a comment. It
// stores the day only (`YYYY-MM-DD`) and reads "Tomorrow" while that's true,
// the plain date afterwards. In HTML it is a `<time>` whose text is the plain
// date, so any other reader (an older build, an email) still sees a date.

import {
  DecoratorNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import type { ReactNode } from "react";

import { formatDate } from "../../../lib/time-format";
import { DateChip } from "./ui/date-chip";

const DATE_ATTR = "data-moduo-date";
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export type SerializedDateNode = Spread<{ day: string }, SerializedLexicalNode>;

export class DateNode extends DecoratorNode<ReactNode> {
  __day: string;

  static getType(): string {
    return "moduo-date";
  }

  static clone(node: DateNode): DateNode {
    return new DateNode(node.__day, node.__key);
  }

  constructor(day: string, key?: NodeKey) {
    super(key);
    this.__day = day;
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "lexical-date";
    span.contentEditable = "false";
    return span;
  }

  updateDOM(): boolean {
    return false;
  }

  isInline(): boolean {
    return true;
  }

  getDay(): string {
    return this.getLatest().__day;
  }

  /** The plain date ("Oct 17"), never a relative word that goes stale in text. */
  getTextContent(): string {
    return formatDate(`${this.__day}T00:00:00`);
  }

  static importJSON(serialized: SerializedDateNode): DateNode {
    return $createDateNode(serialized.day);
  }

  exportJSON(): SerializedDateNode {
    return { type: "moduo-date", version: 1, day: this.__day };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      time: (node: HTMLElement) => {
        if (!node.hasAttribute(DATE_ATTR)) return null;
        return { conversion: convertDateElement, priority: 2 };
      },
    };
  }

  exportDOM(): DOMExportOutput {
    const time = document.createElement("time");
    time.setAttribute(DATE_ATTR, this.__day);
    time.setAttribute("datetime", this.__day);
    time.textContent = this.getTextContent();
    return { element: time };
  }

  decorate(): ReactNode {
    return <DateChip day={this.__day} />;
  }
}

function convertDateElement(node: HTMLElement): DOMConversionOutput {
  const day = node.getAttribute(DATE_ATTR) ?? "";
  if (!ISO_DAY.test(day)) return { node: null };
  return { node: $createDateNode(day) };
}

export function $createDateNode(day: string): DateNode {
  return new DateNode(day);
}

export function $isDateNode(node: unknown): node is DateNode {
  return node instanceof DateNode;
}

/** The HTML attribute a stored date chip carries (for read-only renderers). */
export const DATE_NODE_ATTR = DATE_ATTR;
