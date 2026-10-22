// A search hit's snippet (CV-19): the server's plain text with the matched
// words marked. Drawn as text nodes only; the marks never pass through HTML.

import { cn } from "@/lib/utils";

import { splitSnippet } from "./model";

export function Snippet({ text, className }: { text: string; className?: string }) {
  const parts = splitSnippet(text);
  return (
    <span className={cn("min-w-0", className)} data-slot="search-snippet">
      {parts.map((p, i) =>
        p.hit ? (
          <mark
            // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
            key={i}
            className="rounded-sm bg-state-selected font-medium text-foreground"
          >
            {p.text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}
