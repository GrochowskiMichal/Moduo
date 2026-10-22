import * as React from "react";

import { cn } from "@/lib/utils";

import { FIELD_FOCUS_WITHIN } from "./field-shell";

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

/** A comment: the author line, then the body (and its reactions, `footer`). */
function FeedCard({
  avatar,
  author,
  time,
  timeTitle,
  meta,
  actions,
  footer,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"article">, "children"> & {
  avatar?: React.ReactNode;
  author: React.ReactNode;
  time?: React.ReactNode;
  timeTitle?: string;
  /** A quiet word after the time ("edited"). */
  meta?: React.ReactNode;
  /** Controls at the end of the author line, shown on hover or focus (react, ⋯). */
  actions?: React.ReactNode;
  /** Under the body: the reactions row. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <article
      data-slot="feed-card"
      className={cn("group/card rounded-lg border border-hairline px-3 py-2.5", className)}
      {...props}
    >
      <header className="mb-1 flex min-h-(--ctrl-h-sm) min-w-0 flex-wrap items-center gap-x-2 font-sans text-xs text-muted-foreground">
        {avatar ? <span className="flex shrink-0">{avatar}</span> : null}
        <span className="break-words font-medium text-foreground">{author}</span>
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
        {meta ? <span className="shrink-0 text-subtle-foreground">{meta}</span> : null}
        {actions ? (
          // Kept in place and faded, so the line never jumps (R6); always on
          // for keyboard focus and while one of its menus is open.
          <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-(--motion-fade) ease-(--ease-out) focus-within:opacity-100 group-hover/card:opacity-100 has-[[aria-expanded=true]]:opacity-100">
            {actions}
          </span>
        ) : null}
      </header>
      {children}
      {footer}
    </article>
  );
}

/**
 * The filled composer's surface (chat, round 5 frame 5): a quiet fill with a
 * hairline inside it. Exported for hosts that lay out their own editor in it
 * (the chat composer's Lexical box).
 */
const FEED_COMPOSER_FILLED = "rounded-lg bg-state-hover ring-1 ring-hairline ring-inset";

/**
 * The composer's surface. Put a growing textarea (`FeedComposerInput`) in
 * `children` and the IconButtons in `actions`; `leading` sits above the text
 * inside the box (a quote being replied to). `filled` is chat's box.
 */
const FeedComposer = React.forwardRef<
  HTMLDivElement,
  Omit<React.ComponentProps<"div">, "children"> & {
    leading?: React.ReactNode;
    actions?: React.ReactNode;
    variant?: "outline" | "filled";
    children: React.ReactNode;
  }
>(function FeedComposer(
  { leading, actions, variant = "outline", className, children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="feed-composer"
      data-variant={variant}
      className={cn(
        variant === "filled"
          ? FEED_COMPOSER_FILLED
          : cn(
              "rounded-lg border border-hairline bg-transparent transition-[border-color] duration-(--motion-fade) ease-(--ease-out)",
              // A field's focus edge (MOD-160), on the box: its text, not its buttons.
              FIELD_FOCUS_WITHIN,
            ),
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

/** The composer's text field: body text, grows with its content up to a cap.
 * `md` is chat's 15 px message text (the same size at every density). */
const FeedComposerInput = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea"> & { size?: "sm" | "md" }
>(function FeedComposerInput({ className, rows = 1, size = "sm", ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      data-slot="feed-composer-input"
      className={cn(
        "max-h-60 min-h-6 flex-1 resize-none self-center bg-transparent py-0.5 font-sans text-foreground outline-none",
        size === "md" ? "text-md leading-normal" : "text-sm leading-relaxed",
        "placeholder:text-muted-foreground disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  );
});

export { FEED_COMPOSER_FILLED, FeedCard, FeedComposer, FeedComposerInput, FeedItem };
