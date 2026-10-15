// Editing a message in place (round 5 frame 5 "Editing in place"): the
// message's stored text in a box under the name, ⏎ saves, ⇧⏎ breaks a line,
// Esc cancels. A stopgap until CV-7b's composer, which edits with
// `$importStored(body)` and draws references as chips; here the stored form is
// edited as it is written (references as their `moduo://` links).

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function EditBox({
  initial,
  onSave,
  onCancel,
  className,
}: {
  initial: string;
  onSave: (body: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Grow with the text (the row re-measures through the virtualizer).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  });

  return (
    <div className={cn("mt-0.5", className)}>
      <textarea
        ref={ref}
        aria-label="Edit message"
        value={text}
        rows={1}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            const body = text.replace(/\s+$/, "");
            if (!body.trim() || body === initial) onCancel();
            else onSave(body);
          }
        }}
        className="block w-full resize-none rounded-md bg-state-hover px-2.5 py-1.5 font-sans text-md leading-normal text-foreground ring-1 ring-hairline ring-inset outline-none focus-visible:ring-ring/50"
      />
      <p className="mt-1 text-xs text-subtle-foreground">Esc to cancel · ⏎ to save</p>
    </div>
  );
}
