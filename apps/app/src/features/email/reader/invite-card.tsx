// The invite card (MR-10, AC18): an iMIP invite's event above the message,
// with Accept / Maybe / Decline (the engine builds the iTIP REPLY from the
// PARTSTAT, `mail/invite.rs`) and Add to calendar (a linked event).

import { Button } from "@/components/ui/button";

export type MailPartstat = "ACCEPTED" | "TENTATIVE" | "DECLINED";

export type MailInvite = {
  uid: string;
  method: "REQUEST" | "CANCEL" | "REPLY";
  summary: string;
  startMs: number;
  endMs: number;
  location: string | null;
  organizer: { name: string; email: string } | null;
  myStatus: MailPartstat | null;
};

const ANSWERS: { status: MailPartstat; label: string }[] = [
  { status: "ACCEPTED", label: "Accept" },
  { status: "TENTATIVE", label: "Maybe" },
  { status: "DECLINED", label: "Decline" },
];

function when(startMs: number, endMs: number): string {
  const day = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(startMs);
  const t = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day}, ${t.format(startMs)} – ${t.format(endMs)}`;
}

export type InviteCardProps = {
  invite: MailInvite;
  onRsvp?: (status: MailPartstat) => Promise<void> | void;
  onAddToCalendar?: (uid: string) => void;
};

export function InviteCard({ invite, onRsvp, onAddToCalendar }: InviteCardProps) {
  const cancelled = invite.method === "CANCEL";
  return (
    <section
      aria-label="Invitation"
      className="flex flex-col gap-2 rounded-md border border-hairline p-3 text-sm"
    >
      <div className="font-medium text-foreground">{invite.summary}</div>
      <div className="text-xs text-muted-foreground">
        {when(invite.startMs, invite.endMs)}
        {invite.location ? ` · ${invite.location}` : ""}
      </div>
      {invite.organizer ? (
        <div className="text-xs text-muted-foreground">
          From {invite.organizer.name || invite.organizer.email}
        </div>
      ) : null}
      {cancelled ? (
        <p className="text-xs text-destructive">This event was cancelled.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {onRsvp
            ? ANSWERS.map((a) => (
                <Button
                  key={a.status}
                  size="sm"
                  variant="outline"
                  aria-pressed={invite.myStatus === a.status}
                  onClick={() => void onRsvp(a.status)}
                >
                  {a.label}
                </Button>
              ))
            : null}
          {onAddToCalendar ? (
            <Button size="sm" variant="ghost" onClick={() => onAddToCalendar(invite.uid)}>
              Add to calendar
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}
