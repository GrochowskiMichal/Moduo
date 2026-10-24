/**
 * The allow-list for names a person typed that we print in an email to an
 * address someone else chose, from our domain (docs/gotchas/email.md: a sender
 * name is a phishing surface). Escaping stops markup; these stop the words.
 * Used by the booking emails (C1–C7) and the workspace emails (B3–B5).
 */

import { singleLine } from "../../escape.ts";
import { TEXT_LIMITS } from "../render.ts";

/**
 * A plain name: up to five words of letters (accents and any script), each
 * allowing inner apostrophes or hyphens and a closing abbreviation dot
 * ("Dr. Zoë O'Neill-Łukasz"). No digits, no other punctuation, so no link,
 * domain or address in any spelling (fullwidth or ideographic dots included).
 */
const PLAIN_NAME = /^[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*\.?(?: [\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*\.?){0,4}$/u;

/**
 * Invisible format characters (zero-width space and joiner, word joiner, soft
 * hyphen, …). Removed before any check and before printing, so what is checked
 * is what the reader sees: "Mo​duo" must not pass as anything but "Moduo".
 */
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

/** A link, a domain or an address, in any dot (fullwidth and ideographic included). */
const LINK_LIKE = /https?:|\/\/|www[.．。]|[\p{L}\p{N}][.．。]\p{L}{2,}|[@＠]/iu;

/** Latin look-alikes from other scripts, folded before the checks below (Cyrillic о, Greek ο, …). */
const LOOKALIKES: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ԁ": "d",
  "м": "m", "υ": "u", "ο": "o", "α": "a", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ρ": "p", "τ": "t",
};

/** Words that make a sender name read like us or like a department, not a person. */
const OFFICIAL = /moduo|\b(?:security|support|billing|account|accounts|admin|administrator|service|help|helpdesk|team|staff|noreply|verification|compliance)\b/;

/** Latin mixed with a look-alike script ("Ѕecurity", Cyrillic Ѕ) is a spoof, not a name. */
const MIXED_SCRIPT = /(?=.*\p{Script=Latin})(?=.*[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}\p{Script=Cherokee}])/u;

/** One line, capped, invisible characters gone. */
const visible = (value: string) => singleLine(value.replace(INVISIBLE, ""), TEXT_LIMITS.name);

/** NFKC, lower case, look-alikes folded: what a reader takes the text to say. */
function skeleton(value: string): string {
  return Array.from(value.normalize("NFKC").replace(INVISIBLE, "").toLowerCase(), (ch) => LOOKALIKES[ch] ?? ch).join("");
}

/** True for a plain name (see PLAIN_NAME), up to 50 characters. */
export function isPlainName(value: string): boolean {
  const flat = singleLine(value, TEXT_LIMITS.name).replace(/\s+/g, " ").trim();
  return !!flat && Array.from(flat).length <= 50 && PLAIN_NAME.test(flat);
}

/**
 * The booker's name as C2 shows it to someone who never asked to hear from
 * Moduo. The booking page is public, so this is anyone's free text, mailed
 * from our address to up to ten addresses they typed. Only a plain name gets
 * through (an allow-list: spam needs a link or a number); anything else
 * becomes "Someone".
 */
export function plainBookerName(value: string): string {
  return isPlainName(value) ? singleLine(value, TEXT_LIMITS.name).replace(/\s+/g, " ").trim() : "Someone";
}

/**
 * A person's name when it is a plain one that reads like a person (not like
 * us, a department or a look-alike spoof), else null. Every check runs on the
 * same flattened string the email prints.
 */
export function plainPersonName(value: string): string | null {
  const flat = visible(value).replace(/\s+/g, " ").trim();
  if (!isPlainName(flat) || MIXED_SCRIPT.test(flat.normalize("NFKC")) || OFFICIAL.test(skeleton(flat))) return null;
  return flat;
}

/** A typed label (workspace, role, link name) when it is set and doesn't read like a link, like us or like a spoof, else null. */
export function linkFree(value: string): string | null {
  const label = visible(value);
  if (!label) return null;
  const read = skeleton(label);
  if (LINK_LIKE.test(read) || /moduo/.test(read) || MIXED_SCRIPT.test(label.normalize("NFKC"))) return null;
  return label;
}
