// AC38 disconnect: the engine purges at once, unless Outbox has unsent mail;
// then the person is asked first ("1 unsent message will be discarded").

import type { EmailRuntime } from "@/lib/runtime.types.email";

export type DisconnectAsk = (unsent: number, proceed: () => void) => void;

export function unsentCopy(unsent: number): string {
  return unsent === 1
    ? "1 unsent message will be discarded."
    : `${unsent} unsent messages will be discarded.`;
}

/** Resolves true once purged, false when it is waiting on the person's answer. */
export async function disconnectMailAccount(
  email: Pick<EmailRuntime, "disconnect">,
  accountId: string,
  ask: DisconnectAsk,
  onPurged: () => void,
): Promise<boolean> {
  const out = await email.disconnect(accountId);
  if (out && out.status === "needs_confirm") {
    ask(out.unsent, () => {
      void email
        .disconnect(accountId, { confirmed: true })
        .then(onPurged)
        .catch(() => {});
    });
    return false;
  }
  onPurged();
  return true;
}
