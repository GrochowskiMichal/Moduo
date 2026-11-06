// The who-card at the top of the conversation (specs/mail-v3.md §8, AC23): a
// known contact gets their name, role · company, last touch, what is open with
// them and Open contact; an unknown sender "Not in your contacts" and Add as
// contact; a screened one (New senders) Allow `y` and Block `b`.

import { UserPlus } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { initialsOf } from "@/lib/initials";

import type { Person } from "./reader-format";

/** What Moduo knows about the sender, when they are a contact. */
export type MailWho = {
  contactId: string;
  name: string;
  role: string | null;
  company: string | null;
  /** "Emailed today 8:12"; the card reads "Last: {lastTouch}". */
  lastTouch: string | null;
  openTasks: number;
  notes: number;
  /** "Thu" for "next meeting Thu", else null. */
  nextMeeting: string | null;
};

export type WhoCardProps = {
  sender: Person;
  who: MailWho | null;
  /** The thread sits in New senders: Allow and Block replace Add as contact. */
  screened?: boolean;
  onAllow?: () => void;
  onBlock?: () => void;
  onAddContact?: () => void;
  onOpenContact?: (contactId: string) => void;
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "2 open tasks · 1 note · next meeting Thu". */
export function whoCounts(who: MailWho): string {
  const parts = [plural(who.openTasks, "open task"), plural(who.notes, "note")];
  if (who.nextMeeting) parts.push(`next meeting ${who.nextMeeting}`);
  return parts.join(" · ");
}

function WhoAvatar({ name }: { name: string }) {
  return (
    <Avatar aria-hidden>
      <AvatarFallback>{initialsOf(name)}</AvatarFallback>
    </Avatar>
  );
}

function KnownCard({ who, onOpenContact }: { who: MailWho; onOpenContact?: (id: string) => void }) {
  const role = [who.role, who.company].filter(Boolean).join(" · ");
  return (
    <>
      <WhoAvatar name={who.name} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-1.5 text-sm">
          <span className="truncate font-medium text-foreground">{who.name}</span>
          {role ? <span className="truncate text-muted-foreground">{role}</span> : null}
        </div>
        <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
          {who.lastTouch ? <span>Last: {who.lastTouch}</span> : null}
          <span>{whoCounts(who)}</span>
        </div>
      </div>
      {onOpenContact ? (
        <Button size="sm" variant="ghost" onClick={() => onOpenContact(who.contactId)}>
          Open contact
        </Button>
      ) : null}
    </>
  );
}

function UnknownCard({
  sender,
  screened,
  onAllow,
  onBlock,
  onAddContact,
}: Omit<WhoCardProps, "who" | "onOpenContact">) {
  const name = sender.name.trim() || sender.email;
  return (
    <>
      <WhoAvatar name={name} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-1.5 text-sm">
          <span className="truncate font-medium text-foreground">{name}</span>
          {sender.name.trim() ? (
            <span className="truncate text-muted-foreground">{sender.email}</span>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">Not in your contacts</span>
      </div>
      {screened ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" onClick={onAllow} aria-keyshortcuts="y">
            Allow
            <span aria-hidden>
              <Kbd>y</Kbd>
            </span>
          </Button>
          <Button size="sm" variant="ghost" onClick={onBlock} aria-keyshortcuts="b">
            Block
            <span aria-hidden>
              <Kbd>b</Kbd>
            </span>
          </Button>
        </div>
      ) : onAddContact ? (
        <Button size="sm" variant="secondary" onClick={onAddContact}>
          <UserPlus aria-hidden />
          Add as contact
        </Button>
      ) : null}
    </>
  );
}

export function WhoCard({ who, onOpenContact, ...rest }: WhoCardProps) {
  const known = who && !rest.screened;
  return (
    <section
      aria-label="Who this is from"
      data-who={known ? "contact" : rest.screened ? "screened" : "unknown"}
      className={
        known
          ? "mx-4 mb-2 flex min-w-0 items-center gap-2.5 rounded-md border border-hairline px-2.5 py-2"
          : "mx-4 mb-2 flex min-w-0 items-center gap-2.5 rounded-md bg-tag-chip-surface px-2.5 py-2"
      }
    >
      {known ? <KnownCard who={who} onOpenContact={onOpenContact} /> : <UnknownCard {...rest} />}
    </section>
  );
}
