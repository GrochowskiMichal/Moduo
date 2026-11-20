// To, Cc and Bcc as token inputs (specs/mail-v3.md §9, AC30). Typing asks the
// engine's correspondents for that query (debounced 120 ms) and ranks them with
// your contacts; a suggestion, a comma or Enter makes a token, and Backspace on
// an empty input removes the last one. "Cc Bcc" reveals the other two fields;
// they show on their own when they already hold someone (reply all keeps Cc).

import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { FLOATING_SURFACE } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

import { addressEmail } from "../compose";
import { addEntry, entryLabel, personEntry, removeEntryAt, splitEntries } from "./address-list";
import { rankRecipients, type RecipientCandidate } from "./autocomplete";

export type Person = { name: string; email: string };
export type Correspondent = Person & { count: number };
/** The engine's correspondents for a typed query (`MailComposeEngine.correspondents`). */
export type SuggestPeople = (query: string) => Promise<Correspondent[]>;

/** How long typing settles before the engine is asked (spec §9). */
export const SUGGEST_DEBOUNCE_MS = 120;
const SUGGEST_LIMIT = 5;
/** A whole address: something@domain.tld, no spaces or brackets. */
const COMPLETE_ADDRESS = /^[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,".]{2,}$/;

/** Ranked suggestions for `query`, read from the engine after the debounce. */
function useSuggestions(
  query: string,
  suggest: SuggestPeople | undefined,
  contacts: readonly Person[],
  exclude: readonly string[],
): RecipientCandidate[] {
  const [found, setFound] = useState<{ query: string; people: Correspondent[] } | null>(null);
  const q = query.trim();
  useEffect(() => {
    if (!q || !suggest) return;
    let gone = false;
    const t = setTimeout(() => {
      void suggest(q).then(
        (people) => !gone && setFound({ query: q, people }),
        () => !gone && setFound({ query: q, people: [] }),
      );
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      gone = true;
      clearTimeout(t);
    };
  }, [q, suggest]);
  if (!q) return [];
  return rankRecipients({
    query: q,
    contacts: [...contacts],
    correspondents: found?.query === q ? found.people : [],
    exclude: [...exclude],
    limit: SUGGEST_LIMIT,
  });
}

type FieldProps = {
  label: "To" | "Cc" | "Bcc";
  value: string;
  onChange: (next: string) => void;
  suggest?: SuggestPeople;
  contacts?: readonly Person[];
  autoFocus?: boolean;
  /** Right of the field (the To row's "Cc Bcc" reveal). */
  trailing?: ReactNode;
};

function SuggestionList({
  label,
  hits,
  active,
  onPick,
}: {
  label: string;
  hits: RecipientCandidate[];
  active: number;
  onPick: (p: RecipientCandidate) => void;
}) {
  return (
    <ul
      role="listbox"
      aria-label={`${label} suggestions`}
      className={cn(
        FLOATING_SURFACE,
        "absolute top-full left-14 z-(--z-popover) flex min-w-64 flex-col p-1 shadow-md",
      )}
    >
      {hits.map((p, i) => (
        <li
          key={p.email}
          role="option"
          aria-selected={i === active}
          className={cn(
            "flex cursor-default items-center gap-2 rounded-sm px-2 py-1 text-sm",
            i === active && "bg-state-active",
          )}
          // Keep focus in the input: the pick happens on mouse down.
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(p);
          }}
        >
          <span className="truncate text-foreground">{p.name || p.email}</span>
          {p.name ? (
            <span className="truncate text-xs text-muted-foreground">{p.email}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** One token row: the label, the tokens, the input and its suggestions. */
export function RecipientField(props: FieldProps) {
  const { label, value, onChange } = props;
  const [draft, setDraft] = useState("");
  const [active, setActive] = useState(0);
  const entries = splitEntries(value);
  const hits = useSuggestions(
    draft,
    props.suggest,
    props.contacts ?? [],
    entries.map((e) => addressEmail(e)),
  );

  const commit = (entry: string) => {
    const text = entry.trim();
    if (text) onChange(addEntry(value, text));
    setDraft("");
    setActive(0);
  };
  const pick = (p: RecipientCandidate) => commit(personEntry(p));

  const move = (step: number) => setActive((a) => (a + step + hits.length) % hits.length);
  const take = () => {
    // A complete address you typed is the one you meant: a suggestion wins only
    // when it is that same address (and brings its name).
    const typed = addressEmail(draft);
    if (COMPLETE_ADDRESS.test(typed)) {
      const same = hits.find((h) => h.email.toLowerCase() === typed);
      if (same) pick(same);
      else commit(draft);
      return;
    }
    const hit = hits[active];
    if (hit) pick(hit);
    else commit(draft);
  };
  // Which key does what; a handler returning false leaves the key to the input.
  const keys: Record<string, () => boolean> = {
    ArrowDown: () => hits.length > 0 && (move(1), true),
    ArrowUp: () => hits.length > 0 && (move(-1), true),
    Enter: () => !!draft.trim() && (take(), true),
    ",": () => (take(), true),
    Backspace: () =>
      !draft && entries.length > 0 && (onChange(removeEntryAt(value, entries.length - 1)), true),
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (keys[e.key]?.()) e.preventDefault();
  };

  return (
    <div className="relative flex min-h-(--ctrl-h-sm) items-center gap-2 border-b border-hairline px-3 text-sm">
      <span className="w-12 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-1">
        {entries.map((entry, i) => (
          <Chip
            key={`${entry}-${i}`}
            size="xs"
            shape="full"
            title={addressEmail(entry) || entry}
            onRemove={() => onChange(removeEntryAt(value, i))}
            removeLabel={`Remove ${entryLabel(entry)}`}
          >
            {entryLabel(entry)}
          </Chip>
        ))}
        <Input
          variant="bare"
          size="sm"
          aria-label={label}
          autoComplete="off"
          autoFocus={props.autoFocus}
          placeholder={entries.length ? "Add a person" : "Name or address"}
          className="min-w-24 flex-1"
          value={draft}
          onChange={(e) => {
            const next = e.target.value;
            // A pasted or typed comma ends an entry.
            if (next.includes(",")) {
              const parts = next.split(",");
              let out = value;
              for (const part of parts.slice(0, -1))
                if (part.trim()) out = addEntry(out, part.trim());
              if (out !== value) onChange(out);
              setDraft(parts.at(-1) ?? "");
            } else setDraft(next);
            setActive(0);
          }}
          onBlur={() => {
            if (addressEmail(draft)) commit(draft);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {props.trailing}
      {hits.length > 0 ? (
        <SuggestionList label={label} hits={hits} active={active} onPick={pick} />
      ) : null}
    </div>
  );
}

/** To, then Cc and Bcc once revealed (or already filled). */
export function RecipientRows(props: {
  to: string;
  cc: string;
  bcc: string;
  onChange: (patch: { to?: string; cc?: string; bcc?: string }) => void;
  suggest?: SuggestPeople;
  contacts?: readonly Person[];
  autoFocus?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const open = revealed || !!props.cc.trim() || !!props.bcc.trim();
  const shared = { suggest: props.suggest, contacts: props.contacts };
  return (
    <>
      <RecipientField
        label="To"
        value={props.to}
        onChange={(to) => props.onChange({ to })}
        autoFocus={props.autoFocus}
        trailing={
          open ? null : (
            <Button variant="ghost" size="sm" onClick={() => setRevealed(true)}>
              Cc Bcc
            </Button>
          )
        }
        {...shared}
      />
      {open ? (
        <>
          <RecipientField
            label="Cc"
            value={props.cc}
            onChange={(cc) => props.onChange({ cc })}
            {...shared}
          />
          <RecipientField
            label="Bcc"
            value={props.bcc}
            onChange={(bcc) => props.onChange({ bcc })}
            {...shared}
          />
        </>
      ) : null}
    </>
  );
}
