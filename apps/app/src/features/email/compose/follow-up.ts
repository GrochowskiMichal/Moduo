// "Remind me if no reply in…" (AC23, H): the compose footer's choice becomes a
// follow-up due time recorded on send through the existing follow-up op.

export const FOLLOW_UP_CHOICES = [
  { id: "1d", label: "1 day", days: 1 },
  { id: "3d", label: "3 days", days: 3 },
  { id: "1w", label: "1 week", days: 7 },
  { id: "2w", label: "2 weeks", days: 14 },
] as const;

export type FollowUpChoice = (typeof FOLLOW_UP_CHOICES)[number]["id"];

/** Due at 9:00 local on the day `days` from now. */
export function followUpDueMs(choice: FollowUpChoice, nowMs: number): number {
  const days = FOLLOW_UP_CHOICES.find((c) => c.id === choice)?.days ?? 3;
  const d = new Date(nowMs);
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}
