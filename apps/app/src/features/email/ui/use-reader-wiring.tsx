// The reader's wiring on the page (specs/mail-v3.md §8, MV-8): toolbar and
// per-message actions onto the page's intents, the chip row's links from the
// spine (open, unlink with undo), the who-card's lookup and Allow/Block (as the
// New senders panel acts), the send notes over the compose port, the invite
// cards, the reader's `o` / `y` / `b` keys, and (MV-9) the ⋯ menu's actions,
// "Why is this in {Tab}?" names and the anchored remind picker.

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { getRuntime } from "@/lib/runtime";
import type { MailComposeEngine, MailDraftRow } from "@/lib/runtime.types.mail-compose";
import type {
  MailEngine,
  MailOpInput,
  MailThread,
  MailThreadRow,
  MailView,
} from "@/lib/runtime.types.mail-engine";
import { undoToast } from "@/lib/undo-toast";
import { webOrigin } from "@/lib/web-origin";

import { dispatchOpenSettings } from "../../settings/settings-events";
import { openReferenceFull } from "../../spine/references/open";
import type { MailSpineCommands } from "../commands/spine";
import type { MailCommands } from "../commands/triage";
import type { ComposeKind } from "../compose/session";
import type { MailKeyId } from "../keys";
import { addInviteToCalendar, engineInviteLoader, engineRsvp } from "../reader/engine-reader";
import { InviteCard, type MailInvite, type MailPartstat } from "../reader/invite-card";
import type { MailReaderApi, MailReaderProps, ReaderWho } from "../reader/mail-reader";
import type { MessageAction } from "../reader/message-card";
import { menuOps, type ReaderMoreActions, type SenderSettingsPort } from "../reader/more-menu";
import { type Person, shortDay } from "../reader/reader-format";
import type { ReaderWhy } from "../reader/reader-more";
import type { ReaderAction } from "../reader/reader-toolbar";
import { bumpThreadLinks, linkChipLabel, type ReaderLinks } from "../reader/thread-links";
import type { MailWho } from "../reader/who-card";
import type { WhyNames } from "../reader/why-here";
import type { MailPanelView } from "../store/mail-store";
import {
  EmailSnoozePicker,
  type PickerAnchor,
  pickerAnchor,
  usePressedButton,
} from "./email-snooze-picker";
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
  /** Opens the side panel on a view: the who-card's Open contact, a task chip (§10). */
  openPanel?: (view: MailPanelView) => void;
  openCompose: (kind: ComposeKind, threadId: string, messageId?: string) => void;
  act: (kind: MailOpInput["kind"], threadIds: string[], args?: MailOpInput["args"]) => void;
  rowOf: (threadId: string) => Promise<MailThreadRow | null>;
  openDraft: (draft: MailDraftRow) => void;
  /** A failed send again, as it was (specs/mail-improve.md AC19). */
  retrySend?: (draft: MailDraftRow) => void;
  /** A size-limited send without its largest file. */
  removeAndSend?: (draft: MailDraftRow, filename: string) => void;
  editOutbox: (outboxId: string) => void;
  /** Runs a spine gesture with the undo toast (the page's `runGesture`). */
  runGesture: (label: string, run: () => Promise<{ undo: () => Promise<void> }>) => void;
  now: () => number;
  /** Rule and custom-tab names from Settings, for "Why is this in {Tab}?". */
  whyNames?: WhyNames;
  /** Priority people from Settings (item id, lower-case address). */
  priorityPeople?: readonly { id: string; address: string }[];
  /** Where Block and Mark Priority save the sender; defaults to the runtime's. */
  senderSettings?: SenderSettingsPort | null;
};

const NO_NAMES: WhyNames = { rules: [], customTabs: [] };
const NO_PEOPLE: readonly { id: string; address: string }[] = [];

/** Settings items through the runtime (`upsertSetting` / `deleteSetting`). */
function runtimeSenderSettings(): SenderSettingsPort | null {
  const email = getRuntime()?.email;
  if (!email) return null;
  return {
    upsert: async (kind, value) => {
      const id = crypto.randomUUID();
      await email.upsertSetting({ id, kind, value });
      return id;
    },
    remove: (id) => email.deleteSetting({ id }),
  };
}

/** ⋯ → Copy link: the thread's `/email?thread=` deep link. */
function copyThreadLink(threadId: string) {
  const url = `${webOrigin()}/email?thread=${encodeURIComponent(threadId)}`;
  if (!navigator.clipboard) {
    toast.error("Couldn't copy the link.");
    return;
  }
  void navigator.clipboard.writeText(url).then(
    () => toast("Link copied"),
    () => toast.error("Couldn't copy the link."),
  );
}

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

