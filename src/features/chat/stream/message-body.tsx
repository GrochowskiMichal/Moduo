// A message's body, drawn from the parsed stored form (spike 4's tree,
// `markup-v2`), cached per message id + `updated_at` (`messageTree`). One left
// edge for every block; 15 px text at every density (CH29a). Mentions of
// others are a light grey mark, `@you` the one solid accent mark in text,
// links underlined and monochrome; references are RF-1's live chips (a task
// shows its status and title as they are now, AC1.11), a card when alone on a
// line. Emoji-only messages draw large ("jumbo").

import type { ReactNode } from "react";
import { canShowAsCard, referenceKind } from "@/features/spine/references/kinds";
import { DateChip } from "@/features/spine/references/ui/date-chip";
import { Reference } from "@/features/spine/references/ui/reference";
import { cn } from "@/lib/utils";
import {
  type Block,
  BOLD,
  type Inline,
  ITALIC,
  type Marks,
  messageTree,
  PERSON_TYPE,
  STRIKE,
  TEAM_TYPE,
} from "../markup-v2";
import { tokenText } from "../markup-v2/tokens";
import type { ChatMessage, ChatPerson } from "../model";
import { isEmojiOnlyText } from "../timeline";

export type BodyContext = {
  selfId: string | null;
  personOf: (id: string) => ChatPerson | undefined;
  onPersonClick?: (userId: string) => void;
};

function withMarks(node: ReactNode, m: Marks, key: string): ReactNode {
  let out = node;
  if (m & STRIKE) out = <s className="text-muted-foreground">{out}</s>;
  if (m & ITALIC) out = <em>{out}</em>;
  if (m & BOLD) out = <strong className="font-semibold">{out}</strong>;
  return <span key={key}>{out}</span>;
}

/** A reference alone on its line (only spaces around it) draws as a card. */
function aloneOnLine(line: readonly Inline[], leaf: Inline): boolean {
  return line.every((x) => x === leaf || (x.t === "text" && x.v.trim() === ""));
}

function lines(inlines: readonly Inline[]): Inline[][] {
  const out: Inline[][] = [[]];
  for (const leaf of inlines) {
    if (leaf.t === "br") out.push([]);
    else out[out.length - 1]!.push(leaf);
  }
  return out;
}

function Mention({ label, me, onClick }: { label: string; me?: boolean; onClick?: () => void }) {
  const cls = cn(
    "rounded-sm px-0.5 font-medium",
    me ? "bg-primary text-primary-foreground" : "bg-state-active text-foreground",
  );
  if (!onClick) return <span className={cls}>{label}</span>;
  return (
    <button type="button" onClick={onClick} className={cn(cls, "cursor-default")}>
      {label}
    </button>
  );
}

