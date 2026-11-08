// The conversation stack (specs/mail-v3.md §8, AC24): the newest message and
// every unread one start open, older ones fold to a one-line header, and a
// thread of more than five messages folds its middle into "{n} earlier
// messages" (a click, or `o` through the reader's API, expands everything).

import type { MailAttachment, MailMessage } from "@/lib/runtime.types.mail-engine";

import { type MessageAction, MessageCard } from "./message-card";
import type { ReaderImagesInput } from "./sanitize";

/** Threads longer than this fold their middle. */
export const FOLD_AFTER = 5;

export type StackItem =
  { kind: "message"; message: MailMessage; index: number } | { kind: "fold"; count: number };

/** The first message, the fold, then the newest two; everything when unfolded. */
export function stackItems(messages: readonly MailMessage[], unfolded: boolean): StackItem[] {
  const all = messages.map((message, index): StackItem => ({ kind: "message", message, index }));
  if (unfolded || messages.length <= FOLD_AFTER) return all;
  const tail = messages.length - 2;
  return [all[0]!, { kind: "fold", count: tail - 1 }, ...all.slice(tail)];
}

export type MessageStackProps = {
  /** For the collapsed rows' day. */
  nowMs?: number;
  threadId: string;
  messages: readonly MailMessage[];
  open: Record<string, boolean>;
  allOpen: boolean;
  unfolded: boolean;
  onToggle: (messageId: string, expanded: boolean) => void;
  onUnfold: () => void;
  images: (message: MailMessage) => ReaderImagesInput;
  trackerBlocking: boolean;
  selfAddresses: ReadonlySet<string>;
  offline: boolean;
  darkSurface: boolean;
  originalId: string | null;
  loadOriginal?: (messageId: string) => Promise<string>;
  onAction?: (action: MessageAction, messageId: string) => void;
  onAlwaysImages?: (address: string) => void;
  files: {
    fileUrl?: (a: MailAttachment) => string | null;
    previewUrl?: (a: MailAttachment) => string | null;
    onAttachment?: (a: MailAttachment) => void;
  };
};

export function MessageStack(props: MessageStackProps) {
  const { messages, open, allOpen, threadId } = props;
  const last = messages.length - 1;
  const isOpen = (m: MailMessage, i: number) =>
    allOpen || m.id === props.originalId || (open[m.id] ?? (i === last || m.unread));
  return (
    <div className="flex flex-col">
      {stackItems(messages, props.unfolded).map((item) => {
        if (item.kind === "fold") {
          return (
            <button
              key="fold"
              type="button"
              onClick={props.onUnfold}
              aria-keyshortcuts="o"
              className="min-h-(--row-h-sm) w-full border-b border-hairline bg-tag-chip-surface text-xs text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.count} earlier messages
            </button>
          );
        }
        const { message: m, index } = item;
        const expanded = isOpen(m, index);
        return (
          <MessageCard
            key={m.id}
            message={m}
            threadId={threadId}
            expanded={expanded}
            onToggle={() => props.onToggle(m.id, !expanded)}
            nowMs={props.nowMs}
            images={props.images(m)}
            trackerBlocking={props.trackerBlocking}
            selfAddresses={props.selfAddresses}
            offline={props.offline}
            darkSurface={props.darkSurface}
            showOriginal={props.originalId === m.id}
            loadOriginal={props.loadOriginal}
            onAction={props.onAction}
            onAlwaysImages={props.onAlwaysImages}
            fileUrl={props.files.fileUrl}
            previewUrl={props.files.previewUrl}
            onAttachment={props.files.onAttachment}
          />
        );
      })}
    </div>
  );
}
