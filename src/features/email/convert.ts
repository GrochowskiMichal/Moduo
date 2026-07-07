// Convert email → task (EM-8, AC8 "the great moment"). Pure prefill + link-arg
// helpers. The orchestration (upsertRef → upsertTask → createLink ×2) runs in the
// hook, reusing shipped ops — there is NO atomic SQL op because tasks are written
// client-direct (no tasks_op_create to PERFORM); re-implementing task insertion in
// SQL would duplicate the client mapper and drift silently (untyped client). The
// email stays put; the task lands in Inbox linked spawned-from the thread, and the
// thread references the resolved contact. Undo removes task + links (+ the ref if
// this convert created it).

/** Strip Re:/Fwd: and fall back to a placeholder for the task title. */
export function cleanTaskTitle(subject: string): string {
  const stripped = subject.replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").trim();
  return stripped || "(no subject)";
}

/** Task description = the snippet + a back-reference to the source email. */
export function buildConvertDescription(args: {
  snippet: string;
  subject: string;
  refId?: string | null;
}): string {
  const parts: string[] = [];
  const snippet = args.snippet.trim();
  if (snippet) parts.push(snippet);
  const title = cleanTaskTitle(args.subject);
  const backlink = args.refId
    ? `↳ From email “${title}” · moduo://email_thread/${args.refId}`
    : `↳ From email “${title}”`;
  parts.push(backlink);
  return parts.join("\n\n");
}

/** A contact reduced to what address-resolution needs. */
export type ContactAddressIndex = {
  id: string;
  /** Every email address on the contact, any case. */
  emails: string[];
};

/**
 * Resolve a From address to an existing contact by matching ANY of the contact's
 * addresses (case-insensitive). Never creates — an unresolved sender stays null so
 * the UI can offer "Add as contact" (AC9: no auto-creation ever).
 */
export function resolveContactIdByAddress(
  fromAddr: string | null | undefined,
  contacts: ContactAddressIndex[],
): string | null {
  const norm = (fromAddr ?? "").trim().toLowerCase();
  if (!norm) return null;
  const hit = contacts.find((c) =>
    c.emails.some((e) => e.trim().toLowerCase() === norm),
  );
  return hit?.id ?? null;
}

/** The spawned-from link args (task → email_thread), for spine.createLink. */
export function spawnedFromLinkArgs(args: {
  taskId: string;
  taskTitle: string;
  refId: string;
  subject: string;
}) {
  return {
    source: { type: "task" as const, id: args.taskId },
    target: { type: "email_thread" as const, id: args.refId },
    relationKind: "spawned-from" as const,
    origin: "manual" as const,
    sourceLabel: args.taskTitle,
    targetLabel: args.subject || "(no subject)",
  };
}
