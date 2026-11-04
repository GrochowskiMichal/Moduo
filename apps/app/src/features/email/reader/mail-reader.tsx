// The rebuilt reader (MR-10): the selected thread's conversation stack from
// the engine. The newest message and every unread one start open; older ones
// fold to a one-line header. Re-reads when the engine's threads change.

import { useEffect, useState } from "react";

import type { MailEngine, MailThread } from "@/lib/runtime.types.mail-engine";

import type { MailBehavior } from "../engine/behavior";
import { MessageCard } from "./message-card";

export type MailReaderProps = {
  engine: MailEngine | null;
  threadId: string | null;
  version: number;
  behavior: Pick<MailBehavior, "remoteImages" | "trackerBlocking">;
};

function useThread(engine: MailEngine | null, threadId: string | null, version: number) {
  const [got, setGot] = useState<{ key: string; thread: MailThread | null } | null>(null);
  const key = `${threadId}:${version}`;
  useEffect(() => {
    if (!engine || !threadId) return;
    let gone = false;
    void engine.getThread(threadId).then(
      (thread) => {
        if (!gone) setGot({ key, thread });
      },
      () => {
        if (!gone) setGot({ key, thread: null });
      },
    );
    return () => {
      gone = true;
    };
  }, [engine, threadId, key]);
  const thread = got?.thread?.row.threadId === threadId ? got.thread : null;
  return { thread, loading: got?.key !== key };
}

export function MailReader(props: MailReaderProps) {
  return <ThreadStack key={props.threadId ?? ""} {...props} />;
}

function ThreadStack({ engine, threadId, version, behavior }: MailReaderProps) {
  const { thread, loading } = useThread(engine, threadId, version);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (!threadId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        No conversation selected
      </div>
    );
  }
  if (!thread) {
    return (
      <div aria-busy={loading} className="flex-1 p-4 text-sm text-muted-foreground">
        {loading ? "Opening…" : "This conversation is no longer here."}
      </div>
    );
  }
  const last = thread.messages.length - 1;
  const loadOriginal = engine?.getRawMessage
    ? (id: string) => engine.getRawMessage!(id)
    : undefined;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-reader-thread={threadId}>
      <h2 className="px-4 pt-4 pb-2 text-lg font-semibold text-foreground">{thread.row.subject}</h2>
      {thread.messages.map((m, i) => {
        const expanded = open[m.id] ?? (i === last || m.unread);
        return (
          <MessageCard
            key={m.id}
            message={m}
            threadId={threadId}
            expanded={expanded}
            onToggle={() => setOpen((o) => ({ ...o, [m.id]: !expanded }))}
            images={{
              policy: behavior.remoteImages,
              senderIsContact: false,
              senderAllowed: false,
              loadedForMessage: false,
            }}
            trackerBlocking={behavior.trackerBlocking}
            loadOriginal={loadOriginal}
          />
        );
      })}
    </div>
  );
}
