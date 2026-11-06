// The open thread's spine links (specs/mail-v3.md §8, AC22): read once per open
// thread through the injected source, and again whenever a gesture on this page
// links or unlinks something (`bumpThreadLinks`). `entity_links` is not in the
// Realtime publication yet, so a link made elsewhere shows on the next open.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { MailThreadLink, SpineEntity } from "../commands/spine";

/** Where the reader's chips come from and what they do. */
export type ReaderLinks = {
  read(threadId: string): Promise<MailThreadLink[]>;
  /** A chip click: open the linked item. */
  open(link: MailThreadLink): void;
  /** A chip's ✕: unlink, with an undo toast. */
  unlink(link: MailThreadLink): void;
};

let version = 0;
const listeners = new Set<() => void>();

/** A link was made or removed on this page: every open reader re-reads its links. */
export function bumpThreadLinks(): void {
  version += 1;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getVersion = () => version;

/** The thread's links; empty until read, or when there is no source. */
export function useThreadLinks(
  links: ReaderLinks | null | undefined,
  threadId: string | null,
): MailThreadLink[] {
  const bump = useSyncExternalStore(subscribe, getVersion, getVersion);
  const [got, setGot] = useState<{ threadId: string; links: MailThreadLink[] } | null>(null);
  // The source may be rebuilt every render; read once per thread and per bump.
  const read = useRef(links?.read);
  read.current = links?.read;
  const hasSource = !!links;
  useEffect(() => {
    const run = read.current;
    if (!run || !threadId) return;
    let gone = false;
    void run(threadId).then(
      (list) => !gone && setGot({ threadId, links: list }),
      () => {},
    );
    return () => {
      gone = true;
    };
  }, [hasSource, threadId, bump]);
  return got && got.threadId === threadId ? got.links : [];
}

/** The link to `entity`, when the thread already has one. */
export function linkTo(
  links: readonly MailThreadLink[],
  entity: Pick<SpineEntity, "type" | "id">,
): MailThreadLink | null {
  return links.find((l) => l.entity.type === entity.type && l.entity.id === entity.id) ?? null;
}

const KIND_WORD: Record<string, string> = {
  task: "Task",
  note: "Note",
  contact: "Contact",
  project: "Project",
  calendar_event: "Event",
  event: "Event",
};

/** The link picker's quiet hint: "Linked" for what the thread already links to. */
export function linkPickerHint(
  linked: readonly Pick<SpineEntity, "type" | "id">[],
  entity: Pick<SpineEntity, "type" | "id">,
): string {
  return isLinked(linked, entity) ? "Linked" : (KIND_WORD[entity.type] ?? "");
}

/** True when `entity` is among the thread's linked items. */
export function isLinked(
  linked: readonly Pick<SpineEntity, "type" | "id">[],
  entity: Pick<SpineEntity, "type" | "id">,
): boolean {
  return linked.some((l) => l.type === entity.type && l.id === entity.id);
}

/** A chip's words: "Task: Confirm Acme pilot"; other kinds show their label. */
export function linkChipLabel(link: MailThreadLink): string {
  const label = link.entity.label?.trim() || KIND_WORD[link.entity.type] || link.entity.type;
  return link.entity.type === "task" ? `Task: ${label}` : label;
}
