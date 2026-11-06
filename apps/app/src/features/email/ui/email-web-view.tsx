// The /email page on web (specs/mail-v3.md §13, AC36): it says what is true.
// Mail lives on the Mac; here are only the conversations linked to a task, a
// note or an event, each with chips that open them and "Continue on Mac".
// Snoozes and follow-ups stay on the Mac, so the page never lists them. Cards
// carry the ref + thread ids so a `?thread=` deep link can scroll to one (DF-2).

import { CalendarDays, FileText, Laptop, Mail, SquareCheck } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { Chip, ChipButton } from "../../../components/ui/chip";
import { EmptyState } from "../../../components/ui/empty-state";
import { Skeleton } from "../../../components/ui/skeleton";
import type { EmailThreadRef } from "../../../lib/runtime.types";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import { openEntity } from "../../dashboard/widget-nav";
import { DESKTOP_CHANNEL, desktopDownloads } from "../../settings/about";
import { type EmailTissue, useEmailTissue } from "../hooks/use-email-tissue";
import { formatEmailDate } from "../utils/email-format";
import { useEmailThreadDeepLink } from "./use-email-thread-deep-link";
import { useWebThreadLinks, type WebLinkedEntity } from "./use-web-thread-links";

const KIND_LABEL: Record<WebLinkedEntity["kind"], string> = {
  task: "task",
  note: "note",
  calendar_event: "event",
};

const KIND_ICON = { task: SquareCheck, note: FileText, calendar_event: CalendarDays } as const;

/** The type `moduo:entity:open` routes by (a calendar event opens as `event`). */
const OPEN_TYPE: Record<WebLinkedEntity["kind"], string> = {
  task: "task",
  note: "note",
  calendar_event: "event",
};

/** Where "Open Moduo for Mac" goes: the Mac app's download (no app URL scheme ships yet). */
export function macAppHref(): string {
  return desktopDownloads(DESKTOP_CHANNEL ?? "production").find((d) => d.platform === "mac")!.href;
}

/** One linked conversation: subject, sender and time, its entity chips, Continue on Mac. */
function LinkedCard({
  thread,
  links,
  highlighted,
  onOpenEntity,
}: {
  thread: EmailThreadRef;
  links: readonly WebLinkedEntity[];
  highlighted: boolean;
  onOpenEntity?: (entity: WebLinkedEntity) => void;
}) {
  return (
    <div
      data-thread-ref-id={thread.id}
      data-thread-key={thread.threadKey}
      className={
        "rounded-lg border bg-card p-3 transition-colors duration-(--motion-fade) ease-(--ease-out) " +
        (highlighted ? "border-ring ring-2 ring-ring" : "border-border")
      }
    >
      <div className="truncate text-sm font-medium text-foreground">
        {thread.subject || "(No subject)"}
      </div>
      <div className="flex items-baseline gap-1 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {thread.fromName?.trim() || thread.fromAddr || "Unknown sender"}
        </span>
        {thread.sentAt ? (
          <time className="shrink-0 tabular-nums" dateTime={thread.sentAt}>
            · {formatEmailDate(thread.sentAt)}
          </time>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {links.map((l) => (
          <ChipButton
            key={`${l.kind}:${l.id}`}
            size="xs"
            icon={KIND_ICON[l.kind]}
            onClick={() => onOpenEntity?.(l)}
          >
            Open {KIND_LABEL[l.kind]}: {l.title}
          </ChipButton>
        ))}
        <Chip size="xs" icon={Laptop}>
          Continue on Mac
        </Chip>
      </div>
    </div>
  );
}

type Props = {
  email: Pick<EmailTissue, "tissueRefs"> & { loading?: boolean };
  /** Each ref's linked tasks, notes and events; undefined while unknown (then every ref shows). */
  links?: Readonly<Record<string, readonly WebLinkedEntity[]>>;
  highlightedRefId: string | null;
  onOpenEntity?: (entity: WebLinkedEntity) => void;
};

export function EmailWebView({ email, links, highlightedRefId, onOpenEntity }: Props) {
  const linked = [...email.tissueRefs]
    .filter((r) => !links || (links[r.id]?.length ?? 0) > 0)
    .sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));
  return (
    <div className="pane-scroll flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <div
        role="note"
        className="flex items-start gap-3 rounded-lg border border-border bg-card p-4"
      >
        <Mail className="mt-0.5 size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Mail lives on your Mac.</span> Here you see
          the conversations you linked to a task, a note or an event, so the rest of your work can
          find them. Snoozes and follow-ups stay on the Mac.
        </p>
        <Button asChild size="sm" variant="secondary">
          <a href={macAppHref()} target="_blank" rel="noreferrer">
            Open Moduo for Mac
          </a>
        </Button>
      </div>

      {email.loading && linked.length === 0 ? (
        <div role="status" aria-label="Loading email" className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : null}

      {linked.length > 0 ? (
        <section aria-label="Linked conversations" className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-foreground">
            Linked conversations{" "}
            <span className="text-muted-foreground tabular-nums">{linked.length}</span>
          </h2>
          {linked.map((ref) => (
            <LinkedCard
              key={ref.id}
              thread={ref}
              links={links?.[ref.id] ?? []}
              highlighted={highlightedRefId === ref.id}
              onOpenEntity={onOpenEntity}
            />
          ))}
        </section>
      ) : null}

      {linked.length === 0 && !email.loading ? (
        <EmptyState
          icon={Mail}
          title="No linked conversations yet"
          description="Link an email to a task on your Mac and it shows here."
        />
      ) : null}
    </div>
  );
}

/** The web /email page: loads the tissue and its links, and applies a `?thread=` deep link. */
export function EmailWebPage({
  urlThreadId = null,
  onConsumeThreadDeepLink,
}: {
  urlThreadId?: string | null;
  onConsumeThreadDeepLink?: () => void;
}) {
  const { runtime } = useAuth();
  const { selectedWorkspaceId: workspaceId } = useWorkspace();
  const email = useEmailTissue(runtime, workspaceId);
  const threadLinks = useWebThreadLinks(runtime, workspaceId, email.tissueRefs);
  const highlightedRefId = useEmailThreadDeepLink({ urlThreadId, onConsumeThreadDeepLink, email });
  return (
    <EmailWebView
      email={{ ...email, loading: email.loading || threadLinks.loading }}
      links={threadLinks.links}
      highlightedRefId={highlightedRefId}
      onOpenEntity={(e) => openEntity(OPEN_TYPE[e.kind], e.id)}
    />
  );
}
