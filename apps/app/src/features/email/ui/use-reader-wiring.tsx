// The reader's wiring on the page (specs/mail-v3.md §8, MV-8): toolbar and
// per-message actions onto the page's intents, the chip row's links from the
// spine (open, unlink with undo), the who-card's lookup and Allow/Block (as the
// New senders panel acts), the send notes over the compose port, the invite
// cards, the remind picker and the reader's `o` / `y` / `b` keys.

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { MailComposeEngine, MailDraftRow } from "@/lib/runtime.types.mail-compose";
import type {
  MailEngine,
  MailOpInput,
  MailThread,
  MailThreadRow,
  MailView,
} from "@/lib/runtime.types.mail-engine";
import { undoToast } from "@/lib/undo-toast";

import { openReferenceFull } from "../../spine/references/open";
import type { MailSpineCommands } from "../commands/spine";
import type { MailCommands } from "../commands/triage";
import type { ComposeKind } from "../compose/session";
import type { MailKeyId } from "../keys";
import { addInviteToCalendar, engineInviteLoader, engineRsvp } from "../reader/engine-reader";
import { InviteCard, type MailInvite, type MailPartstat } from "../reader/invite-card";
import type { MailReaderApi, MailReaderProps, ReaderWho } from "../reader/mail-reader";
import type { MessageAction } from "../reader/message-card";
import { type Person, shortDay } from "../reader/reader-format";
import type { ReaderAction } from "../reader/reader-toolbar";
import { bumpThreadLinks, linkChipLabel, type ReaderLinks } from "../reader/thread-links";
import type { MailWho } from "../reader/who-card";
import { EmailSnoozePicker } from "./email-snooze-picker";
import { decideNewSender, groupNewSenders, saveSenderSetting } from "./new-senders-panel";

const errText = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

/** Allow or Block from the reader, as the New senders panel does: every thread from
 *  that sender in New senders is released, and the decision is saved. */
export async function decideFromReader(
  deps: {
    engine: Pick<MailEngine, "listThreads"> | null;
    commands: Pick<MailCommands, "releaseNewSenders">;
    save?: Parameters<typeof decideNewSender>[2]["save"];
  },
  threadId: string,
  sender: Person,
  decision: "allow" | "block",
): Promise<void> {
  const address = sender.email.trim().toLowerCase();
  let threadIds = [threadId];
  if (deps.engine) {
    const page = await deps.engine.listThreads({ view: { kind: "new_senders" }, limit: 500 });
    const group = groupNewSenders(page.rows).find((g) => g.address === address);
    if (group) threadIds = [...new Set([threadId, ...group.threadIds])];
  }
  await decideNewSender({ address, name: sender.name || address, threadIds }, decision, {
    commands: deps.commands,
    save: deps.save ?? saveSenderSetting,
  });
}

function InviteSlot({
  messageId,
  loadInvite,
  onRsvp,
  onAddToCalendar,
}: {
  messageId: string;
  loadInvite: (messageId: string) => Promise<MailInvite | null>;
  onRsvp?: (messageId: string, status: MailPartstat) => Promise<void> | void;
  onAddToCalendar: (invite: MailInvite) => void;
}) {
  const [invite, setInvite] = useState<MailInvite | null>(null);
  useEffect(() => {
    let gone = false;
    void loadInvite(messageId).then(
      (i) => !gone && setInvite(i),
      () => {},
    );
    return () => {
      gone = true;
    };
  }, [messageId, loadInvite]);
  if (!invite) return null;
  return (
    <div className="px-4 pb-2">
      <InviteCard
        invite={invite}
        onRsvp={onRsvp && invite.organizer ? (status) => onRsvp(messageId, status) : undefined}
        onAddToCalendar={() => onAddToCalendar(invite)}
      />
    </div>
  );
}

export type ReaderWiringDeps = {
  engine: MailEngine | null;
  commands: MailCommands;
  spine: MailSpineCommands | null;
  /** The compose port, for the send notes. */
  port: MailComposeEngine | null;
  /** Changes when the Outbox or Drafts may need a re-read. */
  placeKey: string;
  /** The place the list shows (screened, done). */
  view: MailView | null;
  contacts: readonly { name: string; email: string }[];
  whoFor?: (address: string) => Promise<MailWho | null>;
  onAddContact?: (email: string, name: string) => void;
  loadInvite?: (messageId: string) => Promise<MailInvite | null>;
  onRsvp?: (messageId: string, status: MailPartstat) => Promise<void> | void;
  onIntent: (intent: MailKeyId, threadIds: string[]) => void;
  openCompose: (kind: ComposeKind, threadId: string, messageId?: string) => void;
  act: (kind: MailOpInput["kind"], threadIds: string[], args?: MailOpInput["args"]) => void;
  rowOf: (threadId: string) => Promise<MailThreadRow | null>;
  openDraft: (draft: MailDraftRow) => void;
  editOutbox: (outboxId: string) => void;
  /** Runs a spine gesture with the undo toast (the page's `runGesture`). */
  runGesture: (label: string, run: () => Promise<{ undo: () => Promise<void> }>) => void;
  now: () => number;
};

const INTENT: Partial<Record<ReaderAction, MailKeyId>> = {
  snooze: "email.snooze",
  task: "email.convert",
  link: "email.link",
  note: "email.note",
  move: "email.move",
};

const COMPOSE: Partial<Record<ReaderAction | MessageAction, ComposeKind>> = {
  reply: "reply",
  "reply-all": "reply-all",
  forward: "forward",
};

