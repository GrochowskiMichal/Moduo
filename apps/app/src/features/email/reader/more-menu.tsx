// The reader's ⋯ menu (specs/mail-v3.md §8, AC26; specs/mail-improve.md §4), in
// exactly this order: Pin p · Move… m · Private note n · Mark unread u · Labels… (Gmail only) ·
// Mute · Why is this in {Tab}? · Mark Priority · Show original · Copy link ·
// Block {sender} · Report spam · Delete #. Mute, Report spam and Block run the
// engine's `mute`, `spam` and `block_sender` ops through the triage commands,
// each with an undo toast; Block and Mark Priority also save the sender in
// Settings (`blocked_sender`, `priority_person`), which the undo removes.

import type { ReactNode } from "react";

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import type { MailOpInput, MailThread, MailThreadRow } from "@/lib/runtime.types.mail-engine";

import type { MailCommands } from "../commands/triage";
import type { Person } from "./reader-format";

/** Settings items the menu writes (the runtime's `upsertSetting` / `deleteSetting`). */
export type SenderSettingsPort = {
  /** Saves an item; resolves to its id. */
  upsert(kind: "blocked_sender" | "priority_person", value: { address: string }): Promise<string>;
  remove(id: string): Promise<unknown>;
};

export type ReaderMoreActions = {
  /** Opens the remind picker; absent when the engine has no follow-ups. */
  remind?: (threadId: string) => void;
  unread: (row: MailThreadRow) => void;
  move: (threadId: string) => void;
  mute: (row: MailThreadRow) => void;
  /** Priority people; absent when Settings can't be written here. */
  priority?: {
    isPriority(address: string): boolean;
    toggle(sender: Person): void;
  };
  copyLink: (threadId: string) => void;
  block: (row: MailThreadRow, sender: Person) => void;
  spam: (row: MailThreadRow) => void;
  delete: (threadId: string) => void;
};

function Item({
  onSelect,
  keyCap,
  children,
  danger,
}: {
  onSelect: () => void;
  keyCap?: string;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} variant={danger ? "destructive" : undefined}>
      {children}
      {keyCap ? <DropdownMenuShortcut aria-hidden>{keyCap}</DropdownMenuShortcut> : null}
    </DropdownMenuItem>
  );
}

export type ReaderMoreItemsProps = {
  thread: MailThread;
  /** The newest sender who isn't you; null hides Mark Priority and Block. */
  sender: Person | null;
  actions: ReaderMoreActions;
  /** Labels… for a Gmail thread (`useMailLabels().readerMenuItems`). */
  labels?: ReactNode;
  /** "Why is this in {Tab}?": the tab's name and the opener; null hides it. */
  why: { tab: string; open: () => void } | null;
  /** Show original; null when the engine can't read raw messages. */
  onOriginal: (() => void) | null;
  /** The toolbar's actions that live in ⋯ (specs/mail-improve.md §4): Pin, Private note. */
  onTool?: (action: "pin" | "note") => void;
};

/** The person's display name for "Block {sender}". */
const nameOf = (p: Person) => p.name.trim() || p.email;

