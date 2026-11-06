// Settings → Mail → Density (specs/mail-v3.md §12, decision 14): three
// choices over the unchanged `density` + `previewLines` pair. Compact is one
// line and ignores the preview lines, so a stored compact with previewLines 2
// reads as Compact.

import type { MailBehavior } from "@/features/email/engine/behavior";

export const DENSITY_CHOICES = [
  { value: "comfortable:2", label: "Comfortable, 2-line preview" },
  { value: "comfortable:1", label: "Comfortable, 1-line preview" },
  { value: "compact", label: "Compact, one line" },
] as const;

export function densityChoice(b: Pick<MailBehavior, "density" | "previewLines">): string {
  return b.density === "compact" ? "compact" : `comfortable:${b.previewLines}`;
}

export function densityPatch(value: string): Partial<MailBehavior> {
  if (value === "compact") return { density: "compact" };
  return { density: "comfortable", previewLines: value.endsWith(":2") ? 2 : 1 };
}
