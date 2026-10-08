// The spine's comment pieces, shared by every surface with a thread (tasks-v2
// decision 12, extracted from Notes' Comments panel): a comment card, and a
// composer with people @mentions. Typing `@` (or the @ button) opens an inline
// list of members; picking one writes `@Name` and, if the name is still in the
// text when it's posted, notifies them. Text only: no attachments on comments
// yet (tasks-v2 Out of scope). Posting goes through the caller (usually
// `useCommentThread().post`), which reaches `comments_op_add`.

import { ArrowUp, AtSign } from "lucide-react";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { IconButton } from "@/components/ui/icon-button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  type CommentPerson,
  filterPeople,
  insertMention,
  keptMentionIds,
  mentionQueryAt,
  type PickedMention,
  splitMentions,
} from "../comments";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

/** A comment author's (or a mentioned person's) small round avatar. */
export function PersonAvatar({
  person,
  className,
}: {
  person: Pick<CommentPerson, "name" | "avatarUrl"> | null;
  className?: string;
}) {
  return (
    // Decorative: a name always sits beside it.
    <Avatar size="sm" aria-hidden className={cn("size-4", className)}>
      {person?.avatarUrl ? <AvatarImage src={person.avatarUrl} alt="" /> : null}
      <AvatarFallback className="text-2xs">{person ? initials(person.name) : "?"}</AvatarFallback>
    </Avatar>
  );
}

/** A comment's text, with the mentioned names marked (a status tint, R5). */
export function CommentBody({
  text,
  mentionNames,
  selfName,
  className,
}: {
  text: string;
  /** Names that read as mentions when written `@Name`. */
  mentionNames: string[];
  /** My name: a mention of me gets the accent tint, others stay neutral. */
  selfName?: string | null;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground",
        className,
      )}
    >
      {splitMentions(text, mentionNames).map((seg, i) =>
        seg.mention ? (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
            key={i}
            className={cn(
              "rounded-sm px-0.5 font-medium",
              selfName && seg.text === `@${selfName}` ? "bg-primary/14" : "bg-state-active",
            )}
          >
            {seg.text}
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
          <span key={i}>{seg.text}</span>
        ),
      )}
    </p>
  );
}

/** One comment: avatar, author, when, then the body (and anything above it, e.g. a quote). */
export function CommentCard({
  author,
  authorName,
  time,
  timeTitle,
  children,
}: {
  author: Pick<CommentPerson, "name" | "avatarUrl"> | null;
  authorName: string;
  time: string;
  /** The full date, as a tooltip on the relative time. */
  timeTitle?: string;
  children: ReactNode;
}) {
  return (
    <article className="rounded-lg border border-hairline px-3 py-2.5">
      <header className="mb-1 flex min-w-0 items-center gap-2 font-sans text-xs text-muted-foreground">
        <PersonAvatar person={author} />
        <span className="truncate font-medium text-foreground">{authorName}</span>
        <span aria-hidden>·</span>
        <time className="shrink-0 tabular-nums" title={timeTitle}>
          {time}
        </time>
      </header>
      {children}
    </article>
  );
}

