// Recipient autocomplete (AC23): contacts plus everyone you've exchanged mail
// with, ranked by how often you mail them. Contacts get a small bonus so a
// known person outranks a one-off correspondent; a prefix hit on the name or
// address outranks a hit inside a word.

export type RecipientCandidate = { name: string; email: string; count: number; isContact: boolean };

const CONTACT_BONUS = 3;

export function rankRecipients(input: {
  query: string;
  contacts: { name: string; email: string }[];
  correspondents: { name: string; email: string; count: number }[];
  exclude?: string[];
  limit?: number;
}): RecipientCandidate[] {
  const q = input.query.trim().toLowerCase();
  if (!q) return [];
  const exclude = new Set((input.exclude ?? []).map((e) => e.toLowerCase()));
  const merged = new Map<string, RecipientCandidate>();
  for (const c of input.correspondents) {
    const key = c.email.toLowerCase();
    merged.set(key, { name: c.name, email: key, count: c.count, isContact: false });
  }
  for (const c of input.contacts) {
    const key = c.email.toLowerCase();
    const prev = merged.get(key);
    merged.set(key, {
      name: c.name || prev?.name || "",
      email: key,
      count: prev?.count ?? 0,
      isContact: true,
    });
  }
  const scored: { c: RecipientCandidate; score: number }[] = [];
  for (const c of merged.values()) {
    if (exclude.has(c.email)) continue;
    const words = [...c.name.toLowerCase().split(/\s+/), c.email, c.email.split("@")[1] ?? ""];
    const prefix = words.some((w) => w.startsWith(q));
    const inside = !prefix && (c.name.toLowerCase().includes(q) || c.email.includes(q));
    if (!prefix && !inside) continue;
    const score = (prefix ? 1000 : 0) + c.count + (c.isContact ? CONTACT_BONUS : 0);
    scored.push({ c, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.c.email.localeCompare(b.c.email))
    .slice(0, input.limit ?? 8)
    .map((s) => s.c);
}
