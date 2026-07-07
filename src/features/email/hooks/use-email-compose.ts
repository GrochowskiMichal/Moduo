// Compose surface state + the 10s undo-send (EM-7, AC10/AC11). Owns the open draft,
// starts the send hold (JS timer — no server queue, so Undo / quit inside the window
// is a guaranteed no-send), and stashes the in-flight draft to localStorage on
// unmount so an app-quit inside the window surfaces it on next open.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { EmailSendInput, ModuoRuntime } from "../../../lib/runtime.types";
import type { ComposeDraft } from "../compose";
import { createSendHold, SEND_UNDO_MS, type SendHold } from "../undo-send";

const DRAFT_STASH_KEY = "moduo:email:compose-stash";

type Params = {
  runtime: ModuoRuntime | null;
  isDesktop: boolean;
  /** Called after a send actually fires (post-window) — refresh the inbox. */
  onSent?: () => void;
};

export function useEmailCompose({ runtime, isDesktop, onSent }: Params) {
  const [draft, setDraft] = useState<ComposeDraft | null>(null);

  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;

  // One hold controller for the component's lifetime; its send reads live refs.
  const holdRef = useRef<SendHold<EmailSendInput, ComposeDraft> | null>(null);
  if (!holdRef.current) {
    holdRef.current = createSendHold<EmailSendInput, ComposeDraft>({
      delayMs: SEND_UNDO_MS,
      send: (input) => {
        void runtimeRef.current?.email
          .sendMessage(input)
          .then(() => {
            toast("Message sent");
            onSentRef.current?.();
          })
          .catch((e) =>
            toast.error(e instanceof Error ? e.message : "Couldn't send the message."),
          );
      },
    });
  }

  // Restore a draft stashed by a prior quit-inside-the-window (AC11).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_STASH_KEY);
      if (raw) {
        setDraft(JSON.parse(raw) as ComposeDraft);
        localStorage.removeItem(DRAFT_STASH_KEY);
      }
    } catch {
      /* ignore malformed stash */
    }
  }, []);

  // On unmount: abandon any pending send (NEVER send on quit) + stash the draft.
  useEffect(() => {
    const hold = holdRef.current;
    return () => {
      const stash = hold?.abandon() ?? null;
      if (stash) {
        try {
          localStorage.setItem(DRAFT_STASH_KEY, JSON.stringify(stash));
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  const openDraft = useCallback((d: ComposeDraft) => setDraft(d), []);
  const close = useCallback(() => setDraft(null), []);

  /** Start the 10s hold; Undo reopens compose with the exact draft. */
  const send = useCallback(
    (input: EmailSendInput, draftForUndo: ComposeDraft) => {
      if (!isDesktop || !holdRef.current) return;
      setDraft(null);
      holdRef.current.start(input, draftForUndo);
      toast("Sending…", {
        duration: SEND_UNDO_MS,
        action: {
          label: "Undo",
          onClick: () => {
            const restored = holdRef.current?.undo() ?? null;
            if (restored) setDraft(restored);
          },
        },
      });
    },
    [isDesktop],
  );

  return { draft, openDraft, close, send };
}