type ComposerProps = {
  /** Who can be @mentioned (usually active members other than me). */
  people: CommentPerson[];
  /** Post the comment. Rejects on failure (the text stays). */
  onSubmit: (body: string, mentionedUserIds: string[]) => Promise<void>;
  placeholder?: string;
  /** The body actually posted (e.g. Notes prefixes a quote). Defaults to the text. */
  prepareBody?: (text: string) => string;
  /** Shown above the text, inside the box (e.g. the quote being replied to). */
  leading?: ReactNode;
  /** Extra buttons before the @ button (e.g. Quote). */
  tools?: ReactNode;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

/**
 * The comment box. ⌘/Ctrl+Enter posts, Enter is a new line. While the inline
 * @ list is open, ↑/↓ move, Enter or Tab picks and Esc closes it.
 */
export function CommentComposer({
  people,
  onSubmit,
  placeholder = "Leave a comment…  @ to mention",
  prepareBody = (t) => t,
  leading,
  tools,
  disabled = false,
  className,
  ...props
}: ComposerProps) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [mentions, setMentions] = useState<PickedMention[]>([]);
  const [posting, setPosting] = useState(false);
  const [active, setActive] = useState(0);
  // The `@` whose list was dismissed with Esc stays closed until the query changes.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const postingRef = useRef(false);
  const pendingCaret = useRef<number | null>(null);
  const listId = useId();

  const at = mentionQueryAt(text, caret);
  const matches = at ? filterPeople(people, at.query) : [];
  const listOpen = !!at && at.start !== dismissedAt && matches.length > 0 && !disabled;
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1));

  // Grow with the text (WebKit desktop builds don't all have field-sizing).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // Put the caret after an inserted mention once React has rendered the text.
  useEffect(() => {
    const el = areaRef.current;
    if (el && pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  const update = (next: string, nextCaret: number) => {
    setText(next);
    setCaret(nextCaret);
    setActive(0);
    if (dismissedAt !== null && mentionQueryAt(next, nextCaret)?.start !== dismissedAt) {
      setDismissedAt(null);
    }
  };

  const pick = (person: CommentPerson) => {
    if (!at) return;
    const next = insertMention(text, at.start, caret, person.name);
    setMentions((prev) => [...prev, { id: person.id, label: person.name }]);
    pendingCaret.current = next.caret;
    update(next.text, next.caret);
    areaRef.current?.focus();
  };

  const startMention = () => {
    const el = areaRef.current;
    const pos = el ? el.selectionStart : text.length;
    const before = text.slice(0, pos);
    const insert = before === "" || /\s$/.test(before) ? "@" : " @";
    const next = `${before}${insert}${text.slice(pos)}`;
    pendingCaret.current = pos + insert.length;
    update(next, pos + insert.length);
    el?.focus();
  };

  const body = prepareBody(text);
  const canPost = !disabled && !posting && body.trim().length > 0;

  const post = async () => {
    if (!canPost || postingRef.current) return;
    postingRef.current = true;
    setPosting(true);
    try {
      await onSubmit(body, keptMentionIds(text, mentions));
      setText("");
      setCaret(0);
      setMentions([]);
      setDismissedAt(null);
    } catch (e) {
      toast.error("Couldn’t post the comment", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      postingRef.current = false;
      setPosting(false);
    }
  };

  return (
    <Popover open={listOpen}>
      <PopoverAnchor asChild>
        <div
          className={cn(
            "rounded-lg border border-hairline bg-transparent transition-[border-color] duration-(--motion-fade) ease-(--ease-out)",
            "focus-within:border-border",
            className,
          )}
        >
          {leading ? <div className="px-3 pt-2">{leading}</div> : null}
          <div className="flex items-end gap-1 py-1 pr-1 pl-3">
            <textarea
              ref={areaRef}
              value={text}
              rows={1}
              disabled={disabled}
              placeholder={placeholder}
              aria-label={props["aria-label"] ?? "Comment"}
              aria-autocomplete="list"
              aria-controls={listOpen ? listId : undefined}
              aria-activedescendant={listOpen ? `${listId}-${activeIndex}` : undefined}
              onChange={(e) => update(e.target.value, e.target.selectionStart)}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
              onKeyDown={(e) => {
                if (listOpen) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const step = e.key === "ArrowDown" ? 1 : -1;
                    setActive((activeIndex + step + matches.length) % matches.length);
                    return;
                  }
                  if ((e.key === "Enter" && !e.metaKey && !e.ctrlKey) || e.key === "Tab") {
                    e.preventDefault();
                    pick(matches[activeIndex]);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setDismissedAt(at?.start ?? null);
                    return;
                  }
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void post();
                }
              }}
              className={cn(
                "max-h-60 min-h-6 flex-1 resize-none self-center bg-transparent py-0.5 font-sans text-sm leading-relaxed text-foreground outline-none",
                "placeholder:text-muted-foreground disabled:cursor-not-allowed",
              )}
            />
            {tools}
            <IconButton
              icon={AtSign}
              label="Mention someone"
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={startMention}
            />
            <IconButton
              icon={ArrowUp}
              label="Comment"
              tooltip={
                <span>
                  Comment <span className="text-muted-foreground">⌘↵</span>
                </span>
              }
              disabled={!canPost}
              onClick={() => void post()}
            />
          </div>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="top"
        className="w-56 p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          setDismissedAt(at?.start ?? null);
        }}
        onPointerDownOutside={() => setDismissedAt(at?.start ?? null)}
      >
        <div role="listbox" id={listId} aria-label="People">
          {matches.map((p, i) => (
            <div
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(p)}
              onKeyDown={() => {}}
              className={cn(
                "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 font-sans text-sm text-foreground",
                i === activeIndex && "bg-state-active",
              )}
            >
              <PersonAvatar person={p} />
              <span className="truncate">{p.name}</span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
