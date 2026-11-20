// One line cut in the middle (specs/mail-improve.md §4, §5): the head shrinks with an
// ellipsis, the tail stays whole; the full text is the tooltip.

import { cn } from "@/lib/utils";

import { middleParts } from "./attachment-name";

export function MiddleTruncate({
  text,
  keep,
  className,
}: {
  text: string;
  keep?: number;
  className?: string;
}) {
  const { head, tail } = middleParts(text, keep);
  return (
    <span title={text} className={cn("flex min-w-0", className)}>
      <span data-middle-head className="min-w-0 truncate whitespace-pre">
        {head}
      </span>
      <span data-middle-tail className="shrink-0 whitespace-pre">
        {tail}
      </span>
    </span>
  );
}