function renderLine(line: readonly Inline[], ctx: BodyContext, key: string): ReactNode[] {
  return line.map((leaf, i) => {
    const k = `${key}.${i}`;
    switch (leaf.t) {
      case "text":
        return withMarks(leaf.v, leaf.m, k);
      case "code":
        return withMarks(
          <code className="rounded-sm bg-state-active px-1 font-mono text-sm">{leaf.v}</code>,
          leaf.m,
          k,
        );
      case "url":
        return withMarks(
          <a
            href={leaf.v}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-foreground underline decoration-muted-foreground underline-offset-2 hover:decoration-foreground"
          >
            {leaf.v}
          </a>,
          leaf.m,
          k,
        );
      case "link":
        return (
          <a
            key={k}
            href={leaf.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline decoration-muted-foreground underline-offset-2 hover:decoration-foreground"
          >
            {leaf.c.map((c, j) =>
              c.t === "code" ? (
                <code key={j} className="rounded-sm bg-state-active px-1 font-mono text-sm">
                  {c.v}
                </code>
              ) : (
                withMarks(c.v, c.m, `${k}.${j}`)
              ),
            )}
          </a>
        );
      case "channel":
        return withMarks(<Mention label="@channel" />, leaf.m, k);
      case "emoji":
        // Custom emoji images arrive with CV-20; until then the name reads as text.
        return withMarks(tokenText(leaf), leaf.m, k);
      case "date":
        return <DateChip key={k} day={leaf.day} className="mx-0.5 align-baseline" />;
      case "ref": {
        if (leaf.type === PERSON_TYPE) {
          const person = ctx.personOf(leaf.id);
          return (
            <Mention
              key={k}
              label={`@${person?.name ?? "former member"}`}
              me={leaf.id === ctx.selfId}
              onClick={ctx.onPersonClick ? () => ctx.onPersonClick?.(leaf.id) : undefined}
            />
          );
        }
        if (leaf.type === TEAM_TYPE) return <Mention key={k} label="@team" />;
        const card =
          leaf.type !== "tag" && aloneOnLine(line, leaf) && canShowAsCard(referenceKind(leaf.type));
        return (
          <Reference
            key={k}
            type={leaf.type}
            id={leaf.id}
            display={leaf.type === "tag" ? "link" : card ? "card" : "chip"}
            className={card ? "my-1 block max-w-md" : "mx-0.5"}
          />
        );
      }
      default:
        return null;
    }
  });
}

function renderInlines(inlines: readonly Inline[], ctx: BodyContext, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  lines(inlines).forEach((line, i) => {
    if (i > 0) out.push(<br key={`${key}.br${i}`} />);
    out.push(...renderLine(line, ctx, `${key}.l${i}`));
  });
  return out;
}

function renderBlock(block: Block, ctx: BodyContext, key: string, suffix?: ReactNode): ReactNode {
  switch (block.t) {
    case "pre":
      return (
        <pre
          key={key}
          className="scrollbar-thin overflow-x-auto rounded-md bg-state-hover px-3 py-2 font-mono text-sm leading-relaxed ring-1 ring-hairline ring-inset"
        >
          <code>{block.v}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote key={key} className="border-l-2 border-hairline pl-3 text-muted-foreground">
          {renderInlines(block.c, ctx, key)}
        </blockquote>
      );
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={`${key}.${i}`}>{renderInlines(item, ctx, `${key}.${i}`)}</li>
      ));
      return block.ordered ? (
        <ol key={key} start={block.start} className="list-decimal pl-6">
          {items}
        </ol>
      ) : (
        <ul key={key} className="list-disc pl-6">
          {items}
        </ul>
      );
    }
    default:
      return (
        <p key={key}>
          {renderInlines(block.c, ctx, key)}
          {suffix}
        </p>
      );
  }
}

/** Emoji only: one paragraph of standard emoji (and custom `:name:`), nothing else. */
export function isJumbo(blocks: readonly Block[]): boolean {
  if (blocks.length !== 1) return false;
  const b = blocks[0]!;
  if (b.t !== "p") return false;
  let text = "";
  let custom = 0;
  for (const leaf of b.c) {
    if (leaf.t === "text" && leaf.m === 0) text += leaf.v;
    else if (leaf.t === "emoji") custom += 1;
    else return false;
  }
  return isEmojiOnlyText(text, custom);
}

export function MessageBody({
  message,
  ctx,
  className,
}: {
  message: Pick<ChatMessage, "id" | "updatedAt" | "body" | "editedAt">;
  ctx: BodyContext;
  className?: string;
}) {
  const blocks = messageTree(message.id, message.updatedAt, message.body);
  const jumbo = isJumbo(blocks);
  const edited = message.editedAt ? (
    <span className="ml-1 font-sans text-xs text-subtle-foreground">(edited)</span>
  ) : null;
  const last = blocks[blocks.length - 1];
  const inline = !jumbo && last?.t === "p";
  return (
    <div
      data-slot="message-body"
      data-jumbo={jumbo ? "" : undefined}
      className={cn(
        "min-w-0 break-words font-sans text-foreground [&>*+*]:mt-1.5",
        jumbo ? "text-4xl leading-tight" : "text-md leading-normal",
        className,
      )}
    >
      {blocks.map((b, i) =>
        renderBlock(b, ctx, `b${i}`, inline && i === blocks.length - 1 ? edited : undefined),
      )}
      {inline ? null : edited}
    </div>
  );
}
