// Small pieces of the contact card: the header status pill, the suggested-links
// strip, and the People section.

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Eyebrow } from "@/components/ui/eyebrow";
import type { EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";

import { LinkSuggestionStrip } from "../../spine/ui/link-suggestion-strip";
import { useContactSuggestions } from "../hooks/use-contact-suggestions";
import type { Contact } from "../model";
import { contactStatusMeta, DEFAULT_CONTACT_STATUSES } from "../status";
import { initials } from "./contact-directory";
import type { LinkedPerson } from "./contact-hub-model";
import { ContactStatusBadge, ContactStatusDot } from "./contact-status-badge";

export function ContactSuggestions({
  runtime,
  workspaceId,
  contactId,
  onLinked,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  contactId: string;
  onLinked: () => void;
}) {
  const focus: EntityRef = { type: "contact", id: contactId };
  const { current, busy, accept, dismiss } = useContactSuggestions(
    runtime,
    workspaceId,
    focus,
    onLinked,
  );
  if (!current) return null;
  return (
    <LinkSuggestionStrip
      suggestion={current}
      busy={busy}
      onAccept={() => void accept()}
      onDismiss={() => void dismiss()}
    />
  );
}

/**
 * The header status pill — a click-to-open dropdown in view mode (FX-4 AC5).
 * Optimistic: the pill flips immediately and rolls back on failure (the page
 * toasts). Read-only members (or no handler) see a plain badge.
 */
export function HeaderStatus({
  contact,
  canEdit,
  onSetStatus,
}: {
  contact: Contact;
  canEdit: boolean;
  onSetStatus?: (status: string) => Promise<void>;
}) {
  const [optimistic, setOptimistic] = useState<string | null>(null);
  // Drop the optimistic override once the real status catches up (or on switch).
  useEffect(() => setOptimistic(null), [contact.id, contact.status]);
  const status = optimistic ?? contact.status;

  const options = useMemo(() => {
    const opts: { id: string; label: string }[] = [
      { id: "", label: "No status" },
      ...DEFAULT_CONTACT_STATUSES.map((s) => ({ id: s.id, label: s.label })),
    ];
    const meta = contactStatusMeta(status);
    if (meta.id && !opts.some((o) => o.id === meta.id))
      opts.push({ id: meta.id, label: meta.label });
    return opts;
  }, [status]);

  if (!canEdit || !onSetStatus) {
    return status ? <ContactStatusBadge status={status} /> : null;
  }

  const change = (next: string) => {
    if (next === status) return;
    setOptimistic(next);
    void onSetStatus(next).catch(() => setOptimistic(null));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Change status"
        >
          {status ? (
            <ContactStatusBadge status={status} />
          ) : (
            <span className="text-muted-foreground/70">Set status</span>
          )}
          <ChevronDown className="size-icon-sm shrink-0 opacity-60" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((o) => (
          <DropdownMenuItem key={o.id || "none"} onSelect={() => change(o.id)}>
            <span className="flex flex-1 items-center gap-1.5">
              {o.id ? (
                <ContactStatusDot status={o.id} />
              ) : (
                <span
                  className="inline-block size-2 shrink-0 rounded-full border border-border"
                  aria-hidden
                />
              )}
              {o.label}
              {contactStatusMeta(status).id === o.id ? (
                <Check className="ml-auto size-icon-sm text-muted-foreground" aria-hidden />
              ) : null}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Person↔person links get their own quiet section (FX-5). */
export function LinkedPeople({
  people,
  onOpenEntity,
}: {
  people: LinkedPerson[];
  onOpenEntity?: (ref: EntityRef) => void;
}) {
  if (people.length === 0) return null;
  return (
    <section className="space-y-1">
      <Eyebrow as="h3">People</Eyebrow>
      <ul className="space-y-0.5">
        {people.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onOpenEntity?.({ type: "contact", id: p.id })}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Avatar size="sm">
                {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt="" /> : null}
                <AvatarFallback>{initials(p.name)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{p.name}</span>
              {p.status ? <ContactStatusDot status={p.status} /> : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
