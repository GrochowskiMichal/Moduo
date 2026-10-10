import * as React from "react";

import { cn } from "@/lib/utils";

/*
 * Feed — the history under an item (DS-6, promoted from the spine's comment
 * pieces and the Tasks feed; visual audit §C). Three pieces, no domain logic:
 *
 * - `FeedItem`: one quiet activity line. A 16 px avatar, a 12 px secondary
 *   line with the actor in medium weight, and the time in the tertiary level.
 * - `FeedCard`: a comment. A hairline card, the author line (avatar · name ·
 *   time) and the body.
 * - `FeedComposer`: the comment box's surface (a hairline card that firms up
 *   while focused) with a slot for the text field and one for its buttons. The
 *   spine's `CommentComposer` puts its @-mention logic inside it.
 *
 * Times use the one date grammar (call 41) and never truncate.
 */

/** One activity line: "**Maciej** set the due date · 2h". */
function FeedItem({
  avatar,
  time,
  timeTitle,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  /** A `PersonAvatar` (icon size), decorative. */
  avatar?: React.ReactNode;
  /** Short time ("2h", "Oct 16"). */
  time?: React.ReactNode;
  /** The full date, as a tooltip on the short time. */
  timeTitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="feed-item"
      className={cn(
        "flex min-w-0 items-start gap-2 font-sans text-xs text-muted-foreground",
        className,
      )}
      {...props}
    >
      {avatar ? <span className="mt-px flex shrink-0">{avatar}</span> : null}
      <p className="min-w-0 leading-relaxed [&_b]:font-medium [&_b]:text-foreground">
        {children}
        {time ? (
          <>
            {" "}
            <time
              className="whitespace-nowrap text-subtle-foreground tabular-nums"
              title={timeTitle}
            >
              · {time}
            </time>
          </>
        ) : null}
      </p>
    </div>
  );
}

/** A comment: the author line, then the body. */
function FeedCard({
  avatar,
  author,
  time,
  timeTitle,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"article">, "children"> & {
  avatar?: React.ReactNode;
  author: React.ReactNode;
  time?: React.ReactNode;
  timeTitle?: string;
  children: React.ReactNode;
}) {
  return (
    <article
      data-slot="feed-card"
      className={cn("rounded-lg border border-hairline px-3 py-2.5", className)}
      {...props}
    >
      <header className="mb-1 flex min-w-0 items-center gap-2 font-sans text-xs text-muted-foreground">
        {avatar ? <span className="flex shrink-0">{avatar}</span> : null}
        <span className="truncate font-medium text-foreground">{author}</span>
        {time ? (
          <>
            <span aria-hidden className="text-subtle-foreground">
              ·
            </span>
            <time
              className="shrink-0 whitespace-nowrap text-subtle-foreground tabular-nums"
              title={timeTitle}
            >
              {time}
            </time>
          </>
        ) : null}
      </header>
      {children}
    </article>
  );
}

/**
 * The composer's surface. Put a growing textarea (`FeedComposerInput`) in
 * `children` and the IconButtons in `actions`; `leading` sits above the text
 * inside the box (a quote being replied to).
 */
const FeedComposer = React.forwardRef<
  HTMLDivElement,
  Omit<React.ComponentProps<"div">, "children"> & {
    leading?: React.ReactNode;
    actions?: React.ReactNode;
    children: React.ReactNode;
  }
>(function FeedComposer({ leading, actions, className, children, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="feed-composer"
      className={cn(
        "rounded-lg border border-hairline bg-transparent transition-[border-color] duration-(--motion-fade) ease-(--ease-out)",
        "focus-within:border-border",
        className,
      )}
      {...props}
    >
      {leading ? <div className="px-3 pt-2">{leading}</div> : null}
      <div className="flex items-end gap-1 py-1 pr-1 pl-3">
        {children}
        {actions}
      </div>
    </div>
  );
});

/** The composer's text field: body text, grows with its content up to a cap. */
const FeedComposerInput = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  function FeedComposerInput({ className, rows = 1, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        data-slot="feed-composer-input"
        className={cn(
          "max-h-60 min-h-6 flex-1 resize-none self-center bg-transparent py-0.5 font-sans text-sm leading-relaxed text-foreground outline-none",
          "placeholder:text-muted-foreground disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      />
    );
  },
);

export { FeedCard, FeedComposer, FeedComposerInput, FeedItem };
