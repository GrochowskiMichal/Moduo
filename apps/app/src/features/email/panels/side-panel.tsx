// Mail's side panel (specs/mail-v3.md §10, decision 16): the shell's right
// panel (`components/app/right-panel.tsx`) with Mail's views from
// `panel-views.ts`: Today (⌥1), Contact (⌥2) and Task (⌥3). The open view is
// the mail store's `panel`; null hides it. The reader's panel button toggles
// it, the title row's menu switches views or hides it, and ⌥1–3 pick a view
// (the shell's `email.panel-*` keys while hidden, the right panel's own while
// it shows). Below 1200 px it starts hidden.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { RightPanel } from "@/components/app/right-panel";
import type { MailEngine, MailThreadRow } from "@/lib/runtime.types.mail-engine";

import { emailPanelViews } from "../panel-views";
import type { ReaderLinks } from "../reader/thread-links";
import { useThreadLinks } from "../reader/thread-links";
import type { MailWho } from "../reader/who-card";
import { type MailPanelView, type MailStore } from "../store/mail-store";
import { useMailStore } from "../store/use-mail-store";
import { suggestContacts } from "../suggest-contact";
import type { AttachmentEntry } from "../views/attachments-model";
import { ContactView, type MailContactDetail } from "./contact-view";
import { type MailWithPerson, useMailWithPerson } from "./mail-with-person";
import { type MailTaskDetail, TaskView } from "./task-view";
import { TodayPanel, type TodayPanelProps } from "./today-panel";

/** Below this width the panel starts hidden (§10). */
export const SIDE_PANEL_MIN_VIEWPORT = 1200;

const lastView = new WeakMap<MailStore, MailPanelView>();
const narrowChecked = new WeakSet<MailStore>();

/** Shows `view`, remembering it for the next toggle. */
export function showMailPanel(store: MailStore, view: MailPanelView): void {
  lastView.set(store, view);
  store.setState({ panel: view });
}

/** The panel button: hides the panel, or brings back the last view (Today first). */
export function toggleMailPanel(store: MailStore): void {
  const open = store.getState().panel;
  if (open) {
    lastView.set(store, open);
    store.setState({ panel: null });
  } else showMailPanel(store, lastView.get(store) ?? "today");
}

/** Starts hidden on a narrow window: once per store, so a choice made after sticks. */
function useNarrowStart(store: MailStore) {
  useLayoutEffect(() => {
    if (narrowChecked.has(store)) return;
    narrowChecked.add(store);
    if (typeof window !== "undefined" && window.innerWidth < SIDE_PANEL_MIN_VIEWPORT) {
      const open = store.getState().panel;
      if (open) lastView.set(store, open);
      store.setState({ panel: null });
    }
  }, [store]);
}

export type MailSidePanelProps = {
  store: MailStore;
  /** The open thread, or null. */
  threadId: string | null;
  engine: MailEngine | null;
  version: number;
  nowMs: number;
  /** The Today view's tasks, events and drops; null without the spine. */
  today: Omit<TodayPanelProps, "nowMs"> | null;
  links: ReaderLinks | null;
  rowOf: (threadId: string) => Promise<MailThreadRow | null>;
  /** Your addresses (lower-case). */
  selfAddresses: readonly string[];
  /** Contact addresses (lower-case). */
  contacts: ReadonlySet<string>;
  whoFor?: (address: string) => Promise<MailWho | null>;
  contactDetailFor?: (address: string) => Promise<MailContactDetail | null>;
  taskFor?: (taskId: string) => MailTaskDetail | null;
  onAddContact?: (email: string, name: string) => void;
  onOpenContact?: (contactId: string) => void;
  onOpenItem?: (type: "task" | "note" | "calendar_event", id: string) => void;
  onOpenTask?: (taskId: string) => void;
  onMakeTask?: () => void;
  onOpenThread: (threadId: string) => void;
  onPreview: (entry: AttachmentEntry) => void;
};

export function MailSidePanel(props: MailSidePanelProps) {
  const { store } = props;
  useNarrowStart(store);
  const panel = useMailStore((s) => s.panel, store);
  // Hidden, ⌥1–3 still open it: the shell binds them (`email.panel-*`, MV-7).
  if (!panel) return null;
  const label = emailPanelViews.find((v) => v.id === panel)?.label ?? "Today";
  return (
    <aside
      aria-label={label}
      data-mail-panel={panel}
      className="flex w-72 shrink-0 flex-col border-l border-hairline p-(--panel-pad)"
    >
      <RightPanel
        module="email"
        activeId={panel}
        onChange={(id) => showMailPanel(store, id as MailPanelView)}
        onHide={() => toggleMailPanel(store)}
        views={{
          today: () => <TodayBody {...props} />,
          contact: () => <ContactBody {...props} />,
          task: () => <TaskBody {...props} />,
        }}
      />
    </aside>
  );
}

