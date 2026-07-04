/**
 * URL hardening + title de-duplication for the public published-note page
 * (Wave-3 NO-9b).
 *
 * The published page renders `body_md` with `react-markdown`, which is already
 * XSS-safe by construction: it renders to React elements (no dangerouslySetInner
 * HTML), ignores raw HTML by default (no rehype-raw), and sanitizes URLs. This
 * adds a stricter allow-list on top: only http/https/mailto (+ relative) links
 * survive on a public page; a `moduo://` chip (an in-app deep link, useless to
 * an anonymous visitor) or any other scheme is dropped.
 */

/** Return the URL if its scheme is safe for a public page, else "" (drop it). */
export function publicUrlTransform(url: string): string {
  const u = (url ?? "").trim();
  if (!u) return "";
  // Reject control chars (tab / newline / CR / …). Browsers STRIP these before
  // parsing a URL's scheme, so "java\tscript:alert(1)" would smuggle a
  // javascript: URL past the allow-list. A legit URL never carries raw controls.
  for (let i = 0; i < u.length; i++) {
    const c = u.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return "";
  }
  // Protocol-relative and root/relative URLs have no scheme — allow.
  if (u.startsWith("/") || u.startsWith("#")) return u;
  if (/^(https?:|mailto:)/i.test(u)) return u;
  // A bare token with no scheme (e.g. "example.com/x") — react-markdown treats
  // it as relative; allow. Anything with an explicit non-safe scheme is dropped.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  return "";
}

/**
 * A note's first line IS its title (the notes convention), so `body_md` leads
 * with it — but the public page renders the title as its own <h1>. Drop the
 * leading line when it duplicates the title (with or without a `#` marker) so
 * the heading isn't shown twice. No match → body unchanged.
 */
export function stripLeadingTitle(md: string, title: string): string {
  const t = (title ?? "").trim().toLowerCase();
  if (!t) return md ?? "";
  const lines = (md ?? "").split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length) return md ?? "";
  const first = lines[i].replace(/^#{1,6}\s*/, "").trim().toLowerCase();
  if (first !== t) return md ?? "";
  lines.splice(0, i + 1);
  while (lines.length && lines[0].trim() === "") lines.shift();
  return lines.join("\n");
}
