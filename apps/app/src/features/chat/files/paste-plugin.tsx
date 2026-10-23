// A paste of files only (a copied screenshot) goes to the composer's files
// (CV-9); a paste with words stays the clean text paste CV-7b built.

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_CRITICAL, PASTE_COMMAND } from "lexical";
import { useEffect, useRef } from "react";

import { pastedFiles } from "@/features/attachments/files";

export function FilePastePlugin({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [editor] = useLexicalComposerContext();
  const live = useRef(onFiles);
  live.current = onFiles;
  useEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          if (!(event instanceof ClipboardEvent)) return false;
          const files = pastedFiles(event.clipboardData);
          if (files.length === 0) return false;
          event.preventDefault();
          live.current(files);
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    [editor],
  );
  return null;
}