function TodayBody({ today, nowMs }: MailSidePanelProps) {
  if (!today) {
    return <p className="px-2 text-xs text-muted-foreground">Today needs your Moduo workspace.</p>;
  }
  return (
    <div className="pane-scroll h-full overflow-y-auto">
      <TodayPanel {...today} nowMs={nowMs} />
    </div>
  );
}

function TaskBody({ threadId, links, taskFor, onOpenTask, onMakeTask }: MailSidePanelProps) {
  const linked = useThreadLinks(links, threadId);
  return (
    <div className="pane-scroll h-full overflow-y-auto">
      <TaskView
        threadId={threadId}
        links={linked}
        taskFor={taskFor}
        onOpenTask={onOpenTask}
        onMakeTask={onMakeTask}
      />
    </div>
  );
}

const NO_MAIL: MailWithPerson = { rows: [], messages: [] };

/** The open thread's other person: the newest sender who isn't you. */
function useSender(threadId: string | null, rowOf: MailSidePanelProps["rowOf"], selfKey: string) {
  const [got, setGot] = useState<{ id: string; sender: { name: string; email: string } | null }>();
  // The page rebuilds `rowOf` every render: read it through a ref, once per thread.
  const read = useRef(rowOf);
  useLayoutEffect(() => {
    read.current = rowOf;
  });
  useEffect(() => {
    if (!threadId) return;
    let gone = false;
    void read.current(threadId).then(
      (row) => {
        const mine = new Set(selfKey.split(","));
        const senders = row?.senders ?? [];
        const other = [...senders].reverse().find((s) => !mine.has(s.email.toLowerCase()));
        const pick = other ?? senders.at(-1) ?? null;
        if (!gone) setGot({ id: threadId, sender: pick });
      },
      () => !gone && setGot({ id: threadId, sender: null }),
    );
    return () => {
      gone = true;
    };
  }, [threadId, selfKey]);
  return got && got.id === threadId ? got.sender : null;
}

/** One async read per address (the who-card's and the detail's). */
function useByAddress<T>(
  source: ((a: string) => Promise<T | null>) | undefined,
  address: string | null,
) {
  const [got, setGot] = useState<{ address: string; value: T | null }>();
  const read = useRef(source);
  useLayoutEffect(() => {
    read.current = source;
  });
  const has = !!source;
  useEffect(() => {
    const run = read.current;
    if (!run || !address) return;
    let gone = false;
    void run(address).then(
      (value) => !gone && setGot({ address, value }),
      () => !gone && setGot({ address, value: null }),
    );
    return () => {
      gone = true;
    };
  }, [has, address]);
  return got && got.address === address ? got.value : null;
}

function ContactBody(p: MailSidePanelProps) {
  const sender = useSender(p.threadId, p.rowOf, p.selfAddresses.join(","));
  const address = sender?.email.toLowerCase() ?? null;
  const who = useByAddress(p.whoFor, address);
  const detail = useByAddress(p.contactDetailFor, address);
  const mail = useMailWithPerson(p.engine, address, p.version, NO_MAIL);
  const suggestedName = useMemo(() => {
    if (!sender) return "";
    if (sender.name.trim()) return sender.name.trim();
    const hit = suggestContacts(mail.messages, {
      ownAddresses: new Set(p.selfAddresses),
      contacts: p.contacts,
    }).find((s) => s.email === address);
    return hit?.name ?? "";
  }, [sender, mail.messages, p.selfAddresses, p.contacts, address]);
  return (
    <div className="pane-scroll h-full overflow-y-auto">
      <ContactView
        sender={p.threadId ? sender : null}
        who={who}
        detail={detail}
        mail={mail}
        nowMs={p.nowMs}
        suggestedName={suggestedName}
        onOpenThread={p.onOpenThread}
        onPreview={p.onPreview}
        onAddContact={p.onAddContact}
        onOpenContact={p.onOpenContact}
        onOpenItem={p.onOpenItem}
      />
    </div>
  );
}
