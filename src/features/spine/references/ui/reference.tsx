// The Reference: one way to show a linked item anywhere (tasks-v3 §11, call
// 55). Four forms:
//   link  — inline text with a type icon (or the task's status icon);
//   chip  — a pill with one live fact ("○ Collect assets · Fri"; a contact is
//           avatar · name), the kit's Chip at the inline rung;
//   card  — the key facts and one action (a task completes);
//   hover — the card, on hover intent, over a link or a chip.
// It reads the item per reader from the reference store and stays live. An
// item the reader can't open is "Private item": a lock and those words, no
// title, no type icon, no hover, no click. A deleted one reads "Deleted task".
// While its facts load it is a fixed-width blank (no shimmer, no title).

import { Lock, MoreHorizontal } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { chipClasses } from "../../../../components/ui/chip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../../../../components/ui/dropdown-menu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../../../../components/ui/hover-card";
import { IconButton } from "../../../../components/ui/icon-button";
import { SegmentedControl } from "../../../../components/ui/segmented-control";
import { cn } from "../../../../lib/utils";
import { resolveEntityIcon } from "../../icon-map";
import { useCanEditTasks, useReference, useReferenceHost, useReferenceStore } from "../context";
import {
  canShowAsCard,
  deletedLabel,
  PRIVATE_ITEM_LABEL,
  referenceKind,
  referenceNoun,
} from "../kinds";
import { openReference, openReferenceFull } from "../open";
import type { ReferenceDisplay, ReferenceFacts, ReferenceKind, ReferenceRef } from "../types";
import { ReferenceCardBody, ReferenceLead } from "./reference-card";

export type ReferenceProps = {
  type: string;
  id: string;
  display?: ReferenceDisplay;
  /**
   * What an older stored chip remembered. Shown only outside the app shell,
   * where no store can resolve the item; inside it, the store decides.
   */
  fallbackLabel?: string | null;
  /** Offered in the hover card ("Show as") when the reference sits in editable text. */
  onDisplayChange?: (display: ReferenceDisplay) => void;
  className?: string;
};

export function Reference({
  type,
  id,
  display = "chip",
  fallbackLabel,
  onDisplayChange,
  className,
}: ReferenceProps) {
  const ref = useMemo<ReferenceRef>(() => ({ type, id }), [type, id]);
  const store = useReferenceStore();
  const kind = referenceKind(type);
  const shown: ReferenceDisplay = display === "card" && !canShowAsCard(kind) ? "chip" : display;
  const state = useReference(ref, shown === "card" ? "card" : "chip");

  if (!store)
    return <DetachedReference ref_={ref} kind={kind} label={fallbackLabel} className={className} />;
  if (!state || state.status === "loading")
    return <BlankReference display={shown} className={className} />;
  if (state.status === "private") return <PrivateReference display={shown} className={className} />;
  if (state.status === "deleted") {
    return <DeletedReference kind={state.kind} display={shown} className={className} />;
  }
  if (state.status === "error")
    return <UnavailableReference display={shown} className={className} />;
  return (
    <ReadyReference
      reference={ref}
      facts={state.facts}
      display={shown}
      onDisplayChange={onDisplayChange}
      className={className}
    />
  );
}

// ── the readable forms ───────────────────────────────────────────────────────

/** The accessible name: "Task: Collect assets, Fri". */
function referenceName(facts: ReferenceFacts): string {
  const noun = referenceNoun(facts.kind);
  const named = `${noun.charAt(0).toUpperCase()}${noun.slice(1)}: ${facts.kind === "tag" ? `#${facts.title}` : facts.title}`;
  return facts.fact ? `${named}, ${facts.fact}` : named;
}

