// The reader's ⋯ menu and its "Why is this in {Tab}?" popover (MV-9): the
// menu's items for the open thread, and the explain answer read from the engine
// once per open thread (`explainThread`; the item hides when the engine lacks it).
// The popover opens from the menu, anchored to the ⋯ button.

import { type ReactNode, useEffect, useMemo, useState } from "react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { MailEngine, MailExplain, MailThread } from "@/lib/runtime.types.mail-engine";

import { type ReaderMoreActions, ReaderMoreItems } from "./more-menu";
import type { Person } from "./reader-format";
import { explainWhy, tabName, type WhyAnswer, WhyHerePopover, type WhyNames } from "./why-here";

export type ReaderWhy = {
  names: WhyNames;
  /** The footer link: Settings → Mail. */
  onOpenSettings?: () => void;
};

export type ReaderMoreInput = {
  engine: MailEngine | null;
  thread: MailThread;
  version: number;
  /** The newest sender who isn't you. */
  sender: Person | null;
  more: ReaderMoreActions | null | undefined;
  why: ReaderWhy | null | undefined;
  labels: ReactNode;
  onOriginal: (() => void) | null;
};

function useExplain(engine: MailEngine | null, threadId: string, version: number, on: boolean) {
  const [got, setGot] = useState<{ key: string; why: MailExplain | null } | null>(null);
  const key = `${threadId}:${version}`;
  useEffect(() => {
    if (!on || !engine?.explainThread) return;
    let gone = false;
    void engine.explainThread(threadId).then(
      (why) => !gone && setGot({ key, why }),
      () => !gone && setGot({ key, why: null }),
    );
    return () => {
      gone = true;
    };
  }, [on, engine, threadId, key]);
  return got?.key === key ? got.why : null;
}

/** The sender's name as the thread shows it, for the explain sentence. */
function nameFor(thread: MailThread, address: string): string {
  const lower = address.toLowerCase();
  const people = thread.messages.flatMap((m) => [m.from, ...m.to, ...m.cc]);
  return people.find((p) => p.email.toLowerCase() === lower && p.name.trim())?.name ?? "";
}

/** Measures the open reader's ⋯ button when the popover places itself. */
function moreButton(threadId: string) {
  return {
    current: {
      getBoundingClientRect: () =>
        document
          .querySelector(
            `[data-reader-thread="${CSS.escape(threadId)}"] [data-reader-action="more"]`,
          )
          ?.getBoundingClientRect() ?? new DOMRect(),
    },
  };
}

/** The ⋯ menu's items and the Why popover for the open thread. */
export function useReaderMore(input: ReaderMoreInput): { menu: ReactNode; popover: ReactNode } {
  const { engine, thread, version, sender, more, why, labels, onOriginal } = input;
  const threadId = thread.row.threadId;
  const canExplain = !!why && !!engine?.explainThread;
  const explained = useExplain(engine, threadId, version, canExplain);
  const [answer, setAnswer] = useState<WhyAnswer | null>(null);
  const anchor = useMemo(() => moreButton(threadId), [threadId]);

  const names = why?.names ?? { rules: [], customTabs: [] };
  const tab = explained
    ? tabName(explained.tab, explained.customTabId, names.customTabs)
    : tabName(thread.row.tab, null, names.customTabs);
  const openWhy = () => {
    if (!explained) return;
    setAnswer(explainWhy(explained, names, nameFor(thread, explained.address)));
  };

  const menu = more ? (
    <ReaderMoreItems
      thread={thread}
      sender={sender}
      actions={more}
      labels={labels}
      why={canExplain && explained ? { tab, open: openWhy } : null}
      onOriginal={onOriginal}
    />
  ) : labels || onOriginal ? (
    <>
      {labels}
      {onOriginal ? <DropdownMenuItem onSelect={onOriginal}>Show original</DropdownMenuItem> : null}
    </>
  ) : null;

  const popover = canExplain ? (
    <WhyHerePopover
      answer={answer}
      anchor={anchor}
      onClose={() => setAnswer(null)}
      onOpenSettings={why?.onOpenSettings}
    />
  ) : null;
  return { menu, popover };
}
