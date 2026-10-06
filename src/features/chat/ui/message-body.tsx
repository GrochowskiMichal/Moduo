// Renders a stored message body (markup.ts grammar). Mentions resolve to the
// person's CURRENT name; a mention of you gets the selection tint so it reads
// at a glance (accent only on "this is about you" — R5 selection role). Moduo
// entity refs are the spine's EntityRefChip and deep-link through the
// entity-open event, like every other ref in the app.

import { Fragment, type ReactNode } from "react";
import { EntityRefChip } from "@/features/spine/ui/entity-ref-chip";
import { ENTITY_OPEN_EVENT } from "@/lib/entity-open";
import { cn } from "@/lib/utils";
import { type Block, type Inline, isEmojiOnly, parseBody } from "../markup";
import type { ChatPerson } from "../model";

type Ctx = {
  selfId: string | null;
  personOf: (id: string) => ChatPerson | undefined;
  onPersonClick?: (userId: string) => void;
};

function renderInline(nodes: Inline[], ctx: Ctx, keyPrefix: string): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}.${i}`;
    switch (n.t) {
      case "text":
        return <Fragment key={key}>{n.v}</Fragment>;
      case "code":
        return (
          <code
            key={key}
            className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs text-foreground"
          >
            {n.v}
          </code>
        );
      case "bold":
        return (
          <strong key={key} className="font-semibold">
            {renderInline(n.c, ctx, key)}
          </strong>
        );
      case "italic":
        return <em key={key}>{renderInline(n.c, ctx, key)}</em>;
      case "strike":
        return (
          <s key={key} className="text-muted-foreground">
            {renderInline(n.c, ctx, key)}
          </s>
        );
      case "link":
        return (
          <a
            key={key}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
          >
            {n.label}
          </a>
        );
      case "mention": {
        const person = ctx.personOf(n.userId);
        const isSelf = n.userId === ctx.selfId;
        return (
          <button
            key={key}
            type="button"
            onClick={() => ctx.onPersonClick?.(n.userId)}
            className={cn(
              "inline rounded-sm px-0.5 font-medium transition-colors",
              isSelf
                ? "bg-(--selected-bg) text-foreground"
                : "bg-muted text-foreground hover:bg-accent",
            )}
          >
            @{person?.name ?? "former member"}
          </button>
        );
      }
      case "channel":
        return (
          <span
            key={key}
            className="rounded-sm bg-(--selected-bg) px-0.5 font-medium text-foreground"
          >
            @channel
          </span>
        );
      case "entity":
        return (
          <EntityRefChip
            key={key}
            type={n.type}
            label={n.label || n.type}
            className="mx-0.5"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent(ENTITY_OPEN_EVENT, { detail: { type: n.type, id: n.id } }),
              )
            }
          />
        );
      default:
        return null;
    }
  });
}

function renderBlock(block: Block, ctx: Ctx, key: string): ReactNode {
  if (block.t === "pre") {
    return (
      <pre
        key={key}
        className="scrollbar-thin my-1 overflow-x-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs leading-relaxed text-foreground"
      >
        <code>{block.v}</code>
      </pre>
    );
  }
  if (block.t === "quote") {
    return (
      <blockquote key={key} className="my-0.5 border-l-2 border-border pl-3 text-muted-foreground">
        {renderInline(block.c, ctx, key)}
      </blockquote>
    );
  }
  return <p key={key}>{renderInline(block.c, ctx, key)}</p>;
}

export function MessageBody({
  body,
  selfId,
  personOf,
  onPersonClick,
  edited,
  className,
}: Ctx & { body: string; edited?: boolean; className?: string }) {
  const jumbo = isEmojiOnly(body);
  const blocks = parseBody(body);
  const ctx = { selfId, personOf, onPersonClick };
  return (
    <div
      className={cn(
        "min-w-0 break-words whitespace-pre-wrap font-sans leading-relaxed text-foreground",
        jumbo ? "text-4xl leading-tight" : "text-sm",
        className,
      )}
    >
      {blocks.map((b, i) => renderBlock(b, ctx, `b${i}`))}
      {edited ? <span className="ml-1 text-2xs text-muted-foreground">(edited)</span> : null}
    </div>
  );
}