export function ReaderMoreItems({
  thread,
  sender,
  actions,
  labels,
  why,
  onOriginal,
  onTool,
}: ReaderMoreItemsProps) {
  const row = thread.row;
  const id = row.threadId;
  const priority = sender && actions.priority ? actions.priority : null;
  const isPriority = !!sender && !!priority?.isPriority(sender.email.toLowerCase());
  return (
    <>
      <Item keyCap="p" onSelect={() => onTool?.("pin")}>
        {row.pinned ? "Unpin" : "Pin"}
      </Item>
      <Item keyCap="m" onSelect={() => actions.move(id)}>
        Move…
      </Item>
      <Item keyCap="n" onSelect={() => onTool?.("note")}>
        Private note
      </Item>
      <Item keyCap="u" onSelect={() => actions.unread(row)}>
        {row.unread ? "Mark read" : "Mark unread"}
      </Item>
      {labels}
      <Item onSelect={() => actions.mute(row)}>{row.muted ? "Unmute" : "Mute"}</Item>
      <DropdownMenuSeparator />
      {why ? <Item onSelect={why.open}>Why is this in {why.tab}?</Item> : null}
      {priority && sender ? (
        <Item onSelect={() => priority.toggle(sender)}>
          {isPriority ? "Remove from Priority" : "Mark Priority"}
        </Item>
      ) : null}
      {onOriginal ? <Item onSelect={onOriginal}>Show original</Item> : null}
      <Item onSelect={() => actions.copyLink(id)}>Copy link</Item>
      <DropdownMenuSeparator />
      {sender ? (
        <Item danger onSelect={() => actions.block(row, sender)}>
          Block {nameOf(sender)}
        </Item>
      ) : null}
      <Item onSelect={() => actions.spam(row)}>Report spam</Item>
      <Item danger keyCap="#" onSelect={() => actions.delete(id)}>
        Delete
      </Item>
    </>
  );
}

export type MenuOpsDeps = {
  commands: Pick<MailCommands, "apply" | "undo">;
  /** Absent: Block runs only its op, and Mark Priority hides. */
  settings: SenderSettingsPort | null;
  /** Priority people from Settings (item id, lower-case address). */
  priorityPeople: () => readonly { id: string; address: string }[];
  showUndo: (label: string, onUndo: () => void) => void;
  onError: (message: string) => void;
};

const errText = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

/**
 * Mute, Report spam, Block and Mark Priority: each one undoable step. An op runs
 * through the triage commands (so `z` undoes it too); the toast's Undo undoes
 * that entry and removes any Settings item the step saved.
 */
export function menuOps(deps: MenuOpsDeps) {
  const run = async (
    kind: MailOpInput["kind"],
    row: MailThreadRow,
    label: string,
    alsoUndo?: () => Promise<unknown>,
  ) => {
    const entry = await deps.commands.apply({ kind, threadIds: [row.threadId] });
    deps.showUndo(label, () => {
      if (entry) void deps.commands.undo(entry).catch(() => {});
      if (alsoUndo) void alsoUndo().catch(() => {});
    });
  };
  const guard = (p: Promise<unknown>, fallback: string) =>
    void p.catch((e) => deps.onError(errText(e, fallback)));
  const settings = deps.settings;

  const block = async (row: MailThreadRow, sender: Person) => {
    const address = sender.email.trim().toLowerCase();
    const saved = settings ? await settings.upsert("blocked_sender", { address }) : null;
    await run("block_sender", row, `Blocked ${nameOf(sender)}`, () =>
      saved && settings ? settings.remove(saved) : Promise.resolve(),
    );
  };

  const togglePriority = async (sender: Person) => {
    if (!settings) return;
    const address = sender.email.trim().toLowerCase();
    const name = nameOf(sender);
    const have = deps.priorityPeople().find((p) => p.address === address);
    if (have) {
      await settings.remove(have.id);
      deps.showUndo(`${name} is no longer a Priority person`, () =>
        guard(settings.upsert("priority_person", { address }), "Couldn't undo that."),
      );
      return;
    }
    const id = await settings.upsert("priority_person", { address });
    deps.showUndo(`${name} is a Priority person`, () =>
      guard(settings.remove(id), "Couldn't undo that."),
    );
  };

  return {
    mute: (row: MailThreadRow) =>
      guard(
        row.muted
          ? run("unmute", row, "Unmuted")
          : run("mute", row, "Muted · new replies skip the inbox"),
        "Couldn't mute that.",
      ),
    spam: (row: MailThreadRow) =>
      guard(run("spam", row, "Reported as spam"), "Couldn't report that."),
    block: (row: MailThreadRow, sender: Person) =>
      guard(block(row, sender), "Couldn't block that sender."),
    priority: settings
      ? {
          isPriority: (address: string) => deps.priorityPeople().some((p) => p.address === address),
          toggle: (sender: Person) =>
            guard(togglePriority(sender), "Couldn't change Priority people."),
        }
      : undefined,
  };
}