function ReadyReference({
  reference,
  facts,
  display,
  onDisplayChange,
  className,
}: {
  reference: ReferenceRef;
  facts: ReferenceFacts;
  display: ReferenceDisplay;
  onDisplayChange?: (display: ReferenceDisplay) => void;
  className?: string;
}) {
  const host = useReferenceHost();
  const store = useReferenceStore();
  const [hoverOpen, setHoverOpen] = useState(false);
  const open = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    openReference(reference, event, host?.openInPanel);
  };
  const onComplete = useCompleteAction(reference, facts);

  // A tag in prose is a link to the tag; there is no tag page yet, so it reads
  // as the tag and goes nowhere (decisions/tasks.md, RF-1).
  if (facts.kind === "tag") {
    return (
      <span
        className={cn("inline-flex items-baseline gap-1 align-baseline text-foreground", className)}
        title={`Tag #${facts.title}`}
      >
        <span className="self-center">
          <ReferenceLead lead={facts.lead} />
        </span>
        <span>#{facts.title}</span>
      </span>
    );
  }

  if (display === "card") {
    return (
      <span
        data-slot="reference-card"
        className={cn(
          "group/refcard relative my-1 flex w-full max-w-xl flex-col rounded-lg bg-card px-(--pad-x-sm) py-(--pad-y-sm)",
          "ring-1 ring-hairline ring-inset transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover",
          className,
        )}
      >
        <ReferenceCardBody facts={facts} onOpen={open} onComplete={onComplete} />
        {onDisplayChange ? (
          // Later, "Show as" lives behind the card's ⋯ (research §6).
          <span className="absolute end-1 top-1 opacity-0 transition-opacity duration-(--motion-fade) ease-(--ease-out) group-focus-within/refcard:opacity-100 group-hover/refcard:opacity-100">
            <ShowAsMenu value={display} kind={facts.kind} onChange={onDisplayChange} />
          </span>
        ) : null}
      </span>
    );
  }

  const trigger =
    display === "link" ? (
      <button
        type="button"
        aria-label={referenceName(facts)}
        onClick={open}
        className={cn(
          "inline items-baseline text-left align-baseline text-foreground outline-none",
          "focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/50",
          className,
        )}
      >
        <span className="me-1 inline-flex translate-y-0.5">
          <ReferenceLead lead={facts.lead} />
        </span>
        <span className="underline decoration-foreground/40 underline-offset-3 transition-colors duration-(--motion-fade) ease-(--ease-out) hover:decoration-foreground">
          {facts.title}
        </span>
      </button>
    ) : (
      <button
        type="button"
        data-slot="reference-chip"
        aria-label={referenceName(facts)}
        onClick={open}
        className={cn(
          chipClasses({ size: "xs", interactive: true }),
          "mx-px align-baseline",
          className,
        )}
      >
        <ReferenceLead lead={facts.lead} />
        {/* At most 280 px in all; the title gives way first (research §6, call 41). */}
        <span className="min-w-0 max-w-56 truncate">{facts.title}</span>
        {facts.fact ? (
          <span
            className={cn(
              "shrink-0 text-xs text-muted-foreground tabular-nums",
              facts.factTone === "late" && "text-subtle-foreground",
            )}
          >
            · {facts.fact}
          </span>
        ) : null}
      </button>
    );

  return (
    <HoverCard open={hoverOpen} onOpenChange={setHoverOpen}>
      <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
      <HoverCardContent>
        {hoverOpen && store ? (
          <ReferencePreview
            reference={reference}
            fallback={facts}
            onOpen={open}
            onComplete={onComplete}
            footer={
              onDisplayChange ? (
                <ShowAs
                  value={display}
                  kind={facts.kind}
                  onChange={(next) => {
                    setHoverOpen(false);
                    onDisplayChange(next);
                  }}
                  className="mt-2"
                />
              ) : null
            }
          />
        ) : null}
      </HoverCardContent>
    </HoverCard>
  );
}

/** The hover card: asks for the card's facts only once it opens (lazy). */
function ReferencePreview({
  reference,
  fallback,
  onOpen,
  onComplete,
  footer,
}: {
  reference: ReferenceRef;
  fallback: ReferenceFacts;
  onOpen: (event: MouseEvent<HTMLElement>) => void;
  onComplete?: (done: boolean) => void;
  footer?: ReactNode;
}) {
  const state = useReference(reference, "card");
  if (state?.status === "private") return <PrivateReference display="card" bare />;
  if (state?.status === "deleted")
    return <DeletedReference kind={state.kind} display="card" bare />;
  const facts = state?.status === "ready" ? state.facts : fallback;
  return (
    <ReferenceCardBody
      facts={facts}
      pending={!facts.card}
      onOpen={onOpen}
      onComplete={onComplete}
      footer={footer}
    />
  );
}

/** A task card's Complete: the page's own write when it hosts one, else the op. */
function useCompleteAction(
  reference: ReferenceRef,
  facts: ReferenceFacts,
): ((done: boolean) => void) | undefined {
  const host = useReferenceHost();
  const store = useReferenceStore();
  const canEdit = useCanEditTasks();
  if (facts.card?.action?.kind !== "complete") return undefined;
  if (host?.setTaskDone && host.canEditTasks !== false) {
    const setTaskDone = host.setTaskDone;
    return (done) => setTaskDone(reference.id, done);
  }
  if (!store || !canEdit) return undefined;
  return (done) => {
    store.completeTask(reference.id, done).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Couldn’t change the task.");
    });
  };
}

// ── "Show as" ────────────────────────────────────────────────────────────────

/** "Show as: Link · Chip · Card" — after inserting, and in the hover card later. */
export function ShowAs({
  value,
  kind,
  onChange,
  className,
}: {
  value: ReferenceDisplay;
  kind: ReferenceKind;
  onChange: (display: ReferenceDisplay) => void;
  className?: string;
}) {
  const items = [
    { value: "link", label: "Link" },
    { value: "chip", label: "Chip" },
    ...(canShowAsCard(kind) ? [{ value: "card", label: "Card" }] : []),
  ];
  return (
    <div
      className={cn("flex flex-wrap items-center gap-2 text-xs text-muted-foreground", className)}
    >
      <span>Show as</span>
      <SegmentedControl
        size="sm"
        aria-label="Show as"
        value={value}
        items={items}
        onValueChange={(next) => onChange(next as ReferenceDisplay)}
      />
    </div>
  );
}

