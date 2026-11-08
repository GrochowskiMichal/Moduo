// Mail's side panel (specs/mail-v3.md §10, decision 16; specs/mail-improve.md §1):
// the shell's right panel (`components/app/right-panel.tsx`) with Mail's views from
// `panel-views.ts`: Today (⌥1), Contact (⌥2) and Task (⌥3). The open view is the
// mail store's `panel`; null hides it. Its visibility is the person's setting only:
// ⌥0, the reader's panel button, ⌥1–3 or this panel's menu. Nothing else (a thread, a
// place, compose) shows or hides it, so the reading column never changes width.
// Below a 1180 px window it folds to a 40 px icon strip; an icon opens that view as
// an overlay over the reader (Esc closes it). This follows live resizes; widening
// restores the panel as the person left it.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { RightPanel } from "@/components/app/right-panel";
import { IconButton } from "@/components/ui/icon-button";
import type { MailEngine, MailThreadRow, MailView } from "@/lib/runtime.types.mail-engine";

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

/** Below this window width the panel folds to the icon strip (§1). */
export const SIDE_PANEL_MIN_VIEWPORT = 1180;

const lastView = new WeakMap<MailStore, MailPanelView>();

/** Shows `view`, remembering it for the next toggle. */
export function showMailPanel(store: MailStore, view: MailPanelView): void {
  lastView.set(store, view);
  store.setState({ panel: view });
}

/** ⌥0 and the panel button: hides the panel, or brings back the last view (Today first). */
export function toggleMailPanel(store: MailStore): void {
  const open = store.getState().panel;
  if (open) {
    lastView.set(store, open);
    store.setState({ panel: null });
  } else showMailPanel(store, lastView.get(store) ?? "today");
}

/** "Create event from this email" makes sense only for a received conversation (AC18). */
export function createEventAllowed(input: {
  view: MailView | null;
  composingNew: boolean;
  threadId: string | null;
}): boolean {
  if (!input.threadId || input.composingNew) return false;
  const v = input.view;
  if (v?.kind === "outbox") return false;
  if (v?.kind === "unified" && v.role === "drafts") return false;
  return true;
}

const narrowNow = () =>
  typeof window !== "undefined" && window.innerWidth < SIDE_PANEL_MIN_VIEWPORT;

/** True below 1180 px, following live resizes. */
function useNarrowWindow(): boolean {
  const [narrow, setNarrow] = useState(narrowNow);
  useEffect(() => {
    const on = () => setNarrow(narrowNow());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return narrow;
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
  /** Task made (`t`): its title opens editable with the text selected (AC13). */
  editTitleFor?: string | null;
  onRenameTask?: (taskId: string, title: string) => void;
  onEditTitleDone?: () => void;
  onOpenThread: (threadId: string) => void;
  onPreview: (entry: AttachmentEntry) => void;
};

function PanelViews({
  props,
  view,
  onChange,
  onHide,
}: {
  props: MailSidePanelProps;
  view: MailPanelView;
  onChange: (view: MailPanelView) => void;
  onHide: () => void;
}) {
  return (
    <RightPanel
      module="email"
      activeId={view}
      onChange={(id) => onChange(id as MailPanelView)}
      onHide={onHide}
      views={{
        today: () => <TodayBody {...props} />,
        contact: () => <ContactBody {...props} />,
        task: () => <TaskBody {...props} />,
      }}
    />
  );
}

/** The folded panel: one icon per view; an icon opens its view over the reader. */
function PanelStrip(props: MailSidePanelProps) {
  const [peek, setPeek] = useState<MailPanelView | null>(null);
  const label = emailPanelViews.find((v) => v.id === peek)?.label ?? "Today";
  return (
    <>
      <nav
        aria-label="Side panel"
        data-mail-panel-strip
        className="flex w-(--panel-strip-w) shrink-0 flex-col items-center gap-1 border-l border-hairline py-2"
      >
        {emailPanelViews.map((v, i) => (
          <IconButton
            key={v.id}
            icon={v.icon}
            label={v.label}
            tooltip={`${v.label}  ⌥${i + 1}`}
            tooltipSide="left"
            aria-pressed={peek === v.id}
            aria-keyshortcuts={`Alt+${i + 1}`}
            onClick={() => setPeek((p) => (p === v.id ? null : v.id))}
          />
        ))}
      </nav>
      {peek ? (
        <aside
          aria-label={label}
          data-mail-panel-overlay={peek}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            setPeek(null);
          }}
          className="motion-key absolute inset-y-0 right-(--panel-strip-w) z-(--z-popover) flex w-72 flex-col border-l border-hairline bg-background p-(--panel-pad) shadow-lg"
        >
          <PanelViews props={props} view={peek} onChange={setPeek} onHide={() => setPeek(null)} />
        </aside>
      ) : null}
    </>
  );
}

export function MailSidePanel(props: MailSidePanelProps) {
  const { store } = props;
  const narrow = useNarrowWindow();
  const panel = useMailStore((s) => s.panel, store);
  // Hidden, ⌥1–3 and ⌥0 still open it: the shell binds them (`email.panel-*`).
  if (!panel) return null;
  if (narrow) return <PanelStrip {...props} />;
  const label = emailPanelViews.find((v) => v.id === panel)?.label ?? "Today";
  return (
    <aside
      aria-label={label}
      data-mail-panel={panel}
      className="flex w-72 shrink-0 flex-col border-l border-hairline p-(--panel-pad)"
    >
      <PanelViews
        props={props}
        view={panel}
        onChange={(id) => showMailPanel(store, id)}
        onHide={() => toggleMailPanel(store)}
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

function TaskBody(p: MailSidePanelProps) {
  const linked = useThreadLinks(p.links, p.threadId);
  return (
    <div className="pane-scroll h-full overflow-y-auto">
      <TaskView
        threadId={p.threadId}
        links={linked}
        taskFor={p.taskFor}
        onOpenTask={p.onOpenTask}
        onMakeTask={p.onMakeTask}
        editTitleFor={p.editTitleFor}
        onRenameTask={p.onRenameTask}
        onEditTitleDone={p.onEditTitleDone}
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
