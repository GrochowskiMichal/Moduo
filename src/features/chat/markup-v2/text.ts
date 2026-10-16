// What a stored message says, read off its tree: the plain text search and
// excerpts use (`body_text`: syntax and URIs stripped, never a title), and the
// people, teams and items it mentions.

import { type Block, type Inline, PERSON_TYPE, TEAM_TYPE } from "./types";

function inlineText(leaves: readonly Inline[]): string {
  return leaves
    .map((leaf) => {
      switch (leaf.t) {
        case "text":
        case "code":
        case "url":
          return leaf.v;
        case "channel":
          return "@channel";
        case "emoji":
          return `:${leaf.name}:`;
        case "link":
          return leaf.c.map((c) => c.v).join("");
        case "br":
          return "\n";
        // A reference or a date chip has no words of its own in the stored form.
        default:
          return "";
      }
    })
    .join("");
}

/**
 * `body_text`: the words of a message without Markdown or `moduo://` URIs.
 * References read as nothing (a title would leak to readers who can't open
 * the item); lines and blocks are kept apart by "\n".
 */
export function toBodyText(blocks: readonly Block[]): string {
  return blocks
    .map((block) => {
      if (block.t === "pre") return block.v;
      if (block.t === "list") return block.items.map(inlineText).join("\n");
      return inlineText(block.c);
    })
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export type Mentions = {
  /** Person ids (`moduo://person/<id>`), each once, in order. */
  people: string[];
  /** Team ids (`moduo://team/<id>`). */
  teams: string[];
  /** Whether `@channel` appears outside code. */
  channel: boolean;
  /** Every other reference (task, note, conversation…), each once. */
  refs: Array<{ type: string; id: string }>;
};

/** Who and what a message mentions (for the send op's fan-out and `mentions` links). */
export function mentionsOf(blocks: readonly Block[]): Mentions {
  const out: Mentions = { people: [], teams: [], channel: false, refs: [] };
  const seen = new Set<string>();
  const visit = (leaves: readonly Inline[]) => {
    for (const leaf of leaves) {
      if (leaf.t === "channel") out.channel = true;
      if (leaf.t !== "ref") continue;
      const key = `${leaf.type}:${leaf.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (leaf.type === PERSON_TYPE) out.people.push(leaf.id);
      else if (leaf.type === TEAM_TYPE) out.teams.push(leaf.id);
      else out.refs.push({ type: leaf.type, id: leaf.id });
    }
  };
  for (const block of blocks) {
    if (block.t === "p" || block.t === "quote") visit(block.c);
    else if (block.t === "list") block.items.forEach(visit);
  }
  return out;
}

/**
 * One line of a message's words for an excerpt (Catch up's rows, the bell's
 * chat lines): Markdown marks gone, lines joined, and each reference named by
 * `nameOf` for this reader (a person's name, an item's title or "Private
 * item"); a date chip reads as `dayOf` says, else as written.
 */
export function toExcerptText(
  blocks: readonly Block[],
  nameOf: (type: string, id: string) => string,
  dayOf: (day: string) => string = (day) => day,
): string {
  const line = (leaves: readonly Inline[]) =>
    leaves
      .map((leaf) => {
        switch (leaf.t) {
          case "ref":
            return nameOf(leaf.type, leaf.id);
          case "date":
            return dayOf(leaf.day);
          case "br":
            return " ";
          default:
            return inlineText([leaf]);
        }
      })
      .join("");
  return blocks
    .map((block) => {
      if (block.t === "pre") return block.v;
      if (block.t === "list") return block.items.map(line).join(" ");
      return line(block.c);
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
