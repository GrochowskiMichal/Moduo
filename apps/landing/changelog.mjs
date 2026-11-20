/**
 * moduo.app/changelog (REL-4, AC11): every release from release-notes/releases.json,
 * newest first, in the same words as the app's What's new. build.mjs writes it to
 * dist/changelog.html; the Worker's static assets serve it at the clean URL.
 *
 * The page is the beta terms page with its content swapped, so it keeps the text
 * pages' look (type, theme toggle, header) without a copy of their styles.
 */

const SECURITY_LINE = "Security and reliability improvements.";
const GROUPS = [
  ["new", "New"],
  ["improved", "Improved"],
  ["fixed", "Fixed"],
];
const DESCRIPTION = "What’s new in Moduo: every release, newest first.";

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function compareVersions(a, b) {
  const parse = (v) => {
    const [core, ...pre] = String(v).replace(/^v/, "").split("-");
    return {
      core: core.split(".").map((n) => Number.parseInt(n, 10) || 0),
      pre: pre.join("-") || null,
    };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre.localeCompare(pb.pre, "en", { numeric: true });
}

function formatDate(date) {
  const [y, m, d] = String(date).split("-").map(Number);
  if (!y || !m || !d) return String(date);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The releases worth showing, newest first (a malformed one is left out). */
export function changelogReleases(data) {
  const list = Array.isArray(data?.releases) ? data.releases : [];
  return list
    .filter((r) => r && typeof r.version === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date ?? ""))
    .sort((a, b) => compareVersions(b.version, a.version));
}

function renderRelease(release) {
  const id = `v${release.version.replace(/[^0-9a-z]+/gi, "-")}`;
  const items = Array.isArray(release.items) ? release.items : [];
  const by = { new: [], improved: [], fixed: [] };
  let security = false;
  for (const item of items) {
    if (!item || typeof item.text !== "string" || !item.text.trim()) continue;
    if (item.type === "security") security = true;
    else if (by[item.type]) by[item.type].push(item.text.trim());
  }
  if (security) by.fixed.push(SECURITY_LINE);
  const groups = GROUPS.filter(([key]) => by[key].length)
    .map(
      ([key, label]) =>
        `          <h3>${label}</h3>\n          <ul>\n${by[key]
          .map((text) => `            <li>${escapeHtml(text)}</li>`)
          .join("\n")}\n          </ul>`,
    )
    .join("\n");
  return [
    `        <section class="clause" id="${id}" aria-labelledby="h-${id}">`,
    `          <h2 id="h-${id}">Moduo ${escapeHtml(release.version)}</h2>`,
    `          <p class="updated"><time datetime="${escapeHtml(release.date)}">${formatDate(release.date)}</time></p>`,
    groups || "          <p>Reliability improvements.</p>",
    "        </section>",
  ].join("\n");
}

/** The page's <main>: an opening, then one section per release. */
export function renderChangelogMain(data) {
  const releases = changelogReleases(data);
  const body = releases.length
    ? releases.map(renderRelease).join("\n\n")
    : "        <p>The first release notes will appear here with the next update.</p>";
  return `<main id="main">
      <article class="col" aria-labelledby="page-title">
        <header class="opening">
          <p class="eyebrow">Changelog</p>
          <h1 id="page-title">What’s new in Moduo</h1>
          <p class="lede">Every release, newest first. The Mac and Windows apps update themselves, and the web app picks up a release when you reload.</p>
        </header>

${body}
      </article>

      <nav class="col" aria-label="Next">
        <div class="after">
          <a class="back" href="/">Back to moduo.app</a>
        </div>
      </nav>
    </main>`;
}

function replaceOnce(html, pattern, replacement, what) {
  if (!pattern.test(html)) throw new Error(`[landing] changelog: the template has no ${what}`);
  return html.replace(pattern, replacement);
}

/** changelog.html from a text page (terms.html) and the releases.json payload. */
export function renderChangelogPage(template, data) {
  let html = template.replace(/^(<!DOCTYPE html>)\s*<!--[\s\S]*?-->/i, "$1");
  html = replaceOnce(html, /<title>[^<]*<\/title>/, "<title>Changelog · Moduo</title>", "<title>");
  html = html.replace(/\s*<meta name="robots"[^>]*\/>/, "");
  html = html.replace(
    /(<meta\s+(?:name="description"|property="og:description")\s+content=")[^"]*"/g,
    `$1${DESCRIPTION}"`,
  );
  html = html.replace(/(<meta property="og:title" content=")[^"]*"/, '$1Changelog · Moduo"');
  html = html.replace(
    /(<meta property="og:url" content=")[^"]*"/,
    '$1https://moduo.app/changelog"',
  );
  html = replaceOnce(
    html,
    /<link rel="canonical" href="[^"]*" \/>/,
    '<link rel="canonical" href="https://moduo.app/changelog" />',
    "canonical link",
  );
  return replaceOnce(html, /<main id="main">[\s\S]*<\/main>/, renderChangelogMain(data), "<main>");
}
