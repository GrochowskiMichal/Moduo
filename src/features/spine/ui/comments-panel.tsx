// The spine's comment pieces, shared by every surface with a thread (tasks-v2
// decision 12, extracted from Notes' Comments panel): a comment card, and a
// composer with people @mentions. Typing `@` (or the @ button) opens an inline
// list of members; picking one writes `@Name` and, if the name is still in the
// text when it's posted, notifies them. Text only: no attachments on comments
// yet (tasks-v2 Out of scope). Posting goes through the caller (usually
// `useCommentThread().post`), which reaches `comments_op_add`.
//
// References (RF-1): where the host passes `references`, `@` lists things
// after people and `/` the date commands; a picked thing is stored as its
// reference (`moduo://task/<id>`), never its title, and the body renders it
// per reader ("Private item" when they can't open it).

import { ArrowUp, AtSign, CalendarDays } from "lucide-react";
import {
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { PersonAvatar as KitPersonAvatar } from "@/components/ui/avatar";
import { FeedCard, FeedComposer, FeedComposerInput } from "@/components/ui/feed";
import { IconButton } from "@/components/ui/icon-button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { WorkspaceContext } from "../../workspaces/workspace-context";
import {
  type CommentPerson,
  commentBodyWithReferences,
  filterPeople,
  insertMention,
  keptMentionIds,
  mentionQueryAt,
  type PickedMention,
  type PickedThing,
  splitMentions,
} from "../comments";
import { type DateCommand, findHandles, matchDateCommands, triggerAt } from "../grammar";
import { resolveEntityIcon } from "../icon-map";
import { useReferenceStore } from "../references/context";
import { splitReferenceText } from "../references/text";
import type { ReferenceRef } from "../references/types";
import { DateChip } from "../references/ui/date-chip";
import { Reference } from "../references/ui/reference";

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

/**
 * A comment's text: the mentioned names marked (a status tint, R5), the
 * references it stores (`moduo://task/<id>`) as live chips that read "Private
 * item" for someone who can't open them, date chips, and the workspace's task
 * handles (`MOD-142`) linked when the reader can see the task (RF-1).
 */
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
  const taskKey = useContext(WorkspaceContext)?.selectedWorkspace?.taskKey ?? null;
  return (
    <p
      className={cn(
        "whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground",
        className,
      )}
    >
      {commentSegments(text, mentionNames).map((seg) =>
        seg.kind === "ref" ? (
          <Reference key={seg.key} type={seg.ref.type} id={seg.ref.id} display="chip" />
        ) : seg.kind === "date" ? (
          <DateChip key={seg.key} day={seg.day} />
        ) : seg.kind === "mention" ? (
          <span
            key={seg.key}
            className={cn(
              "rounded-sm px-0.5 font-medium",
              selfName && seg.text === `@${selfName}` ? "bg-primary/14" : "bg-state-active",
            )}
          >
            {seg.text}
          </span>
        ) : (
          <HandleText key={seg.key} text={seg.text} taskKey={taskKey} />
        ),
      )}
    </p>
  );
}

type CommentSegmentView =
  | { kind: "ref"; key: string; ref: ReferenceRef }
  | { kind: "date"; key: string; day: string }
  | { kind: "mention"; key: string; text: string }
  | { kind: "text"; key: string; text: string };

/** A body's parts in order, each with a positional key (they never reorder). */
function commentSegments(text: string, mentionNames: string[]): CommentSegmentView[] {
  const out: CommentSegmentView[] = [];
  splitReferenceText(text).forEach((part, p) => {
    if (part.kind === "ref") out.push({ kind: "ref", key: `${p}`, ref: part.ref });
    else if (part.kind === "date") out.push({ kind: "date", key: `${p}`, day: part.day });
    else {
      splitMentions(part.text, mentionNames).forEach((seg, i) => {
        out.push({ kind: seg.mention ? "mention" : "text", key: `${p}.${i}`, text: seg.text });
      });
    }
  });
  return out;
}