function useReaderLinks(
  spine: MailSpineCommands | null,
  openPanel?: (view: MailPanelView) => void,
): ReaderLinks | null {
  return useMemo(() => {
    if (!spine) return null;
    return {
      read: (threadId) => spine.linksFor(threadId),
      // A task chip opens the side panel's Task view (§10); the rest open in full.
      open: (link) =>
        link.entity.type === "task" && openPanel
          ? openPanel("task")
          : openReferenceFull({ type: link.entity.type, id: link.entity.id }),
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
  }, [spine, openPanel]);
}

function useReaderWho(deps: ReaderWiringDeps): ReaderWho {
  const { engine, commands, contacts, whoFor, onAddContact, view, openPanel } = deps;
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
      // Open contact opens the side panel's Contact view (§10).
      onOpenContact: (id) =>
        openPanel
          ? openPanel("contact")
          : id
            ? openReferenceFull({ type: "contact", id })
            : undefined,
    }),
    [lookup, view, engine, commands, onAddContact, openPanel],
  );
}

/** The ⋯ menu's actions (AC26) and the Why names (AC8). */
function useReaderMenu(deps: ReaderWiringDeps, openRemind: (ids: string[]) => void) {
  const { commands, engine } = deps;
  const people = deps.priorityPeople ?? NO_PEOPLE;
  const settings = useMemo(
    () => (deps.senderSettings === undefined ? runtimeSenderSettings() : deps.senderSettings),
    [deps.senderSettings],
  );
  const ops = useMemo(
    () =>
      menuOps({
        commands,
        settings,
        priorityPeople: () => people,
        showUndo: (label, onUndo) => undoToast(label, { onUndo }),
        onError: (message) => toast.error(message),
      }),
    [commands, settings, people],
  );
  const { act, onIntent } = deps;
  const more: ReaderMoreActions = {
    ...ops,
    remind: engine?.setFollowUp ? (id) => openRemind([id]) : undefined,
    unread: (row) => act(row.unread ? "mark_read" : "mark_unread", [row.threadId]),
    move: (id) => onIntent("email.move", [id]),
    copyLink: copyThreadLink,
    delete: (id) => act("delete", [id]),
  };
  const why: ReaderWhy = {
    names: deps.whyNames ?? NO_NAMES,
    onOpenSettings: () => dispatchOpenSettings({ section: "mail", sub: "rules" }),
  };
  return { more, why };
}

export function useReaderWiring(deps: ReaderWiringDeps) {
  const apiRef = useRef<MailReaderApi | null>(null);
  const [remind, setRemind] = useState<{ ids: string[]; anchor: PickerAnchor | null } | null>(null);
  const pressed = usePressedButton();
  const links = useReaderLinks(deps.spine, deps.openPanel);
  const who = useReaderWho(deps);
  const { engine, spine, port } = deps;
  /** `w`, the toolbar's Remind and ⋯ → Remind me if no reply…: the picker on its button. */
  const openRemind = (ids: string[]) => {
    if (ids.length === 0 || !engine?.setFollowUp) return;
    setRemind({ ids, anchor: pickerAnchor(ids[0], "remind", pressed()) });
  };
  const menu = useReaderMenu(deps, openRemind);

  const onAction = (action: ReaderAction | MessageAction, threadId: string, messageId?: string) => {
    const compose = COMPOSE[action];
    const intent = INTENT[action as ReaderAction];
    if (compose) deps.openCompose(compose, threadId, messageId);
    else if (intent) deps.onIntent(intent, [threadId]);
    else if (action === "done") deps.act("done", [threadId]);
    else if (action === "remind") openRemind([threadId]);
    else if (action === "pin")
      void deps.rowOf(threadId).then((row) => deps.act(row?.pinned ? "unpin" : "pin", [threadId]));
  };

  /** The reader's own keys; true when handled. */
  const onKey = (intent: MailKeyId, threadIds: string[]): boolean => {
    // `w` (MV-7): Remind me if no reply, on every picked thread.
    if (intent === "email.remind") {
      openRemind(threadIds);
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
    more: menu.more,
    why: menu.why,
    done: view?.kind === "unified" && view.role === "archive",
    sendNotes: port
      ? {
          port,
          refreshKey: deps.placeKey,
          onEditOutbox: deps.editOutbox,
          onFix: deps.openDraft,
          onRetry: deps.retrySend,
          onRemoveAndSend: deps.removeAndSend,
        }
      : null,
  };

  const remindPicker = (
    <EmailSnoozePicker
      mode="remind"
      open={remind !== null}
      anchor={remind?.anchor ?? null}
      now={deps.now}
      onOpenChange={(o) => (o ? null : setRemind(null))}
      onPick={(at) => {
        const ids = remind?.ids ?? [];
        setRemind(null);
        if (ids.length === 0 || !engine?.setFollowUp) return;
        void Promise.all(ids.map((id) => engine.setFollowUp!(id, at.getTime()))).then(
          () => toast(`Reminds you ${shortDay(at.getTime(), deps.now())} if no reply`),
          (e) => toast.error(errText(e, "Couldn't set the reminder.")),
        );
      }}
    />
  );

  return { props, links, onKey, remindPicker, openRemind };
}
