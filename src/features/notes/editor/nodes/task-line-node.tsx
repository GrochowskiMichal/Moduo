/**
 * TaskLineNode (Wave-3 NO-5, AC3/AC4) — "a task line in a note IS the task".
 * An ElementNode carrying `taskId` with normal text children (the inline-
 * editable title — spec assumption 6). The checkbox and right-side meta are
 * NOT part of this DOM: Lexical's mutation observer reclaims any foreign DOM
 * inside its root (live-verify finding), so the companion TaskLinePlugin
 * renders them as an absolutely-positioned overlay OUTSIDE the contenteditable
 * (the playground draggable-block pattern); this node only reserves the gutter
 * space via `.notes-task-line` padding.
 *
 * `taskId === null` = minting in flight (pending dot; stamped by the plugin
 * once the real id lands — never a `tmp-` id, the known race). `done` is a
 * persisted snapshot the plugin reconciles to the live task (md export and
 * first paint read it without the tasks bundle).
 */

import {
  $applyNodeReplacement,
  $createParagraphNode,
  type EditorConfig,
  ElementNode,
  type LexicalNode,
  type NodeKey,
  type RangeSelection,
  type SerializedElementNode,
  type Spread,
} from "lexical";

export type SerializedTaskLineNode = Spread<
  {
    taskId: string | null;
    done: boolean;
  },
  SerializedElementNode
>;

export class TaskLineNode extends ElementNode {
  __taskId: string | null;
  __done: boolean;

  static getType(): string {
    return "task-line";
  }

  static clone(node: TaskLineNode): TaskLineNode {
    return new TaskLineNode(node.__taskId, node.__done, node.__key);
  }

  constructor(taskId: string | null, done = false, key?: NodeKey) {
    super(key);
    this.__taskId = taskId;
    this.__done = done;
  }

  static importJSON(serialized: SerializedTaskLineNode): TaskLineNode {
    return $createTaskLineNode(serialized.taskId ?? null, serialized.done ?? false);
  }

  exportJSON(): SerializedTaskLineNode {
    return {
      ...super.exportJSON(),
      type: "task-line",
      version: 1,
      taskId: this.__taskId,
      done: this.__done,
    };
  }

  getTaskId(): string | null {
    return this.getLatest().__taskId;
  }

  setTaskId(taskId: string | null): void {
    this.getWritable().__taskId = taskId;
  }

  getDone(): boolean {
    return this.getLatest().__done;
  }

  setDone(done: boolean): void {
    this.getWritable().__done = done;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const el = document.createElement("div");
    el.className = "notes-task-line";
    el.setAttribute("data-task-line", "true");
    this.__syncAttrs(el);
    return el;
  }

  updateDOM(_prev: TaskLineNode, el: HTMLElement): boolean {
    this.__syncAttrs(el);
    return false;
  }

  private __syncAttrs(el: HTMLElement): void {
    el.setAttribute("data-done", this.__done ? "true" : "false");
    el.setAttribute("data-pending", this.__taskId === null ? "true" : "false");
    if (this.__taskId) el.setAttribute("data-task-id", this.__taskId);
    else el.removeAttribute("data-task-id");
  }

  /** Enter at the end starts a plain paragraph — never a second line
   * pointing at the same task. */
  insertNewAfter(_selection: RangeSelection, restoreSelection?: boolean): ElementNode {
    const paragraph = $createParagraphNode();
    this.insertAfter(paragraph, restoreSelection);
    return paragraph;
  }

  /** Backspace at the start degrades the line to a plain paragraph (the
   * node's destruction runs the plugin's detach flow — one undoable toast). */
  collapseAtStart(): boolean {
    const paragraph = $createParagraphNode();
    const children = this.getChildren();
    children.forEach((child) => {
      paragraph.append(child);
    });
    this.replace(paragraph);
    return true;
  }

  canIndent(): boolean {
    return false;
  }

  isInline(): boolean {
    return false;
  }
}

export function $createTaskLineNode(taskId: string | null, done = false): TaskLineNode {
  return $applyNodeReplacement(new TaskLineNode(taskId, done));
}

export function $isTaskLineNode(node: LexicalNode | null | undefined): node is TaskLineNode {
  return node instanceof TaskLineNode;
}