function useReaderLinks(spine: MailSpineCommands | null): ReaderLinks | null {
  return useMemo(() => {
    if (!spine) return null;
    return {
      read: (threadId) => spine.linksFor(threadId),
      open: (link) => openReferenceFull({ type: link.entity.type, id: link.entity.id }),
      unlink: (link) =>
        void spine.unlink(link).then(
          (res) => {
            bumpThreadLinks();
            undoToast(`Unlinked ${linkChipLabel(link)}`, {
              onUndo: () => void res.undo().then(bumpThreadLinks, () => {}),
            });
          },
          (e) => toast.error(errText(e, "Couldn't unlink that.")),
        ),
    };
  }, [spine]);
}

function useReaderWho(deps: ReaderWiringDeps): ReaderWho {
  const { engine, commands, contacts, whoFor, onAddContact, view } = deps;
  const lookup = useMemo<ReaderWho["lookup"]>(() => {
    if (whoFor) return whoFor;
    const byEmail = new Map(contacts.map((c) => [c.email.toLowerCase(), c.name]));
    return async (address) => {
      const name = byEmail.get(address);
      if (name === undefined) return null;
      const who: MailWho = {
        contactId: "",
        name: name || address,
        role: null,
        company: null,
        lastTouch: null,
        openTasks: 0,
        notes: 0,
        nextMeeting: null,
      };
      return who;
    };
  }, [whoFor, contacts]);
  return useMemo(
    () => ({
      lookup,
      screened: view?.kind === "new_senders",
      onDecide: (threadId, sender, decision) =>
        void decideFromReader({ engine, commands }, threadId, sender, decision).catch((e) =>
          toast.error(errText(e, "Couldn't save that.")),
        ),
      onAddContact: onAddContact ? (p: Person) => onAddContact(p.email, p.name) : undefined,
      onOpenContact: (id) => (id ? openReferenceFull({ type: "contact", id }) : undefined),
    }),
    [lookup, view, engine, commands, onAddContact],
  );
}

export function useReaderWiring(deps: ReaderWiringDeps) {
  const apiRef = useRef<MailReaderApi | null>(null);
  const [remindIds, setRemindIds] = useState<string[]>([]);
  const links = useReaderLinks(deps.spine);
  const who = useReaderWho(deps);
  const { engine, spine, port } = deps;

  const onAction = (action: ReaderAction | MessageAction, threadId: string, messageId?: string) => {
    const compose = COMPOSE[action];
    const intent = INTENT[action as ReaderAction];
    if (compose) deps.openCompose(compose, threadId, messageId);
    else if (intent) deps.onIntent(intent, [threadId]);
    else if (action === "done") deps.act("done", [threadId]);
    else if (action === "remind" && engine?.setFollowUp) setRemindIds([threadId]);
    else if (action === "pin")
      void deps.rowOf(threadId).then((row) => deps.act(row?.pinned ? "unpin" : "pin", [threadId]));
  };

  /** The reader's own keys; true when handled. */
  const onKey = (intent: MailKeyId, threadIds: string[]): boolean => {
    // `w` (MV-7): Remind me if no reply, on every picked thread.
    if (intent === "email.remind") {
      if (engine?.setFollowUp && threadIds.length > 0) setRemindIds(threadIds);
      return true;
    }
    if (intent === "email.expand-all") {
      apiRef.current?.expandAll();
      return true;
    }
    if (intent !== "email.allow" && intent !== "email.block") return false;
    const id = threadIds[0];
    if (!who.screened || !id) return true;
    void deps.rowOf(id).then((row) => {
      const sender = row?.senders.at(-1);
      if (sender) who.onDecide?.(id, sender, intent === "email.allow" ? "allow" : "block");
    });
    return true;
  };

  const renderAbove = (thread: MailThread) => {
    const invites = deps.loadInvite ?? engineInviteLoader(engine, thread.row.threadId);
    if (!invites) return null;
    const rsvp = deps.onRsvp ?? engineRsvp(engine, thread.row.threadId);
    return thread.messages
      .filter((m) => m.hasInvite)
      .map((m) => (
        <InviteSlot
          key={m.id}
          messageId={m.id}
          loadInvite={invites}
          onRsvp={rsvp}
          onAddToCalendar={(inv) =>
            spine
              ? deps.runGesture("Added to Moduo calendar", () =>
                  addInviteToCalendar(spine, thread.row, inv),
                )
              : undefined
          }
        />
      ));
  };

  const view = deps.view;
  const props: Partial<MailReaderProps> = {
    apiRef,
    onAction,
    links,
    who,
    renderAbove,
    done: view?.kind === "unified" && view.role === "archive",
    sendNotes: port
      ? { port, refreshKey: deps.placeKey, onEditOutbox: deps.editOutbox, onFix: deps.openDraft }
      : null,
  };

  const remindPicker = (
    <EmailSnoozePicker
      open={remindIds.length > 0}
      onOpenChange={(o) => (o ? null : setRemindIds([]))}
      title="Remind me if no reply"
      confirmLabel="Remind me"
      onPick={(at) => {
        const ids = remindIds;
        setRemindIds([]);
        const set = engine?.setFollowUp?.bind(engine);
        if (ids.length === 0 || !set) return;
        void Promise.all(ids.map((id) => set(id, at.getTime()))).then(
          () => toast(`Reminds you ${shortDay(at.getTime(), deps.now())} if no reply`),
          (e) => toast.error(errText(e, "Couldn't set the reminder.")),
        );
      }}
    >
      <span aria-hidden className="pointer-events-none absolute top-2 left-1/2 h-0 w-0" />
    </EmailSnoozePicker>
  );

  return { props, links, onKey, remindPicker };
}
