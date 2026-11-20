// The Contact view of Mail's side panel (specs/mail-v3.md §10, prototype
// `contact` and `unknownSender`): the sender's head (avatar, name, role ·
// company, Open in Contacts), last touch, the open tasks, notes and meetings
// with them, then the mail and files with them (`contact-mail.tsx`). A sender
// who isn't a contact gets "Add as contact", prefilled with the name Moduo
// knows (never automatic).

import { ExternalLink, UserPlus } from "lucide-react";
import type { ReactNode } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { initialsOf } from "@/lib/initials";

import type { MailWho } from "../reader/who-card";
import type { AttachmentEntry } from "../views/attachments-model";
import { ContactMailPanel } from "./contact-mail";
import type { MailWithPerson } from "./mail-with-person";

/** What is open with a contact, by name (the who-card has only the counts). */
export type MailContactDetail = {
  tasks: { id: string; title: string; due: string | null }[];
  notes: { id: string; title: string }[];
  meetings: { id: string; title: string; when: string }[];
};

export type ContactViewProps = {
  /** The open thread's other person, or null with no thread open. */
  sender: { name: string; email: string } | null;
  /** The sender as a contact, or null when they aren't one. */
  who: MailWho | null;
  detail: MailContactDetail | null;
  mail: MailWithPerson;
  nowMs: number;
  /** The name "Add as contact" fills in. */
  suggestedName: string;
  onOpenThread: (threadId: string) => void;
  onPreview: (entry: AttachmentEntry) => void;
  onAddContact?: (email: string, name: string) => void;
  onOpenContact?: (contactId: string) => void;
  onOpenItem?: (type: "task" | "note" | "calendar_event", id: string) => void;
};

export function NoThread({ what }: { what: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 pt-12 text-center">
      <h3 className="text-sm font-medium text-foreground">No conversation selected</h3>
      <p className="text-xs text-muted-foreground">{what}</p>
    </div>
  );
}

function Head({ name, lines }: { name: string; lines: (string | null)[] }) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-2">
      <Avatar size="lg" aria-hidden>
        <AvatarFallback>{initialsOf(name)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{name}</span>
        {lines.filter(Boolean).map((l) => (
          <span key={l} className="truncate text-xs text-muted-foreground">
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-0.5">
      <h3 className="flex items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground">
        {title}
        {count !== undefined ? <span className="tabular-nums">{count}</span> : null}
      </h3>
      {children}
    </section>
  );
}

function Row({
  label,
  meta,
  onClick,
}: {
  label: string;
  meta?: string | null;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-foreground hover:bg-state-hover"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta ? <span className="shrink-0 text-xs text-muted-foreground">{meta}</span> : null}
    </button>
  );
}

const None = () => <p className="px-2 text-xs text-muted-foreground">None.</p>;

function KnownWork({
  who,
  detail,
  onOpenItem,
}: Pick<ContactViewProps, "detail" | "onOpenItem"> & { who: MailWho }) {
  const tasks = detail?.tasks ?? [];
  const notes = detail?.notes ?? [];
  const meetings = detail?.meetings ?? [];
  return (
    <>
      <Section title="Open tasks" count={detail ? tasks.length : who.openTasks}>
        {tasks.length ? (
          tasks.map((t) => (
            <Row
              key={t.id}
              label={t.title}
              meta={t.due}
              onClick={() => onOpenItem?.("task", t.id)}
            />
          ))
        ) : (
          <None />
        )}
      </Section>
      <Section title="Notes" count={detail ? notes.length : who.notes}>
        {notes.length ? (
          notes.map((n) => (
            <Row key={n.id} label={n.title} onClick={() => onOpenItem?.("note", n.id)} />
          ))
        ) : (
          <None />
        )}
      </Section>
      {meetings.length || who.nextMeeting ? (
        <Section title="Meetings">
          {meetings.length ? (
            meetings.map((m) => (
              <Row
                key={m.id}
                label={m.title}
                meta={m.when}
                onClick={() => onOpenItem?.("calendar_event", m.id)}
              />
            ))
          ) : (
            <p className="px-2 text-xs text-muted-foreground">Next meeting {who.nextMeeting}</p>
          )}
        </Section>
      ) : null}
    </>
  );
}

function Unknown({
  sender,
  suggestedName,
  onAddContact,
}: {
  sender: { name: string; email: string };
  suggestedName: string;
  onAddContact?: ContactViewProps["onAddContact"];
}) {
  const name = suggestedName || sender.email;
  const first = name.split(/\s+/)[0] || name;
  return (
    <div className="flex flex-col gap-2 px-2" data-contact="unknown">
      <p className="text-xs text-muted-foreground">
        Not in your contacts. Adding them keeps every thread, task and note with {first} in one
        place. Nothing is ever added without you.
      </p>
      {onAddContact ? (
        <Button
          size="sm"
          className="self-start"
          onClick={() => onAddContact(sender.email, suggestedName)}
        >
          <UserPlus aria-hidden />
          Add as contact
        </Button>
      ) : null}
    </div>
  );
}

export function ContactView(props: ContactViewProps) {
  const { sender, who } = props;
  if (!sender) {
    return <NoThread what="Pick a conversation to see who it's from and what it's linked to." />;
  }
  const name = who?.name || props.suggestedName || sender.email;
  const role = who ? [who.role, who.company].filter(Boolean).join(" · ") || null : null;
  return (
    <div className="flex flex-col gap-4 py-1" data-panel-view="contact">
      <Head name={name} lines={[role, sender.email]} />
      {who ? (
        <>
          {who.lastTouch ? (
            <p className="px-2 text-xs text-muted-foreground">{who.lastTouch}</p>
          ) : null}
          <KnownWork who={who} detail={props.detail} onOpenItem={props.onOpenItem} />
        </>
      ) : (
        <Unknown
          sender={sender}
          suggestedName={props.suggestedName}
          onAddContact={props.onAddContact}
        />
      )}
      <ContactMailPanel
        email={sender.email}
        name={name}
        rows={props.mail.rows}
        messages={props.mail.messages}
        nowMs={props.nowMs}
        suggestAdd={false}
        onOpenThread={props.onOpenThread}
        onPreview={props.onPreview}
        onAddContact={props.onAddContact ?? (() => {})}
      />
      {who?.contactId && props.onOpenContact ? (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => props.onOpenContact?.(who.contactId)}
        >
          <ExternalLink aria-hidden />
          Open in Contacts
        </Button>
      ) : null}
    </div>
  );
}