/** "Show as" behind a ⋯, for a card already in the text. */
function ShowAsMenu({
  value,
  kind,
  onChange,
}: {
  value: ReferenceDisplay;
  kind: ReferenceKind;
  onChange: (display: ReferenceDisplay) => void;
}) {
  const displays: ReferenceDisplay[] = canShowAsCard(kind)
    ? ["link", "chip", "card"]
    : ["link", "chip"];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton icon={MoreHorizontal} label="Show as…" size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        // The editor takes focus back after a click inside it: that is not leaving the menu.
        onFocusOutside={(event) => event.preventDefault()}
      >
        <DropdownMenuLabel>Show as</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as ReferenceDisplay)}
        >
          {displays.map((d) => (
            <DropdownMenuRadioItem key={d} value={d}>
              {d === "link" ? "Link" : d === "chip" ? "Chip" : "Card"}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── the states without facts ─────────────────────────────────────────────────

/** A card-shaped frame for the states that have no facts. */
function CardFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      data-slot="reference-card"
      className={cn(
        "my-1 flex w-full max-w-xl items-center gap-2 rounded-lg bg-card px-(--pad-x-sm) py-(--pad-y-sm) text-base",
        "ring-1 ring-hairline ring-inset",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** "Private item": a lock and those words. No type, no title, no hover, no click. */
export function PrivateReference({
  display,
  bare = false,
  className,
}: {
  display: ReferenceDisplay;
  bare?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <Lock aria-hidden className="size-icon-sm shrink-0 text-subtle-foreground" />
      <span>{PRIVATE_ITEM_LABEL}</span>
    </>
  );
  if (display === "card" && !bare) {
    return (
      <CardFrame className={cn("text-subtle-foreground", className)}>
        <span data-slot="reference-private" className="inline-flex items-center gap-2">
          {body}
        </span>
      </CardFrame>
    );
  }
  return (
    <span
      data-slot="reference-private"
      className={cn(
        display === "chip" && !bare
          ? chipClasses({ size: "xs" })
          : "inline-flex items-center gap-1",
        "mx-px align-baseline text-subtle-foreground",
        className,
      )}
    >
      {body}
    </span>
  );
}

/** "Deleted task": tertiary words, no title (call 55; default u: never struck through). */
export function DeletedReference({
  kind,
  display,
  bare = false,
  className,
}: {
  kind: ReferenceKind;
  display: ReferenceDisplay;
  bare?: boolean;
  className?: string;
}) {
  if (display === "card" && !bare) {
    return (
      <CardFrame className={cn("text-subtle-foreground", className)}>
        <span data-slot="reference-deleted">{deletedLabel(kind)}</span>
      </CardFrame>
    );
  }
  return (
    <span
      data-slot="reference-deleted"
      className={cn(
        display === "chip" && !bare ? chipClasses({ size: "xs" }) : "inline",
        "mx-px align-baseline text-subtle-foreground",
        className,
      )}
    >
      {deletedLabel(kind)}
    </span>
  );
}

/** A reference whose facts haven't arrived: a fixed-width blank, no title. */
function BlankReference({ display, className }: { display: ReferenceDisplay; className?: string }) {
  if (display === "card") {
    return (
      <CardFrame className={className}>
        <span role="status" aria-busy="true" aria-label="Loading" className="h-10 w-full" />
      </CardFrame>
    );
  }
  return (
    <span
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className={cn(
        "mx-px inline-block w-24 align-middle",
        display === "chip" ? cn(chipClasses({ size: "xs" }), "bg-muted") : "h-lh",
        className,
      )}
    />
  );
}

/** The read failed: say so quietly, never show a stored title. */
function UnavailableReference({
  display,
  className,
}: {
  display: ReferenceDisplay;
  className?: string;
}) {
  if (display === "card") {
    return <CardFrame className={cn("text-subtle-foreground", className)}>Unavailable</CardFrame>;
  }
  return (
    <span
      className={cn(
        display === "chip" ? chipClasses({ size: "xs" }) : "inline",
        "mx-px align-baseline text-subtle-foreground",
        className,
      )}
    >
      Unavailable
    </span>
  );
}

/**
 * Outside the app shell (a story, a test without a store) there is nothing to
 * resolve with: an older chip shows what it remembered, else the type's word.
 */
function DetachedReference({
  ref_,
  kind,
  label,
  className,
}: {
  ref_: ReferenceRef;
  kind: ReferenceKind;
  label?: string | null;
  className?: string;
}) {
  const Icon = resolveEntityIcon(ref_.type);
  const text = label?.trim() || referenceNoun(kind);
  return (
    <button
      type="button"
      aria-label={`${ref_.type}: ${text}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openReferenceFull(ref_);
      }}
      className={cn(
        chipClasses({ size: "xs", interactive: true }),
        "mx-px align-baseline",
        className,
      )}
    >
      <Icon aria-hidden className="size-icon-sm shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{text}</span>
    </button>
  );
}