/** Plain words with the workspace's task handles linked (when the reader can see the task). */
function HandleText({ text, taskKey }: { text: string; taskKey: string | null }) {
  const handles = taskKey ? findHandles(text, [taskKey]) : [];
  if (handles.length === 0) return <span>{text}</span>;
  const out: ReactNode[] = [];
  let last = 0;
  for (const h of handles) {
    if (h.start > last) out.push(text.slice(last, h.start));
    out.push(<HandleReference key={h.start} handle={h.handle} />);
    last = h.end;
  }
  if (last < text.length) out.push(text.slice(last));
  return <span>{out}</span>;
}

/** A typed handle: a task chip once it resolves to a task you can see, else the text. */
function HandleReference({ handle }: { handle: string }) {
  const store = useReferenceStore();
  const [taskId, setTaskId] = useState<string | null>(null);
  useEffect(() => {
    if (!store) return;
    let live = true;
    void store.resolveHandle(handle).then((id) => {
      if (live) setTaskId(id);
    });
    return () => {
      live = false;
    };
  }, [store, handle]);
  if (!taskId) return <>{handle}</>;
  return <Reference type="task" id={taskId} display="chip" />;
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

/** A thing `@` can name in a comment (RF-1): a registry search's answer. */
export type ComposerThing = { ref: ReferenceRef; label: string; icon: string | null };

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
  /**
   * References in comments (RF-1): `@` also lists things after people (this
   * search), and `/` offers the date commands. A picked thing is written
   * `@Title` while typing and stored as its reference, never its title.
   */
  references?: { search: (query: string) => Promise<ComposerThing[]> };
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

type ListItem =
  | { kind: "person"; key: string; person: CommentPerson }
  | { kind: "thing"; key: string; thing: ComposerThing }
  | { kind: "command"; key: string; command: DateCommand };

/** What the caret sits after: an `@` mention, or a `/` command when references are on. */
function composerTriggerAt(
  text: string,
  caret: number,
  withCommands: boolean,
): { sigil: "@" | "/"; start: number; query: string } | null {
  const mention = mentionQueryAt(text, caret);
  if (mention) return { sigil: "@", ...mention };
  if (!withCommands) return null;
  const slash = triggerAt(text.slice(0, caret), ["/"]);
  return slash ? { sigil: "/", start: slash.start, query: slash.query } : null;
}

/**
 * The comment box. ⌘/Ctrl+Enter posts, Enter is a new line. While the inline
 * list is open, ↑/↓ move, Enter or Tab picks and Esc closes it.
 */
export function CommentComposer({
  people,
  onSubmit,
  placeholder = "Leave a comment…  @ to mention",
  prepareBody = (t) => t,
  leading,
  tools,
  references,
  disabled = false,
  className,
  ...props
}: ComposerProps) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [mentions, setMentions] = useState<PickedMention[]>([]);
  const [things, setThings] = useState<PickedThing[]>([]);
  const [thingResults, setThingResults] = useState<{ query: string; items: ComposerThing[] }>({
    query: "",
    items: [],
  });
  const [posting, setPosting] = useState(false);
  const [active, setActive] = useState(0);
  // The trigger whose list was dismissed with Esc stays closed until the query changes.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const postingRef = useRef(false);
  const pendingCaret = useRef<number | null>(null);
  const listId = useId();

  const at = composerTriggerAt(text, caret, Boolean(references));
  const search = references?.search;
  const thingQuery = at?.sigil === "@" && search ? at.query.trim() : "";

  // Things for `@` (after people), debounced; a stale answer is dropped.
  useEffect(() => {
    if (!search || !thingQuery) return;
    let live = true;
    const timer = setTimeout(() => {
      void search(thingQuery)
        .then((items) => {
          if (live) setThingResults({ query: thingQuery, items });
        })
        .catch(() => {
          if (live) setThingResults({ query: thingQuery, items: [] });
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search, thingQuery]);

  const items: ListItem[] = [];
  if (at?.sigil === "@") {
    for (const p of filterPeople(people, at.query)) {
      items.push({ kind: "person", key: `p:${p.id}`, person: p });
    }
    if (thingQuery && thingResults.query === thingQuery) {
      for (const t of thingResults.items.slice(0, 6)) {
        items.push({ kind: "thing", key: `t:${t.ref.type}:${t.ref.id}`, thing: t });
      }
    }
  } else if (at?.sigil === "/") {
    for (const c of matchDateCommands(at.query)) {
      // The calendar `/date` opens lives in rich text; a comment names the day.
      if (!c.picker) items.push({ kind: "command", key: `c:${c.id}`, command: c });
    }
  }
  const listOpen = !!at && at.start !== dismissedAt && items.length > 0 && !disabled;
  const activeIndex = Math.min(active, Math.max(0, items.length - 1));

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
    if (
      dismissedAt !== null &&
      composerTriggerAt(next, nextCaret, Boolean(references))?.start !== dismissedAt
    ) {
      setDismissedAt(null);
    }
  };

  const pick = (item: ListItem) => {
    if (!at) return;
    let next: { text: string; caret: number };
    if (item.kind === "command") {
      const inserted = `/${item.command.word} `;
      const after = text.slice(caret).replace(/^ /, "");
      next = {
        text: `${text.slice(0, at.start)}${inserted}${after}`,
        caret: at.start + inserted.length,
      };
    } else if (item.kind === "thing") {
      next = insertMention(text, at.start, caret, item.thing.label);
      setThings((prev) => [...prev, { ref: item.thing.ref, label: item.thing.label }]);
    } else {
      next = insertMention(text, at.start, caret, item.person.name);
      setMentions((prev) => [...prev, { id: item.person.id, label: item.person.name }]);
    }
    pendingCaret.current = next.caret;
    update(next.text, next.caret);
    // A picked command stays closed (its words would match it again, and
    // Enter would pick it again instead of starting a new line).
    if (item.kind === "command") setDismissedAt(at.start);
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
      const stored = references ? commentBodyWithReferences(body, things, mentions) : body;
      await onSubmit(stored, keptMentionIds(text, mentions));
      setText("");
      setCaret(0);
      setMentions([]);
      setThings([]);
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
                  setActive((activeIndex + step + items.length) % items.length);
                  return;
                }
                if ((e.key === "Enter" && !e.metaKey && !e.ctrlKey) || e.key === "Tab") {
                  e.preventDefault();
                  const item = items[activeIndex];
                  if (item) pick(item);
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
        className="w-64 p-1"
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
        <div
          role="listbox"
          id={listId}
          aria-label={at?.sigil === "/" ? "Commands" : references ? "Mention" : "People"}
        >
          {items.map((item, i) => (
            <div
              key={item.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(item)}
              onKeyDown={() => {}}
              className={cn(
                "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 font-sans text-sm text-foreground",
                i === activeIndex && "bg-state-active",
              )}
            >
              {item.kind === "person" ? (
                <>
                  <PersonAvatar person={item.person} />
                  <span className="truncate">{item.person.name}</span>
                </>
              ) : item.kind === "thing" ? (
                <>
                  <ThingIcon type={item.thing.ref.type} icon={item.thing.icon} />
                  <span className="truncate">{item.thing.label}</span>
                </>
              ) : (
                <>
                  <CalendarDays
                    aria-hidden
                    className="size-icon-sm shrink-0 text-muted-foreground"
                  />
                  <span className="truncate">{item.command.label}</span>
                </>
              )}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ThingIcon({ type, icon }: { type: string; icon: string | null }) {
  const Icon = resolveEntityIcon(type, icon);
  return <Icon aria-hidden className="size-icon-sm shrink-0 text-muted-foreground" />;
}
