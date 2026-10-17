const UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

export function extractMentionedUserIds(input: string): string[] {
  if (!input) return [];

  const ids = new Set<string>();

  const bracketMatches = input.matchAll(/@\{([\w-]{6,})\}/g);
  for (const match of bracketMatches) {
    const value = (match[1] ?? "").trim();
    if (value.length >= 6) ids.add(value);
  }

  const taggedMatches = input.matchAll(/@user:([\w-]{6,})/g);
  for (const match of taggedMatches) {
    const value = (match[1] ?? "").trim();
    if (value.length >= 6) ids.add(value);
  }

  const bareMatches = input.matchAll(/@([\w-]{8,})/g);
  for (const match of bareMatches) {
    const value = (match[1] ?? "").trim();
    if (UUID_LIKE.test(value)) ids.add(value);
  }

  return [...ids];
}
