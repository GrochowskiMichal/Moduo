// ⏎ in the chat composer (spec §4, §16): ⏎ and ⌘⏎ send, ⇧⏎ makes a new line,
// and nothing happens while an input method is composing. Three signals mean
// "composing": the event's own `isComposing`; `keyCode` 229, which WebKit
// (Safari, and WKWebView in the macOS app) sends on the Enter that commits a
// Japanese, Chinese or Korean candidate after `compositionend` has fired; and
// Lexical's own composition key. The menus (`@`, `/`, `#`, `:`) claim ⏎ first
// at a higher priority, so this runs only when none is open.

import { COMMAND_PRIORITY_LOW, KEY_ENTER_COMMAND, type LexicalEditor } from "lexical";

export type EnterIntent = "send" | "newline" | "compose";

/** What a ⏎ keydown means in the composer. */
export function enterIntent(
  event: Pick<KeyboardEvent, "isComposing" | "keyCode" | "shiftKey"> | null,
  editorComposing: boolean,
): EnterIntent {
  if (editorComposing) return "compose";
  if (!event) return "send";
  if (event.isComposing || event.keyCode === 229) return "compose";
  return event.shiftKey ? "newline" : "send";
}

/**
 * Register ⏎ to send. A composing ⏎ is swallowed without `preventDefault`
 * (the input method commits its text); ⇧⏎ falls through to the editor's own
 * line break; ⏎ and ⌘⏎ call `onSend`.
 */
export function registerSendOnEnter(editor: LexicalEditor, onSend: () => void): () => void {
  return editor.registerCommand(
    KEY_ENTER_COMMAND,
    (event) => {
      const intent = enterIntent(event, editor.isComposing());
      if (intent === "compose") return true;
      if (intent === "newline") return false;
      event?.preventDefault();
      onSend();
      return true;
    },
    COMMAND_PRIORITY_LOW,
  );
}
