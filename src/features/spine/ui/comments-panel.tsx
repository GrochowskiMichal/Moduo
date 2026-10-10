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

import { PersonAvatar as KitPersonAvatar } from "@/components/ui/avatar";
import { FeedCard, FeedComposer, FeedComposerInput } from "@/components/ui/feed";
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

/**
 * A comment author's (or a mentioned person's) small avatar: the kit's two
 * initials on a stable colour (DS-6, call 43), keyed on the person's id when
 * known so it matches every other surface. Decorative: a name always sits
 * beside it. Someone the app can't resolve (an API key, a former member) is a
 * gray "?", like an unknown assignee; never the empty "unassigned" ring.
 */
export function PersonAvatar({
  person,
  className,
}: {
  person: (Pick<CommentPerson, "name" | "avatarUrl"> & { id?: string }) | null;
  className?: string;
}) {
  return (
    <KitPersonAvatar
      name={person?.name || "?"}
      id={person?.id}
      src={person?.avatarUrl}
      size="icon"
      className={className}
    />
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
  author: (Pick<CommentPerson, "name" | "avatarUrl"> & { id?: string }) | null;
  authorName: string;
  time: string;
  /** The full date, as a tooltip on the relative time. */
  timeTitle?: string;
  children: ReactNode;
}) {
  return (
    <FeedCard
      avatar={<PersonAvatar person={author} />}
      author={authorName}
      time={time}
      timeTitle={timeTitle}
    >
      {children}
    </FeedCard>
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
  const boxRef = useRef<HTMLDivElement>(null);
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
    // Scroll only past the max height; below it a sub-pixel overflow would
    // still draw the thin bar.
    el.style.overflowY = el.scrollHeight > el.clientHeight + 1 ? "auto" : "hidden";
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
        <FeedComposer
          ref={boxRef}
          className={className}
          leading={leading}
          actions={
            <>
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
            </>
          }
        >
          <FeedComposerInput
            ref={areaRef}
            value={text}
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
          />
        </FeedComposer>
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
        onPointerDownOutside={(e) => {
          // Moving the caret in the box itself isn't leaving the list.
          if (boxRef.current?.contains(e.target as Node)) return;
          setDismissedAt(at?.start ?? null);
        }}
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
