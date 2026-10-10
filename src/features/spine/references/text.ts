// References inside plain text (a comment body, a notification excerpt): the
// stored form is the app's URI, `moduo://task/<id>` (the convention Notes'
// markdown already uses), and a date chip is `moduo://date/2026-10-11`. No
// title is ever written next to it, so a comment that mentions a private task
// carries nothing a reader without access could see (research §8). Each
// surface turns the URIs back into references (or plain words) per reader.

import { formatDay } from "../../../lib/time-format";
import { deletedLabel, PRIVATE_ITEM_LABEL, referenceKind } from "./kinds";
import type { ReferenceRef, ReferenceState } from "./types";

const URI = /moduo:\/\/([a-z][a-z_-]*)\/([A-Za-z0-9-]+)/g;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Every entity id is a uuid; a shorter one is a URI an excerpt cut short. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A reference written into plain text. */
export function referenceUri(ref: ReferenceRef): string {
  return `moduo://${ref.type}/${ref.id}`;
}

/** A date chip written into plain text (`YYYY-MM-DD`). */
export function dateUri(day: string): string {
  return `moduo://date/${day}`;
}

export type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "ref"; ref: ReferenceRef }
  | { kind: "date"; day: string };

/** Split plain text into its words, references and date chips, in order. */
export function splitReferenceText(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(URI)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    const [, type, id] = m;
    if (type === "date" && ISO_DAY.test(id ?? "")) {
      out.push({ kind: "date", day: id as string });
    } else if (type !== "date" && UUID.test(id ?? "")) {
      out.push({ kind: "ref", ref: { type: type as string, id: id as string } });
    } else {
      out.push({ kind: "text", text: m[0] });
    }
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** The references a text mentions, each once, in order. */
export function referencesInText(text: string): ReferenceRef[] {
  const seen = new Set<string>();
  const out: ReferenceRef[] = [];
  for (const seg of splitReferenceText(text)) {
    if (seg.kind !== "ref") continue;
    const key = `${seg.ref.type}:${seg.ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(seg.ref);
  }
  return out;
}

/** A plain-text name for a reference in the state a reader sees it. */
export function plainReferenceName(ref: ReferenceRef, state: ReferenceState | null): string {
  if (!state || state.status === "loading" || state.status === "error") return "…";
  if (state.status === "private") return PRIVATE_ITEM_LABEL;
  if (state.status === "deleted") return deletedLabel(referenceKind(ref.type));
  return state.facts.title;
}

/**
 * Plain text with every reference named for this reader (the bell, an OS
 * notice): the title when they can open it, "Private item" when they can't,
 * "Deleted task" when it's gone; a date chip reads as a day ("Tomorrow"). A
 * reference cut off by an excerpt's length ends in "…", never in a half URI.
 * Without a `nameOf`, references read "a linked item".
 */
export function referenceTextToPlain(
  text: string,
  nameOf?: (ref: ReferenceRef) => string,
  now: Date = new Date(),
): string {
  const out = splitReferenceText(text)
    .map((seg) => {
      if (seg.kind === "text") return seg.text;
      if (seg.kind === "date") return formatDay(`${seg.day}T00:00:00`, now);
      return nameOf ? nameOf(seg.ref) : "a linked item";
    })
    .join("");
  // An excerpt cut mid-URI ("moduo://task/1f3a") leaves its start behind.
  return out.replace(/moduo:\/?\/?[a-z_-]*\/?[A-Za-z0-9-]*$/, "…");
}
