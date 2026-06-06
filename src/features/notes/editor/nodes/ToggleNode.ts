import {
  $applyNodeReplacement,
  $createParagraphNode,
  ElementNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  type Spread,
} from "lexical";

export type SerializedToggleNode = Spread<
  {
    open: boolean;
  },
  SerializedElementNode
>;

export class ToggleNode extends ElementNode {
  __open: boolean;

  static getType(): string {
    return "toggle";
  }

  static clone(node: ToggleNode): ToggleNode {
    return new ToggleNode(node.__open, node.__key);
  }

  static importJSON(serializedNode: SerializedToggleNode): ToggleNode {
    const node = $createToggleNode(serializedNode.open);
    node.setFormat(serializedNode.format);
    node.setIndent(serializedNode.indent);
    node.setDirection(serializedNode.direction);
    return node;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      details: () => ({
        conversion: convertDetailsElement,
        priority: 1,
      }),
    };
  }

  constructor(open = true, key?: NodeKey) {
    super(key);
    this.__open = open;
  }

  exportJSON(): SerializedToggleNode {
    return {
      ...super.exportJSON(),
      open: this.__open,
      type: "toggle",
      version: 1,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement("div");
    dom.className = "notes-toggle-block";
    dom.dataset.open = String(this.__open);
    dom.dataset.toggleKey = this.getKey();

    const button = document.createElement("button");
    button.type = "button";
    button.className = "notes-toggle-caret";
    button.contentEditable = "false";
    button.ariaLabel = this.__open ? "Collapse toggle" : "Expand toggle";
    button.dataset.toggleButton = "true";
    dom.append(button);

    return dom;
  }

  updateDOM(prevNode: ToggleNode, dom: HTMLElement): boolean {
    if (prevNode.__open !== this.__open) {
      dom.dataset.open = String(this.__open);
      const button = dom.querySelector<HTMLButtonElement>(".notes-toggle-caret");
      if (button) button.ariaLabel = this.__open ? "Collapse toggle" : "Expand toggle";
    }
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("details");
    element.open = this.__open;
    return { element };
  }

  canIndent(): false {
    return false;
  }

  insertNewAfter(): LexicalNode {
    const paragraph = $createParagraphNode();
    this.insertAfter(paragraph);
    return paragraph;
  }

  collapseAtStart(): true {
    const paragraph = $createParagraphNode();
    const children = this.getChildren();
    children.forEach((child) => paragraph.append(child));
    this.replace(paragraph);
    return true;
  }

  isOpen(): boolean {
    return this.__open;
  }

  setOpen(open: boolean): void {
    const writable = this.getWritable();
    writable.__open = open;
  }

  toggleOpen(): void {
    this.setOpen(!this.__open);
  }
}

function convertDetailsElement(domNode: Node): DOMConversionOutput | null {
  if (!(domNode instanceof HTMLDetailsElement)) return null;
  return { node: $createToggleNode(domNode.open) };
}

export function $createToggleNode(open = true, initialText?: string): ToggleNode {
  const node = $applyNodeReplacement(new ToggleNode(open));
  node.append($createParagraphNode().append($createTextNode(initialText ?? "Toggle")));
  return node;
}

export function $isToggleNode(node: LexicalNode | null | undefined): node is ToggleNode {
  return node instanceof ToggleNode;
}
