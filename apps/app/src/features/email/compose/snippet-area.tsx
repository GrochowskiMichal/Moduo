// The message field with its `;;` snippet popup (specs/mail-v3.md §9, AC31):
// typing `;;` lists each `;;key` with its filled preview, typing filters, Tab or
// Enter inserts with the placeholders resolved, ↑/↓ move, Esc dismisses. An
// unknown key shows the help line. The toolbar under the field hints ";; snippets".

import { type KeyboardEvent, type ReactNode, useState } from "react";

import { Kbd } from "@/components/ui/kbd";

import { SnippetPopup } from "./composer-parts";
import {
  findSnippetTrigger,
  insertSnippet,
  type MailSnippet,
  matchSnippets,
  type SnippetContext,
  snippetMissLine,
  snippetPreview,
} from "./snippets";

const MAX_HITS = 6;

export function useSnippetPopup(input: {
  text: string;
  snippets: readonly MailSnippet[];
  ctx: SnippetContext;
  onInsert: (text: string) => void;
}) {
  const { text, ctx } = input;
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const trigger = findSnippetTrigger(text, text.length);
  const open = trigger !== null && trigger.start !== dismissed;
  const hits = open
    ? matchSnippets([...input.snippets], trigger.query)
        .slice(0, MAX_HITS)
        .map((snippet) => ({ snippet, preview: snippetPreview(snippet, ctx) }))
    : [];
  const at = Math.min(active, Math.max(0, hits.length - 1));

  const pick = (s: MailSnippet) => {
    const out = insertSnippet(text, text.length, s, ctx);
    if (out) input.onInsert(out.text);
    setActive(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setDismissed(trigger.start);
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && hits.length > 0) {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((at + step + hits.length) % hits.length);
    } else if ((e.key === "Tab" || e.key === "Enter") && hits[at] && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      pick(hits[at].snippet);
    }
  };

  const firstName = ctx.recipient
    ? (ctx.recipient.name.trim() || ctx.recipient.email.split("@")[0] || "").split(/\s+/)[0]!
    : "";
  return {
    open,
    hits,
    active: at,
    // An empty `;;` with no snippets at all says nothing; a typed key that matches none explains.
    missLine: open && hits.length === 0 && trigger.query ? snippetMissLine(trigger.query) : null,
    firstName,
    onKeyDown,
    pick,
  };
}

export type SnippetPopupState = ReturnType<typeof useSnippetPopup>;

export function SnippetArea(props: { popup: SnippetPopupState; children: ReactNode }) {
  const { popup } = props;
  const shown = popup.open && (popup.hits.length > 0 || popup.missLine !== null);
  return (
    <>
      {props.children}
      {shown ? (
        <SnippetPopup
          hits={popup.hits}
          active={popup.active}
          missLine={popup.missLine}
          firstName={popup.firstName}
          onPick={popup.pick}
        />
      ) : null}
      <div
        role="toolbar"
        aria-label="Writing"
        className="flex items-center justify-end gap-1 px-3 pb-1 text-xs text-muted-foreground"
      >
        <Kbd>;;</Kbd> snippets
      </div>
    </>
  );
}
